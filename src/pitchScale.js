const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NATURAL_NOTE_NAMES = new Set(["A", "B", "C", "D", "E", "F", "G"]);
const A4_HZ = 440;
const A4_MIDI = 69;

function buildPitchNoteOptions(minMidi, maxMidi) {
  const options = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const octave = Math.floor(midi / 12) - 1;
    const note = NOTE_NAMES[midi % 12];
    options.push(`${note}${octave}`);
  }
  return options;
}

export const PITCH_NOTE_OPTIONS = buildPitchNoteOptions(21, 108); // A0..C8

function parseNoteName(noteName) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(noteName);
  if (!match) return null;
  return {
    note: match[1],
    octave: Number.parseInt(match[2], 10),
  };
}

export function noteNameToMidi(noteName) {
  const parsed = parseNoteName(noteName);
  if (!parsed) return null;
  const noteIndex = NOTE_NAMES.indexOf(parsed.note);
  if (noteIndex < 0) return null;
  return (parsed.octave + 1) * 12 + noteIndex;
}

export function midiToNoteName(midi) {
  if (!Number.isFinite(midi)) return null;
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const note = NOTE_NAMES[((rounded % 12) + 12) % 12];
  return `${note}${octave}`;
}

export function midiToHz(midi) {
  return A4_HZ * (2 ** ((midi - A4_MIDI) / 12));
}

export function centsToHz(cents) {
  if (!Number.isFinite(cents)) return Number.NaN;
  return 2 ** (cents / 1200);
}

export function hzToCents(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return Number.NaN;
  return 1200 * Math.log2(hz);
}

export function noteNameToHz(noteName) {
  const midi = noteNameToMidi(noteName);
  if (midi === null) return Number.NaN;
  return midiToHz(midi);
}

export function noteNameToCents(noteName) {
  const hz = noteNameToHz(noteName);
  return hzToCents(hz);
}

export function isNaturalNote(noteName) {
  const parsed = parseNoteName(noteName);
  return parsed ? NATURAL_NOTE_NAMES.has(parsed.note) : false;
}

export function isOctaveC(noteName) {
  return /^C-?\d+$/.test(noteName);
}

export function createPitchGridLines({minCents, maxCents}) {
  if (!Number.isFinite(minCents) || !Number.isFinite(maxCents) || maxCents <= minCents) {
    return [];
  }

  const minMidi = Math.floor(A4_MIDI + (12 * Math.log2(centsToHz(minCents) / A4_HZ)));
  const maxMidi = Math.ceil(A4_MIDI + (12 * Math.log2(centsToHz(maxCents) / A4_HZ)));
  const lines = [];

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const noteName = midiToNoteName(midi);
    const cents = hzToCents(midiToHz(midi));
    if (!noteName || cents < minCents || cents > maxCents) continue;
    if (isOctaveC(noteName)) {
      lines.push({cents, noteName, tier: "octave", showLabel: true});
      continue;
    }
    if (isNaturalNote(noteName)) {
      lines.push({cents, noteName, tier: "natural", showLabel: true});
      continue;
    }
    lines.push({cents, noteName, tier: "accidental", showLabel: false});
  }

  return lines;
}
