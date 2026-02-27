import {useCallback, useEffect, useRef, useState} from "react";
import {Metronome} from "lucide-react";
import StepperControl from "../components/StepperControl.jsx";
import Piano from "./Piano.jsx";
import GestureArea from "./GestureArea.jsx";
import {readScaleBpm, readScaleGestureHelpDismissed, readScaleMaxNote, readScaleMinNote, readScaleSelectedName, SCALE_BPM_MAX, SCALE_BPM_MIN, writeScaleBpm, writeScaleGestureHelpDismissed, writeScaleSelectedName,} from "./config.js";
import {clamp} from "../tools.js";
import {noteNameToMidi} from "../pitchScale.js";
import {ensurePianoLoaded, playMetronomeTick, playNote} from "./piano.js";

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
const RAPID_VERTICAL_SWIPE_MS = 500;
const MIDI_MIN = 21;
const MIDI_MAX = 108;

function buildSetTimeline(pattern) {
  return ["cue", "rest", "rest", ...pattern, "rest", "rest", "rest", "rest"];
}

function semitoneDeltaForRepeatDirection(repeatDirection) {
  return repeatDirection === "up" ? 1 : repeatDirection === "down" ? -1 : 0;
}

export default function ScalesPage({
                                     scaleMinNote = readScaleMinNote(),
                                     scaleMaxNote = readScaleMaxNote(),
                                     keepRunningInBackground = false,
                                     isForeground = true,
                                   }) {
  const [bpm, setBpm] = useState(() => readScaleBpm());
  const [selectedScaleName, setSelectedScaleName] = useState(() => readScaleSelectedName());
  const [repeatDirection, setRepeatDirection] = useState("up");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMetronomeEnabled, setIsMetronomeEnabled] = useState(false);
  const [isPianoReady, setIsPianoReady] = useState(false);
  const [showGestureHelp, setShowGestureHelp] = useState(() => !readScaleGestureHelpDismissed());
  const [gestureFlashSignal, setGestureFlashSignal] = useState(null);
  const playbackTimeoutRef = useRef(0);
  const activeNotesRef = useRef([]);
  const isPlayingRef = useRef(isPlaying);
  const isMetronomeEnabledRef = useRef(isMetronomeEnabled);
  const activeBpmRef = useRef(bpm);
  const repeatDirectionRef = useRef(repeatDirection);
  const setTimelineRef = useRef(buildSetTimeline(SEMITONE_PATTERN));
  const currentSetRootMidiRef = useRef(noteNameToMidi(scaleMinNote) ?? MIDI_MIN);
  const scaleMinMidiRef = useRef(noteNameToMidi(scaleMinNote) ?? MIDI_MIN);
  const scaleMaxMidiRef = useRef(noteNameToMidi(scaleMaxNote) ?? MIDI_MAX);
  const timelineIndexRef = useRef(0);
  const nextPulseAtMsRef = useRef(0);
  const playStepRef = useRef(null);
  const runPulseRef = useRef(null);
  const stepInFlightRef = useRef(false);
  const lastStepAtMsRef = useRef(0);
  // First pulse after (re)start is treated specially to avoid startup catch-up bursts
  // when audio warmup/sample decode takes longer than one step.
  const startupPrimingRef = useRef(false);
  const rapidVerticalSwipeRef = useRef({
    direction: null,
    atMs: 0,
    count: 0,
  });

  const selectedScalePattern = SCALE_PATTERNS[selectedScaleName] ?? SEMITONE_PATTERN;
  const allowPlayback = keepRunningInBackground || isForeground;

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
    isMetronomeEnabledRef.current = isMetronomeEnabled;
  }, [isMetronomeEnabled]);

  useEffect(() => {
    activeBpmRef.current = bpm;
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

  const flashGestureDirection = useCallback((direction) => {
    if (direction !== "up" && direction !== "down" && direction !== "right") return;
    setGestureFlashSignal((prev) => ({direction, id: (prev?.id ?? 0) + 1}));
  }, []);

  const trackStartedNote = useCallback((startedNote) => {
    if (!startedNote?.stop) return false;
    activeNotesRef.current.push(startedNote);
    if (activeNotesRef.current.length > 16) {
      activeNotesRef.current.shift()?.stop?.();
    }
    return true;
  }, []);

  const stopAllNotes = useCallback(() => {
    for (let i = 0; i < activeNotesRef.current.length; i += 1) {
      const note = activeNotesRef.current[i];
      note?.stop?.();
    }
    activeNotesRef.current = [];
  }, []);

  const clearPulseTimeout = useCallback(() => {
    if (playbackTimeoutRef.current) {
      window.clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = 0;
    }
  }, []);

  const schedulePulseAt = useCallback((nextAtMs) => {
    clearPulseTimeout();
    nextPulseAtMsRef.current = nextAtMs;
    const delayMs = Math.max(0, nextAtMs - performance.now());
    playbackTimeoutRef.current = window.setTimeout(() => {
      runPulseRef.current?.();
    }, delayMs);
  }, [clearPulseTimeout]);

  const reschedulePulseFromLastStep = useCallback(() => {
    const lastStepAtMs = lastStepAtMsRef.current;
    if (!lastStepAtMs) return;
    const stepMs = (60 / activeBpmRef.current) * 1000;
    schedulePulseAt(lastStepAtMs + stepMs);
  }, [schedulePulseAt]);

  const restartPulseLoop = useCallback((primeFirstPulse = false) => {
    startupPrimingRef.current = primeFirstPulse;
    const stepMs = (60 / activeBpmRef.current) * 1000;
    schedulePulseAt(performance.now() + stepMs);
  }, [schedulePulseAt]);

  const stopPulseLoop = useCallback(() => {
    clearPulseTimeout();
    nextPulseAtMsRef.current = 0;
    stepInFlightRef.current = false;
    lastStepAtMsRef.current = 0;
    startupPrimingRef.current = false;
  }, [clearPulseTimeout]);

  const stopPlayback = useCallback(() => {
    stopPulseLoop();
    stopAllNotes();
  }, [stopAllNotes, stopPulseLoop]);

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
    playStepRef.current = async () => {
      if (!isPlayingRef.current) return false;
      const timeline = setTimelineRef.current;
      const currentBpm = activeBpmRef.current;
      const stepDuration = 60 / currentBpm;
      const timelineEntry = timeline[timelineIndexRef.current];
      let noteWasPlayed = false;

      if (timelineEntry === "cue") {
        const cueRootMidi = clamp(currentSetRootMidiRef.current, scaleMinMidiRef.current, scaleMaxMidiRef.current);

        try {
          const startedNote = await playNote(cueRootMidi, stepDuration * 2);
          noteWasPlayed = trackStartedNote(startedNote);
        } catch {
        }
      } else if (timelineEntry !== "rest") {
        const rangeMinMidi = scaleMinMidiRef.current;
        const rangeMaxMidi = scaleMaxMidiRef.current;
        const noteMidi = clamp(
            currentSetRootMidiRef.current + timelineEntry,
            rangeMinMidi,
            rangeMaxMidi
        );

        try {
          const startedNote = await playNote(noteMidi, stepDuration);
          noteWasPlayed = trackStartedNote(startedNote);
        } catch {
        }
      }

      const nextIndex = (timelineIndexRef.current + 1) % timeline.length;
      const nextStartsSet = nextIndex === 0;
      timelineIndexRef.current = nextIndex;

      if (nextStartsSet) {
        const rangeMinMidi = scaleMinMidiRef.current;
        const rangeMaxMidi = scaleMaxMidiRef.current;
        if (rangeMinMidi === rangeMaxMidi) {
          setRepeatDirectionIfChanged("stay");
          currentSetRootMidiRef.current = rangeMinMidi;
        } else {
          let nextDirection = repeatDirectionRef.current;
          let nextRootMidi = currentSetRootMidiRef.current + semitoneDeltaForRepeatDirection(nextDirection);
          if (nextRootMidi > rangeMaxMidi) {
            nextDirection = "down";
            nextRootMidi = currentSetRootMidiRef.current + semitoneDeltaForRepeatDirection(nextDirection);
          } else if (nextRootMidi < rangeMinMidi) {
            nextDirection = "up";
            nextRootMidi = currentSetRootMidiRef.current + semitoneDeltaForRepeatDirection(nextDirection);
          }
          if (nextDirection !== repeatDirectionRef.current) {
            flashGestureDirection(nextDirection);
          }
          setRepeatDirectionIfChanged(nextDirection);
          currentSetRootMidiRef.current = clamp(nextRootMidi, rangeMinMidi, rangeMaxMidi);
        }
      }
      return noteWasPlayed;
    };
  }, [flashGestureDirection, trackStartedNote]);

  useEffect(() => {
    runPulseRef.current = async () => {
      const shouldRun = allowPlayback && (isPlayingRef.current || isMetronomeEnabledRef.current);
      if (!shouldRun) {
        stopPulseLoop();
        return;
      }
      if (stepInFlightRef.current) return;
      stepInFlightRef.current = true;
      const primingFirstPulse = startupPrimingRef.current;
      lastStepAtMsRef.current = performance.now();
      try {
        const noteWasPlayed = await playStepRef.current?.();
        if (isMetronomeEnabledRef.current) {
          const metronomeTickPromise = noteWasPlayed ? playMetronomeTick({duck: true}) : playMetronomeTick();
          await metronomeTickPromise.catch(() => {
          });
        }
      } finally {
        stepInFlightRef.current = false;
        // After the first startup pulse, we anchor the next pulse from "now"
        // instead of catching up from the pre-warmup timestamp.
        if (primingFirstPulse) {
          startupPrimingRef.current = false;
          const stepMs = (60 / activeBpmRef.current) * 1000;
          schedulePulseAt(performance.now() + stepMs);
          return;
        }
        reschedulePulseFromLastStep();
      }
    };
  }, [allowPlayback, reschedulePulseFromLastStep, schedulePulseAt, stopPulseLoop]);

  useEffect(() => {
    if (!allowPlayback || (!isPlaying && !isMetronomeEnabled)) {
      stopPulseLoop();
      return;
    }
    if (!nextPulseAtMsRef.current) {
      restartPulseLoop(true);
    }
  }, [allowPlayback, isMetronomeEnabled, isPlaying, restartPulseLoop, stopPulseLoop]);

  useEffect(() => {
    if (!isPlaying || !allowPlayback) {
      stopAllNotes();
      return;
    }
    timelineIndexRef.current = 0;
    stepInFlightRef.current = false;
    lastStepAtMsRef.current = 0;
    // Preserve startup priming if another effect has already marked this run
    // as a fresh start from a stopped loop.
    restartPulseLoop(startupPrimingRef.current);
  }, [allowPlayback, isPlaying, restartPulseLoop, stopAllNotes]);

  useEffect(() => {
    if (!nextPulseAtMsRef.current) return;
    reschedulePulseFromLastStep();
  }, [bpm, reschedulePulseFromLastStep]);

  const restartSetImmediately = useCallback((direction) => {
    const nextRootMidi = currentSetRootMidiRef.current + semitoneDeltaForRepeatDirection(direction);
    currentSetRootMidiRef.current = clamp(nextRootMidi, scaleMinMidiRef.current, scaleMaxMidiRef.current);
    timelineIndexRef.current = 0;
    repeatDirectionRef.current = direction;
    setRepeatDirection(direction);
    playStepRef.current?.();
    restartPulseLoop(false);
  }, [restartPulseLoop]);

  const updateRapidVerticalSwipeState = useCallback((direction) => {
    const nowMs = performance.now();
    const rapid = rapidVerticalSwipeRef.current;
    const isSameDirection = rapid.direction === direction;
    const isWithinRapidWindow = nowMs - rapid.atMs <= RAPID_VERTICAL_SWIPE_MS;
    rapid.count = isSameDirection && isWithinRapidWindow ? rapid.count + 1 : 1;
    rapid.direction = direction;
    rapid.atMs = nowMs;
    return rapid.count;
  }, []);

  const onGestureSwipe = useCallback((direction) => {
    if (direction === "right") {
      rapidVerticalSwipeRef.current.direction = null;
      rapidVerticalSwipeRef.current.count = 0;
      setRepeatDirectionIfChanged("stay");
      return;
    }
    if (direction === "left") {
      rapidVerticalSwipeRef.current.direction = null;
      rapidVerticalSwipeRef.current.count = 0;
      return;
    }
    if (direction === "up" || direction === "down") {
      const rapidCount = updateRapidVerticalSwipeState(direction);
      setRepeatDirectionIfChanged(direction);
      if (isPlayingRef.current && rapidCount >= 2) {
        restartSetImmediately(direction);
      }
    }
  }, [restartSetImmediately, setRepeatDirectionIfChanged, updateRapidVerticalSwipeState]);

  const onGestureTap = useCallback(() => {
    if (!isPianoReady) return;
    setIsPlaying((prev) => !prev);
  }, [isPianoReady]);

  const onDismissGestureHelp = () => {
    setShowGestureHelp(false);
    writeScaleGestureHelpDismissed(true);
  };

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
            <div className="text-xs uppercase tracking-wide text-slate-400">BPM</div>
            <div className="mt-2 flex items-center">
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
              <button
                  type="button"
                  onClick={() => setIsMetronomeEnabled((prev) => !prev)}
                  aria-pressed={isMetronomeEnabled}
                  aria-label={isMetronomeEnabled ? "Disable metronome" : "Enable metronome"}
                  className={`ml-auto inline-flex h-11 items-center justify-center rounded-md px-3 ${
                      isMetronomeEnabled
                          ? "bg-amber-400 text-amber-950"
                          : "bg-slate-800/80 text-slate-300"
                  }`}
              >
                <Metronome aria-hidden="true" className="h-5 w-5" strokeWidth={2}/>
              </button>
            </div>
          </section>

          <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              disabled={!isPianoReady}
              className={`mt-2 rounded-md px-4 py-3 text-base font-semibold ${
                  isPlaying ? "bg-amber-400 text-amber-950" : "bg-blue-400 text-slate-950"
              } disabled:opacity-50`}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

          <GestureArea
              testId="scales-gesture-area"
              className="relative flex min-h-0 flex-1 items-center justify-center rounded-md touch-none"
              onTap={onGestureTap}
              onSwipe={onGestureSwipe}
              externalFlashSignal={gestureFlashSignal}
              showHelp={showGestureHelp}
              helpContent={
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
                      className="mt-2 rounded-md bg-blue-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                      data-no-gesture-tap
                  >
                    Got it
                  </button>
                </div>
              }
          />
        </div>
      </div>
  );
}
