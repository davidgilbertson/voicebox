import {ls} from "../tools.js";
import {noteNameToMidi} from "../pitchScale.js";

const SCALE_BPM_STORAGE_KEY = "voicebox.scales.bpm";
const SCALE_MIN_NOTE_STORAGE_KEY = "voicebox.scales.minNote";
const SCALE_MAX_NOTE_STORAGE_KEY = "voicebox.scales.maxNote";
const SCALE_SELECTED_NAME_STORAGE_KEY = "voicebox.scales.selectedName";
const SCALE_GESTURE_HELP_DISMISSED_STORAGE_KEY = "voicebox.scales.gestureHelpDismissed";

export const SCALE_BPM_DEFAULT = 280;
export const SCALE_BPM_MIN = 10;
export const SCALE_BPM_MAX = 500;
export const SCALE_SELECTED_NAME_DEFAULT = "Semitones";
export const SCALE_MIN_NOTE_DEFAULT = "A2";
export const SCALE_MAX_NOTE_DEFAULT = "E4";

export function readScaleBpm() {
  const value = Number(ls.get(SCALE_BPM_STORAGE_KEY, SCALE_BPM_DEFAULT));
  if (!Number.isFinite(value)) return SCALE_BPM_DEFAULT;
  return Math.min(SCALE_BPM_MAX, Math.max(SCALE_BPM_MIN, Math.round(value)));
}

export function writeScaleBpm(value) {
  ls.set(SCALE_BPM_STORAGE_KEY, value);
}

export function readScaleSelectedName() {
  const value = ls.get(SCALE_SELECTED_NAME_STORAGE_KEY, SCALE_SELECTED_NAME_DEFAULT);
  if (typeof value !== "string") return SCALE_SELECTED_NAME_DEFAULT;
  return value;
}

export function writeScaleSelectedName(value) {
  ls.set(SCALE_SELECTED_NAME_STORAGE_KEY, value);
}

export function readScaleMinNote() {
  const value = ls.get(SCALE_MIN_NOTE_STORAGE_KEY, SCALE_MIN_NOTE_DEFAULT);
  if (typeof value !== "string") return SCALE_MIN_NOTE_DEFAULT;
  return noteNameToMidi(value) === null ? SCALE_MIN_NOTE_DEFAULT : value;
}

export function writeScaleMinNote(value) {
  ls.set(SCALE_MIN_NOTE_STORAGE_KEY, value);
}

export function readScaleMaxNote() {
  const value = ls.get(SCALE_MAX_NOTE_STORAGE_KEY, SCALE_MAX_NOTE_DEFAULT);
  if (typeof value !== "string") return SCALE_MAX_NOTE_DEFAULT;
  return noteNameToMidi(value) === null ? SCALE_MAX_NOTE_DEFAULT : value;
}

export function writeScaleMaxNote(value) {
  ls.set(SCALE_MAX_NOTE_STORAGE_KEY, value);
}

export function readScaleGestureHelpDismissed() {
  return ls.get(SCALE_GESTURE_HELP_DISMISSED_STORAGE_KEY, false) === true;
}

export function writeScaleGestureHelpDismissed(value) {
  ls.set(SCALE_GESTURE_HELP_DISMISSED_STORAGE_KEY, value);
}
