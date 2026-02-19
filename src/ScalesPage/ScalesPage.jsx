import {useCallback, useEffect, useRef, useState} from "react";
import {ArrowDown, ArrowRight, ArrowUp} from "lucide-react";
import StepperControl from "../components/StepperControl.jsx";
import Piano from "./Piano.jsx";
import {
  readScaleBpm,
  readScaleGestureHelpDismissed,
  readScaleMaxNote,
  readScaleMinNote,
  readScaleSelectedName,
  SCALE_BPM_MAX,
  SCALE_BPM_MIN,
  writeScaleGestureHelpDismissed,
  writeScaleBpm,
  writeScaleSelectedName,
} from "./config.js";
import {clamp} from "../tools.js";
import {noteNameToMidi} from "../pitchScale.js";
import {ensurePianoLoaded, ensurePianoReadyForPlayback, playNote} from "./piano.js";

/**
 * Terminology
 * Pattern: a sequence of values that are played from some base note
 * Set: one repeat of a pattern, starting at a particular note
 * Root note: the note that the pattern starts on
 * Cue: a short lead-in sound before the next set starts
 * Session: the continued loop of playing one pattern, resting, and repeating
 *   (with an increased, decreased, or the same root note)
 */

const SEMITONE_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0];
const PENTATONIC_PATTERN = [0, 2, 4, 7, 9, 7, 4, 2, 0, 2, 4, 7, 9, 7, 4, 2, 0];
const MAJOR_PATTERN = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
const TWO_UP_ONE_DOWN_PATTERN = [0, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 5, 6, 4, 5, 3, 4, 2, 3, 1, 2, 0];
const SCALE_PATTERNS = {
  Semitones: SEMITONE_PATTERN,
  Pentatonic: PENTATONIC_PATTERN,
  Major: MAJOR_PATTERN,
  "2 Up 1 Down": TWO_UP_ONE_DOWN_PATTERN,
};
const TAP_GESTURE_MAX_PX = 10;
const SWIPE_GESTURE_THRESHOLD_PX = 100;
const SWIPE_CLICK_SUPPRESS_MS = 350;
const RAPID_VERTICAL_SWIPE_MS = 500;
const SWIPE_FLASH_HOLD_MS = 140;
const SWIPE_FLASH_TOTAL_MS = 700;
const MIDI_MIN = 21;
const MIDI_MAX = 108;

function buildSetTimeline(pattern) {
  return ["cue", "rest", "rest", ...pattern, "rest", "rest", "rest", "rest"];
}

function semitoneDeltaForRepeatDirection(repeatDirection) {
  return repeatDirection === "up" ? 1 : repeatDirection === "down" ? -1 : 0;
}

function isGestureTapTarget(element) {
  return element?.closest?.("button,input,select,textarea,a,label,[role='button'],[data-no-gesture-tap]") !== null;
}

function classifyGesture(deltaX, deltaY) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const maxAxisPx = Math.max(absX, absY);
  return {
    isTap: maxAxisPx < TAP_GESTURE_MAX_PX,
    isSwipe: maxAxisPx > SWIPE_GESTURE_THRESHOLD_PX,
  };
}

