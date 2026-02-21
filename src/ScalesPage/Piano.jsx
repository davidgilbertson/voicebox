import {useEffect, useMemo, useRef, useState} from "react";
import {isNaturalNote, midiToNoteName, noteNameToMidi} from "../pitchScale.js";
import {playNote, subscribeToPlayedNotes} from "./piano.js";

const MIDI_MIN = 21;
const MIDI_MAX = 108;
const DEFAULT_MIN_NOTE = "C2";
const DEFAULT_MAX_NOTE = "C6";
const NOTE_DURATION_SECONDS = 0.8;
const HIGHLIGHT_FADE_MS = 50;
const HIGHLIGHT_HOLD_FALLBACK_MS = 220;

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

  const blackHeightPercent = whiteHeightPercent * 0.68;
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
    void playNote(note, NOTE_DURATION_SECONDS, {emitHighlight: false})
        .then((startedNote) => {
          if (!startedNote || !useClickActivationRef.current) return;
          useClickActivationRef.current = false;
          setUseClickActivation(false);
        })
        .catch(() => {
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
      const clearTimeoutId = window.setTimeout(() => {
        setActiveMidiSet((prev) => {
          const next = new Set(prev);
          next.delete(midi);
          return next;
        });
        clearTimeoutByMidiRef.current.delete(midi);
      }, holdMs + HIGHLIGHT_FADE_MS);
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
      <div className="h-full w-full border-r border-slate-800 bg-slate-900">
        <div className="relative h-full w-full overflow-hidden bg-slate-100">
          <div className="absolute inset-0 flex flex-col">
            {whiteKeys.map((key) => {
              const isActive = activeMidiSet.has(key.midi);
              return (
                  <button
                      key={key.note}
                      type="button"
                      aria-label={key.note}
                      onClick={useClickActivation ? () => handleKeyPress(key.note) : undefined}
                      onPointerDown={!useClickActivation ? () => handleKeyPress(key.note) : undefined}
                      className={`relative w-full flex-1 border-b border-slate-800 transition-colors duration-50 ${
                          isActive ? "bg-blue-400" : "bg-slate-100 active:bg-blue-300"
                      }`}
                  >
                    {key.note.startsWith("C") && (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xl font-light text-slate-400">
                        {key.note}
                      </span>
                    )}
                  </button>
              );
            })}
          </div>

          {blackKeys.map((key) => {
            const isActive = activeMidiSet.has(key.midi);
            return (
                <button
                    key={key.note}
                    type="button"
                    aria-label={key.note}
                    onClick={useClickActivation ? () => handleKeyPress(key.note) : undefined}
                    onPointerDown={!useClickActivation ? () => handleKeyPress(key.note) : undefined}
                    className={`absolute left-0 z-10 w-3/5 rounded-r-sm border border-slate-900 transition-colors duration-50 ${
                        isActive ? "bg-blue-600" : "bg-slate-900 active:bg-blue-700"
                    }`}
                    style={{
                      top: `${key.topPercent}%`,
                      height: `${key.heightPercent}%`,
                    }}
                />
            );
          })}
        </div>
      </div>
  );
}
