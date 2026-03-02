import {useEffect, useMemo, useRef, useState} from "react";
import {isNaturalNote, midiToNoteName, noteNameToMidi} from "../pitchScale.js";
import {playNote, subscribeToPlayedNotes} from "./piano.js";

const MIDI_MIN = 21;
const MIDI_MAX = 108;
const DEFAULT_MIN_NOTE = "C2";
const DEFAULT_MAX_NOTE = "C6";
const NOTE_DURATION_SECONDS = 0.8;
const HIGHLIGHT_HOLD_FALLBACK_MS = 220;
const HIGHLIGHT_ATTACK_MS = 50;
const HIGHLIGHT_RELEASE_MS = 320;
const BLACK_HEIGHT_RATIO = 40 / 64;
const BLACK_WIDTH_RATIO = 220 / 340;
const WELL_VERTICAL_RATIO = 3 / 64;
const WELL_RIGHT_RATIO = 3 / 340;
const BLACK_VERTICAL_OFFSET_PX = 2;

function findWhiteMidiAtOrBelow(startMidi) {
  for (let midi = startMidi; midi >= MIDI_MIN; midi -= 1) {
    const note = midiToNoteName(midi);
    if (note && isNaturalNote(note)) return midi;
  }
  return null;
}

function findWhiteMidiAtOrAbove(startMidi) {
  for (let midi = startMidi; midi <= MIDI_MAX; midi += 1) {
    const note = midiToNoteName(midi);
    if (note && isNaturalNote(note)) return midi;
  }
  return null;
}

function buildPianoKeys(minMidiInput, maxMidiInput) {
  const minWhiteMidi = findWhiteMidiAtOrBelow(minMidiInput);
  const maxWhiteMidi = findWhiteMidiAtOrAbove(maxMidiInput);
  const minMidi = minWhiteMidi ?? findWhiteMidiAtOrBelow(maxMidiInput);
  const maxMidi = maxWhiteMidi ?? findWhiteMidiAtOrAbove(minMidiInput);
  if (minMidi === null || maxMidi === null || minMidi > maxMidi) {
    return {whiteKeys: [], blackKeys: []};
  }

  const whiteNotes = [];
  for (let midi = maxMidi; midi >= minMidi; midi -= 1) {
    const note = midiToNoteName(midi);
    if (!note || !isNaturalNote(note)) continue;
    whiteNotes.push({midi, note});
  }

  if (whiteNotes.length === 0) {
    return {whiteKeys: [], blackKeys: []};
  }

  const whiteHeightPercent = 100 / whiteNotes.length;
  const whiteKeys = whiteNotes.map((entry, index) => ({
    note: entry.note,
    midi: entry.midi,
    topPercent: index * whiteHeightPercent,
    heightPercent: whiteHeightPercent,
  }));

  const whiteKeyTopByMidi = new Map();
  for (const key of whiteKeys) {
    whiteKeyTopByMidi.set(key.midi, key.topPercent);
  }

  const blackHeightPercent = whiteHeightPercent * BLACK_HEIGHT_RATIO;
  const blackKeys = [];

  for (let midi = maxMidi; midi >= minMidi; midi -= 1) {
    const note = midiToNoteName(midi);
    if (!note || isNaturalNote(note)) continue;

    const aboveWhiteTop = whiteKeyTopByMidi.get(midi + 1);
    const belowWhiteTop = whiteKeyTopByMidi.get(midi - 1);
    if (aboveWhiteTop === undefined || belowWhiteTop === undefined) continue;

    const boundaryPercent = aboveWhiteTop + whiteHeightPercent;
    blackKeys.push({
      note,
      midi,
      topPercent: boundaryPercent - (blackHeightPercent / 2),
      heightPercent: blackHeightPercent,
    });
  }

  return {whiteKeys, blackKeys};
}