export default function ScalesPage({
                                     scaleMinNote = readScaleMinNote(),
                                     scaleMaxNote = readScaleMaxNote(),
                                   }) {
  const [bpm, setBpm] = useState(() => readScaleBpm());
  const [selectedScaleName, setSelectedScaleName] = useState(() => readScaleSelectedName());
  const [repeatDirection, setRepeatDirection] = useState("up");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPianoReady, setIsPianoReady] = useState(false);
  const [showGestureHelp, setShowGestureHelp] = useState(() => !readScaleGestureHelpDismissed());
  const playbackIntervalRef = useRef(0);
  const activeNotesRef = useRef([]);
  const isPlayingRef = useRef(isPlaying);
  const activeBpmRef = useRef(bpm);
  const pendingBpmRef = useRef(null);
  const repeatDirectionRef = useRef(repeatDirection);
  const setTimelineRef = useRef(buildSetTimeline(SEMITONE_PATTERN));
  const currentSetRootMidiRef = useRef(noteNameToMidi(scaleMinNote) ?? MIDI_MIN);
  const scaleMinMidiRef = useRef(noteNameToMidi(scaleMinNote) ?? MIDI_MIN);
  const scaleMaxMidiRef = useRef(noteNameToMidi(scaleMaxNote) ?? MIDI_MAX);
  const timelineIndexRef = useRef(0);
  const rapidVerticalSwipeRef = useRef({
    direction: null,
    atMs: 0,
    count: 0,
  });
  const swipeGestureRef = useRef({
    pointerId: null,
    touchIdentifier: null,
    startX: 0,
    startY: 0,
    handled: false,
  });
  const suppressClicksUntilRef = useRef(0);
  const [swipeFlash, setSwipeFlash] = useState(null);
  const [swipeFlashFading, setSwipeFlashFading] = useState(false);
  const swipeFlashFadeTimeoutRef = useRef(0);
  const swipeFlashTimeoutRef = useRef(0);

  const selectedScalePattern = SCALE_PATTERNS[selectedScaleName] ?? SEMITONE_PATTERN;

  useEffect(() => {
    if (!Object.hasOwn(SCALE_PATTERNS, selectedScaleName)) {
      setSelectedScaleName("Semitones");
      return;
    }
    writeScaleSelectedName(selectedScaleName);
  }, [selectedScaleName]);

  useEffect(() => {
    writeScaleBpm(bpm);
  }, [bpm]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (isPlayingRef.current) {
      pendingBpmRef.current = bpm;
      return;
    }
    activeBpmRef.current = bpm;
    pendingBpmRef.current = null;
  }, [bpm]);

  useEffect(() => {
    repeatDirectionRef.current = repeatDirection;
  }, [repeatDirection]);

  useEffect(() => {
    setTimelineRef.current = buildSetTimeline(selectedScalePattern);
    timelineIndexRef.current = 0;
  }, [selectedScalePattern]);

  useEffect(() => {
    const nextMin = clamp(noteNameToMidi(scaleMinNote) ?? MIDI_MIN, MIDI_MIN, MIDI_MAX);
    const nextMax = clamp(noteNameToMidi(scaleMaxNote) ?? MIDI_MAX, MIDI_MIN, MIDI_MAX);
    scaleMinMidiRef.current = Math.min(nextMin, nextMax);
    scaleMaxMidiRef.current = Math.max(nextMin, nextMax);
    if (!isPlayingRef.current) {
      currentSetRootMidiRef.current = scaleMinMidiRef.current;
    }
  }, [scaleMaxNote, scaleMinNote]);

  const setRepeatDirectionIfChanged = useCallback((nextRepeatDirection) => {
    if (repeatDirectionRef.current === nextRepeatDirection) return;
    repeatDirectionRef.current = nextRepeatDirection;
    setRepeatDirection(nextRepeatDirection);
  }, []);

  const stopAllNotes = useCallback(() => {
    for (let i = 0; i < activeNotesRef.current.length; i += 1) {
      const note = activeNotesRef.current[i];
      note?.stop?.();
    }
    activeNotesRef.current = [];
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackIntervalRef.current) {
      window.clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = 0;
    }
    stopAllNotes();
  }, [stopAllNotes]);

  useEffect(() => {
    let cancelled = false;
    ensurePianoLoaded()
        .then(() => {
          if (!cancelled) setIsPianoReady(true);
        })
        .catch(() => {
          if (!cancelled) setIsPianoReady(false);
        });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  useEffect(() => {
    return () => {
      if (swipeFlashFadeTimeoutRef.current) {
        window.clearTimeout(swipeFlashFadeTimeoutRef.current);
      }
      if (swipeFlashTimeoutRef.current) {
        window.clearTimeout(swipeFlashTimeoutRef.current);
      }
    };
  }, []);

  const playStepRef = useRef(null);
  const restartIntervalRef = useRef(null);

  useEffect(() => {
    restartIntervalRef.current = () => {
      if (playbackIntervalRef.current) {
        window.clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = 0;
      }
      if (!isPlayingRef.current) return;
      const stepMs = (60 / activeBpmRef.current) * 1000;
      playbackIntervalRef.current = window.setInterval(() => {
        playStepRef.current?.();
      }, stepMs);
    };
  }, []);

  useEffect(() => {
    playStepRef.current = () => {
      if (!isPlayingRef.current) return;
      const timeline = setTimelineRef.current;
      const currentBpm = activeBpmRef.current;
      const stepDuration = 60 / currentBpm;
      const timelineEntry = timeline[timelineIndexRef.current];

      if (timelineEntry === "cue") {
        const cueRootMidi = clamp(currentSetRootMidiRef.current, scaleMinMidiRef.current, scaleMaxMidiRef.current);

        playNote(cueRootMidi, stepDuration * 2)
            .then((startedNote) => {
              if (!startedNote?.stop) return;
              activeNotesRef.current.push(startedNote);
              if (activeNotesRef.current.length > 16) {
                activeNotesRef.current.shift()?.stop?.();
              }
            })
            .catch(() => {
            });
      } else if (timelineEntry !== "rest") {
        const rangeMinMidi = scaleMinMidiRef.current;
        const rangeMaxMidi = scaleMaxMidiRef.current;
        const noteMidi = clamp(
            currentSetRootMidiRef.current + timelineEntry,
            rangeMinMidi,
            rangeMaxMidi
        );
        if (rangeMinMidi === rangeMaxMidi) {
          setRepeatDirectionIfChanged("stay");
        } else if (noteMidi >= rangeMaxMidi) {
          setRepeatDirectionIfChanged("down");
        } else if (noteMidi <= rangeMinMidi) {
          setRepeatDirectionIfChanged("up");
        }

        playNote(noteMidi, stepDuration)
            .then((startedNote) => {
              if (!startedNote?.stop) return;
              activeNotesRef.current.push(startedNote);
              if (activeNotesRef.current.length > 16) {
                activeNotesRef.current.shift()?.stop?.();
              }
            })
            .catch(() => {
            });
      }

      const nextIndex = (timelineIndexRef.current + 1) % timeline.length;
      const nextStartsSet = nextIndex === 0;
      timelineIndexRef.current = nextIndex;

      if (nextStartsSet) {
        const nextRootMidi = currentSetRootMidiRef.current + semitoneDeltaForRepeatDirection(repeatDirectionRef.current);
        currentSetRootMidiRef.current = clamp(nextRootMidi, scaleMinMidiRef.current, scaleMaxMidiRef.current);
        if (pendingBpmRef.current !== null && pendingBpmRef.current !== activeBpmRef.current) {
          activeBpmRef.current = pendingBpmRef.current;
          pendingBpmRef.current = null;
          restartIntervalRef.current?.();
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      stopPlayback();
      return;
    }
    let cancelled = false;
    if (pendingBpmRef.current !== null) {
      activeBpmRef.current = pendingBpmRef.current;
      pendingBpmRef.current = null;
    }
    ensurePianoReadyForPlayback()
        .then((ready) => {
          if (!ready || cancelled || !isPlayingRef.current) return;
          timelineIndexRef.current = 0;
          restartIntervalRef.current?.();
        })
        .catch(() => {
        });
    return () => {
      cancelled = true;
      stopPlayback();
    };
  }, [isPlaying, stopPlayback]);

  const onGesturePointerDownCapture = (event) => {
    swipeGestureRef.current.pointerId = event.pointerId;
    swipeGestureRef.current.touchIdentifier = null;
    swipeGestureRef.current.startX = event.clientX;
    swipeGestureRef.current.startY = event.clientY;
    swipeGestureRef.current.handled = false;
  };

  const showSwipeFlash = (direction) => {
    setSwipeFlash((prev) => ({direction, id: (prev?.id ?? 0) + 1}));
    setSwipeFlashFading(false);
    if (swipeFlashFadeTimeoutRef.current) {
      window.clearTimeout(swipeFlashFadeTimeoutRef.current);
    }
    swipeFlashFadeTimeoutRef.current = window.setTimeout(() => {
      setSwipeFlashFading(true);
    }, SWIPE_FLASH_HOLD_MS);
    if (swipeFlashTimeoutRef.current) {
      window.clearTimeout(swipeFlashTimeoutRef.current);
    }
    swipeFlashTimeoutRef.current = window.setTimeout(() => {
      setSwipeFlash(null);
    }, SWIPE_FLASH_TOTAL_MS);
  };

  const restartSetImmediately = (direction) => {
    const nextRootMidi = currentSetRootMidiRef.current + semitoneDeltaForRepeatDirection(direction);
    currentSetRootMidiRef.current = clamp(nextRootMidi, scaleMinMidiRef.current, scaleMaxMidiRef.current);
    timelineIndexRef.current = 0;
    repeatDirectionRef.current = direction;
    setRepeatDirection(direction);
    if (playbackIntervalRef.current) {
      window.clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = 0;
    }
    playStepRef.current?.();
    restartIntervalRef.current?.();
  };

  const updateRapidVerticalSwipeState = (direction) => {
    const nowMs = performance.now();
    const rapid = rapidVerticalSwipeRef.current;
    const isSameDirection = rapid.direction === direction;
    const isWithinRapidWindow = nowMs - rapid.atMs <= RAPID_VERTICAL_SWIPE_MS;
    rapid.count = isSameDirection && isWithinRapidWindow ? rapid.count + 1 : 1;
    rapid.direction = direction;
    rapid.atMs = nowMs;
    return rapid.count;
  };

  const handleGestureMove = (deltaX, deltaY) => {
    const gesture = swipeGestureRef.current;
    if (gesture.handled) return true;
    if (
        Math.abs(deltaX) < SWIPE_GESTURE_THRESHOLD_PX &&
        Math.abs(deltaY) < SWIPE_GESTURE_THRESHOLD_PX
    ) {
      return false;
    }

    gesture.handled = true;
    suppressClicksUntilRef.current = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      rapidVerticalSwipeRef.current.direction = null;
      rapidVerticalSwipeRef.current.count = 0;
      if (deltaX >= SWIPE_GESTURE_THRESHOLD_PX) {
        setRepeatDirectionIfChanged("stay");
        showSwipeFlash("stay");
      }
    } else if (deltaY <= -SWIPE_GESTURE_THRESHOLD_PX || deltaY >= SWIPE_GESTURE_THRESHOLD_PX) {
      const direction = deltaY <= -SWIPE_GESTURE_THRESHOLD_PX ? "up" : "down";
      const rapidCount = updateRapidVerticalSwipeState(direction);
      setRepeatDirectionIfChanged(direction);
      showSwipeFlash(direction);
      if (isPlayingRef.current && rapidCount >= 2) {
        restartSetImmediately(direction);
      }
    }
    return true;
  };

  const onGesturePointerMoveCapture = (event) => {
    const gesture = swipeGestureRef.current;
    if (gesture.pointerId !== event.pointerId || gesture.handled) {
      return;
    }
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const handled = handleGestureMove(deltaX, deltaY);
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onGesturePointerUpCapture = (event) => {
    const gesture = swipeGestureRef.current;
    if (gesture.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const gestureType = classifyGesture(deltaX, deltaY);
    const handled = gestureType.isSwipe ? handleGestureMove(deltaX, deltaY) : gesture.handled;
    swipeGestureRef.current.pointerId = null;
    if (gesture.handled || handled || !gestureType.isTap) {
      suppressClicksUntilRef.current = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onGesturePointerCancelCapture = () => {
    swipeGestureRef.current.pointerId = null;
    swipeGestureRef.current.touchIdentifier = null;
    swipeGestureRef.current.handled = false;
  };

  const onGestureTouchStartCapture = (event) => {
    if (swipeGestureRef.current.pointerId !== null) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    swipeGestureRef.current.pointerId = null;
    swipeGestureRef.current.touchIdentifier = touch.identifier;
    swipeGestureRef.current.startX = touch.clientX;
    swipeGestureRef.current.startY = touch.clientY;
    swipeGestureRef.current.handled = false;
  };

  const onGestureTouchMoveCapture = (event) => {
    const gesture = swipeGestureRef.current;
    if (gesture.pointerId !== null) return;
    if (gesture.touchIdentifier === null || gesture.handled) {
      return;
    }
    const touch = Array.from(event.changedTouches || []).find((entry) => entry.identifier === gesture.touchIdentifier);
    if (!touch) return;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const handled = handleGestureMove(deltaX, deltaY);
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onGestureTouchEndCapture = (event) => {
    const gesture = swipeGestureRef.current;
    if (gesture.pointerId !== null) return;
    if (gesture.touchIdentifier === null) return;
    const touch = Array.from(event.changedTouches || []).find((entry) => entry.identifier === gesture.touchIdentifier);
    if (!touch) return;
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const gestureType = classifyGesture(deltaX, deltaY);
    const handled = gestureType.isSwipe ? handleGestureMove(deltaX, deltaY) : gesture.handled;
    swipeGestureRef.current.touchIdentifier = null;
    if (gesture.handled || handled || !gestureType.isTap) {
      suppressClicksUntilRef.current = performance.now() + SWIPE_CLICK_SUPPRESS_MS;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  };

  const onGestureTouchCancelCapture = () => {
    swipeGestureRef.current.touchIdentifier = null;
    swipeGestureRef.current.handled = false;
  };

  const onGestureClickCapture = (event) => {
    if (isGestureTapTarget(event.target)) {
      return;
    }
    if (performance.now() < suppressClicksUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!isPianoReady) return;
    setIsPlaying((prev) => !prev);
  };

  const onDismissGestureHelp = () => {
    setShowGestureHelp(false);
    writeScaleGestureHelpDismissed(true);
  };

  const swipeFlashIcon = swipeFlash?.direction === "up" ? ArrowUp
      : swipeFlash?.direction === "down" ? ArrowDown
          : swipeFlash?.direction === "stay" ? ArrowRight
              : null;
  const SwipeFlashIcon = swipeFlashIcon;

  return (
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="w-32 min-h-0 shrink-0">
          <Piano
              minNote={scaleMinNote}
              maxNote={scaleMaxNote}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 py-4 select-none">
          <div>
            <div className="relative inline-flex items-center">
              <select
                  value={selectedScaleName}
                  onChange={(event) => setSelectedScaleName(event.target.value)}
                  className="scale-select border-0 bg-transparent pr-5 text-base font-semibold text-slate-100 focus:outline-none"
                  aria-label="Scale pattern"
              >
                {Object.keys(SCALE_PATTERNS).map((scaleName) => (
                    <option key={scaleName} value={scaleName} className="bg-slate-900 font-normal text-slate-100">
                      {scaleName}
                    </option>
                ))}
              </select>
            </div>
          </div>

          <section>
            <div className="flex items-center gap-3">
              <div className="text-xs uppercase tracking-wide text-slate-400">BPM</div>
              <div className="w-full max-w-40">
                <StepperControl
                    value={bpm}
                    onDecrement={() => setBpm((prev) => Math.max(SCALE_BPM_MIN, prev - 10))}
                    onIncrement={() => setBpm((prev) => Math.min(SCALE_BPM_MAX, prev + 10))}
                    decrementDisabled={bpm <= SCALE_BPM_MIN}
                    incrementDisabled={bpm >= SCALE_BPM_MAX}
                    decrementAriaLabel="Decrease scales BPM"
                    incrementAriaLabel="Increase scales BPM"
                    valueClassName="min-w-[4ch] text-center text-base font-semibold text-slate-100"
                    contentWidth="5ch"
                />
              </div>
            </div>
          </section>

          <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              disabled={!isPianoReady}
              className={`mt-2 rounded-md px-4 py-3 text-base font-semibold ${
                  isPlaying ? "bg-amber-400 text-amber-950" : "bg-sky-400 text-slate-950"
              } disabled:opacity-50`}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

          <div
              data-testid="scales-gesture-area"
              className="relative flex min-h-0 flex-1 items-center justify-center rounded-md touch-none"
              onPointerDownCapture={onGesturePointerDownCapture}
              onPointerMoveCapture={onGesturePointerMoveCapture}
              onPointerUpCapture={onGesturePointerUpCapture}
              onPointerCancelCapture={onGesturePointerCancelCapture}
              onTouchStartCapture={onGestureTouchStartCapture}
              onTouchMoveCapture={onGestureTouchMoveCapture}
              onTouchEndCapture={onGestureTouchEndCapture}
              onTouchCancelCapture={onGestureTouchCancelCapture}
              onClickCapture={onGestureClickCapture}
          >
            {showGestureHelp ? (
                <div
                    className="h-full w-full rounded-md border border-slate-700 bg-slate-900/95 p-3 text-sm text-slate-200 shadow-xl"
                    data-no-gesture-tap
                >
                  <div className="text-base font-semibold text-slate-100">Gestures</div>
                  <div className="mt-1 leading-relaxed">
                    In this area, use gestures to control what happens when the scale repeats: swipe up to shift up a semitone, swipe
                    down to shift down, or swipe right to repeat at the same pitch.
                  </div>
                  <div className="mt-1 leading-relaxed">
                    Swipe up or down repeatedly to quickly move through the range.
                  </div>
                  <div className="mt-1 leading-relaxed text-slate-300">
                    Tap empty space in this area to play or pause.
                  </div>
                  <button
                      type="button"
                      onClick={onDismissGestureHelp}
                      className="mt-2 rounded-md bg-sky-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                      data-no-gesture-tap
                  >
                    Got it
                  </button>
                </div>
            ) : SwipeFlashIcon ? (
                <SwipeFlashIcon
                    key={swipeFlash.id}
                    className={`h-24 w-24 text-sky-300 transition-opacity duration-500 ${
                        swipeFlashFading ? "opacity-0" : "opacity-100"
                    }`}
                />
            ) : null}
          </div>
        </div>
      </div>
  );
}