export default function Piano({minNote = DEFAULT_MIN_NOTE, maxNote = DEFAULT_MAX_NOTE}) {
  const [activeMidiSet, setActiveMidiSet] = useState(() => new Set());
  const [pressedMidiSet, setPressedMidiSet] = useState(() => new Set());
  // For audio to play, it requires a user interaction, which means onClick, not onPointerDown
  // But onClick means a slight delay, so we use that for the very first press only
  const [useClickActivation, setUseClickActivation] = useState(true);
  const useClickActivationRef = useRef(useClickActivation);
  const clearTimeoutByMidiRef = useRef(new Map());

  useEffect(() => {
    useClickActivationRef.current = useClickActivation;
  }, [useClickActivation]);

  const {whiteKeys, blackKeys} = useMemo(() => {
    const minMidiRaw = noteNameToMidi(minNote) ?? noteNameToMidi(DEFAULT_MIN_NOTE) ?? MIDI_MIN;
    const maxMidiRaw = noteNameToMidi(maxNote) ?? noteNameToMidi(DEFAULT_MAX_NOTE) ?? MIDI_MAX;
    const minMidi = Math.min(minMidiRaw, maxMidiRaw);
    const maxMidi = Math.max(minMidiRaw, maxMidiRaw);
    return buildPianoKeys(minMidi, maxMidi);
  }, [maxNote, minNote]);

  const handleKeyPress = (note) => {
    void playNote(note, NOTE_DURATION_SECONDS)
        .then((startedNote) => {
          if (!startedNote || !useClickActivationRef.current) return;
          useClickActivationRef.current = false;
          setUseClickActivation(false);
        })
        .catch(() => {
        });
  };

  const pressMidi = (midi) => {
    setPressedMidiSet((prev) => {
      if (prev.has(midi)) return prev;
      const next = new Set(prev);
      next.add(midi);
      return next;
    });
  };

  const releaseMidi = (midi) => {
    setPressedMidiSet((prev) => {
      if (!prev.has(midi)) return prev;
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
  };

  useEffect(() => {
    const unsubscribe = subscribeToPlayedNotes(({note, durationSeconds}) => {
      const midi = typeof note === "number" ? note : noteNameToMidi(note);
      if (!Number.isFinite(midi)) return;

      const existingTimeout = clearTimeoutByMidiRef.current.get(midi);
      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
      }

      setActiveMidiSet((prev) => {
        const next = new Set(prev);
        next.add(midi);
        return next;
      });

      const holdMs = Number.isFinite(durationSeconds)
          ? Math.max(0, Math.round(durationSeconds * 1000))
          : HIGHLIGHT_HOLD_FALLBACK_MS;
      const fadeLeadMs = Math.min(holdMs, HIGHLIGHT_RELEASE_MS);
      const clearDelayMs = Math.max(HIGHLIGHT_ATTACK_MS, holdMs - fadeLeadMs);
      const clearTimeoutId = window.setTimeout(() => {
        setActiveMidiSet((prev) => {
          const next = new Set(prev);
          next.delete(midi);
          return next;
        });
        clearTimeoutByMidiRef.current.delete(midi);
      }, clearDelayMs);
      clearTimeoutByMidiRef.current.set(midi, clearTimeoutId);
    });

    return () => {
      unsubscribe();
      for (const timeoutId of clearTimeoutByMidiRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      clearTimeoutByMidiRef.current.clear();
    };
  }, []);

  return (
      <div className="h-full w-full bg-slate-900">
        <div className="relative h-full w-full overflow-hidden bg-slate-300">
          <div className="absolute inset-0 flex flex-col bg-black">
            {whiteKeys.map((key) => {
              const isHighlighted = activeMidiSet.has(key.midi) || pressedMidiSet.has(key.midi);
              return (
                  <button
                      key={key.note}
                      type="button"
                      aria-label={key.note}
                      onClick={useClickActivation ? () => handleKeyPress(key.note) : undefined}
                      onPointerDown={() => {
                        pressMidi(key.midi);
                        if (!useClickActivation) {
                          handleKeyPress(key.note);
                        }
                      }}
                      onPointerUp={() => releaseMidi(key.midi)}
                      onPointerLeave={() => releaseMidi(key.midi)}
                      onPointerCancel={() => releaseMidi(key.midi)}
                      className={`group relative w-full flex-1 appearance-none overflow-hidden text-left transition-colors duration-300 ${
                          isHighlighted ? "bg-blue-400" : ""
                      }`}
                      style={{
                        borderBottom: "3px solid #000",
                        borderTopRightRadius: "5px",
                        borderBottomRightRadius: "5px",
                        transitionProperty: "background-color",
                        transitionDuration: `${isHighlighted ? HIGHLIGHT_ATTACK_MS : HIGHLIGHT_RELEASE_MS}ms`,
                        transitionTimingFunction: isHighlighted ? "linear" : "cubic-bezier(0.4, 0, 1, 1)",
                      }}
                  >
                    <span
                        className={`pointer-events-none absolute inset-0 ${
                            isHighlighted ? "opacity-45" : "opacity-100"
                        }`}
                        style={{
                          background: "linear-gradient(90deg, #ffffff 0%, #f7f8fa 70%, #eef0f4 100%)",
                          transitionProperty: "opacity",
                          transitionDuration: `${isHighlighted ? HIGHLIGHT_ATTACK_MS : HIGHLIGHT_RELEASE_MS}ms`,
                          transitionTimingFunction: isHighlighted ? "linear" : "cubic-bezier(0.4, 0, 1, 1)",
                        }}
                    />
                    <span
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background:
                              "linear-gradient(90deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0) 55%)",
                          opacity: isHighlighted ? 0.3 : 0.22,
                        }}
                    />
                    {key.note.startsWith("C") && (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xl font-light text-slate-400">
                        {key.note}
                      </span>
                    )}
                  </button>
              );
            })}
          </div>

          {blackKeys.map((key) => (
              <div
                  key={`${key.note}-well`}
                  className="pointer-events-none absolute left-0 z-[1] bg-black"
                  style={{
                    top: `calc(${key.topPercent - (key.heightPercent / BLACK_HEIGHT_RATIO) * WELL_VERTICAL_RATIO}% - ${BLACK_VERTICAL_OFFSET_PX}px)`,
                    height: `${key.heightPercent + (key.heightPercent / BLACK_HEIGHT_RATIO) * (WELL_VERTICAL_RATIO * 2)}%`,
                    width: `${(BLACK_WIDTH_RATIO + WELL_RIGHT_RATIO) * 100}%`,
                    borderTopRightRadius: "5px",
                    borderBottomRightRadius: "5px",
                  }}
              />
          ))}

          {blackKeys.map((key) => {
            const isHighlighted = activeMidiSet.has(key.midi) || pressedMidiSet.has(key.midi);
            return (
                <button
                    key={key.note}
                    type="button"
                    aria-label={key.note}
                    onClick={useClickActivation ? () => handleKeyPress(key.note) : undefined}
                    onPointerDown={() => {
                      pressMidi(key.midi);
                      if (!useClickActivation) {
                        handleKeyPress(key.note);
                      }
                    }}
                    onPointerUp={() => releaseMidi(key.midi)}
                    onPointerLeave={() => releaseMidi(key.midi)}
                    onPointerCancel={() => releaseMidi(key.midi)}
                    className={`group absolute left-0 z-10 appearance-none overflow-hidden ${
                        isHighlighted ? "bg-blue-600" : ""
                    }`}
                    style={{
                      top: `calc(${key.topPercent}% - ${BLACK_VERTICAL_OFFSET_PX}px)`,
                      height: `${key.heightPercent}%`,
                      width: `${BLACK_WIDTH_RATIO * 100}%`,
                      borderTopRightRadius: "4px",
                      borderBottomRightRadius: "4px",
                      boxShadow: "-5px 7px 12px rgba(0, 0, 0, 0.36), -2px 3px 6px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -8px 12px rgba(0,0,0,0.55)",
                      transitionProperty: "background-color",
                      transitionDuration: `${isHighlighted ? HIGHLIGHT_ATTACK_MS : HIGHLIGHT_RELEASE_MS}ms`,
                      transitionTimingFunction: isHighlighted ? "linear" : "cubic-bezier(0.4, 0, 1, 1)",
                    }}
                >
                  <span
                      className={`pointer-events-none absolute inset-0 ${
                          isHighlighted ? "opacity-20" : "opacity-100"
                      }`}
                      style={{
                        background: "linear-gradient(90deg, #1a1c22 0%, #0c0e14 60%, #07080c 100%)",
                        transitionProperty: "opacity",
                        transitionDuration: `${isHighlighted ? HIGHLIGHT_ATTACK_MS : HIGHLIGHT_RELEASE_MS}ms`,
                        transitionTimingFunction: isHighlighted ? "linear" : "cubic-bezier(0.4, 0, 1, 1)",
                      }}
                  />
                  <>
                    <span
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background:
                              "linear-gradient(180deg, rgba(255,255,255,0.58) 0px, rgba(255,255,255,0.22) 1px, rgba(255,255,255,0.08) 2px, rgba(255,255,255,0) 7px)",
                          opacity: isHighlighted ? 0.42 : 0.55,
                          mixBlendMode: "screen",
                        }}
                    />
                    <span
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background:
                              "linear-gradient(90deg, rgba(255,255,255,0) calc(100% - 7px), rgba(255,255,255,0.10) calc(100% - 3px), rgba(255,255,255,0.28) calc(100% - 1px), rgba(255,255,255,0) 100%)",
                          opacity: isHighlighted ? 0.32 : 0.45,
                          mixBlendMode: "screen",
                        }}
                    />
                  </>
                </button>
            );
          })}
        </div>
      </div>
  );
}
