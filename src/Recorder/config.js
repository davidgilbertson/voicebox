import {PITCH_NOTE_OPTIONS} from "../pitchScale.js";
import {clamp, ls} from "../tools.js";
import {PITCH_LINE_COLOR_MODES} from "./waveformColor.js";

// User-changeable preferences persisted in localStorage.
const KEEP_RUNNING_IN_BACKGROUND_STORAGE_KEY = "voicebox.keepRunningInBackground";
const AUTO_PAUSE_ON_SILENCE_STORAGE_KEY = "voicebox.autoPauseOnSilence";
const RUN_AT_30_FPS_STORAGE_KEY = "voicebox.runAt30Fps";
const HALF_RESOLUTION_CANVAS_STORAGE_KEY = "voicebox.halfResolutionCanvas";
const PITCH_MIN_NOTE_STORAGE_KEY = "voicebox.pitchMinNote";
const PITCH_MAX_NOTE_STORAGE_KEY = "voicebox.pitchMaxNote";
const PITCH_LINE_COLOR_MODE_STORAGE_KEY = "voicebox.pitchLineColorMode";
const SPECTROGRAM_MIN_HZ_STORAGE_KEY = "voicebox.spectrogramMinHz";
const SPECTROGRAM_MAX_HZ_STORAGE_KEY = "voicebox.spectrogramMaxHz";
const SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY = "voicebox.spectrogramNoiseProfile";

// Developer-changeable tuning and defaults.
export const ANALYSIS_WINDOW_SIZE = 2048;
export const SPECTROGRAM_BIN_COUNT = 4096;
export const SAMPLES_PER_SECOND = 200;
export const SILENCE_PAUSE_THRESHOLD_MS = 300;
export const PITCH_SECONDS = 5; // x axis range
export const CENTER_SECONDS = 1; // Window to use for vertical centering
export const RAW_BUFFER_SECONDS = 8;
export const VIBRATO_RATE_MIN_HZ = 3;
export const VIBRATO_SWEET_MIN_HZ = 4;
export const VIBRATO_SWEET_MAX_HZ = 8;
export const VIBRATO_RATE_MAX_HZ = 9;
export const VIBRATO_ANALYSIS_WINDOW_SECONDS = 0.5;
export const VIBRATO_MIN_CONTIGUOUS_SECONDS = 0.4;
export const VIBRATO_MAX_MARKER_PX_PER_FRAME = 2;
export const VIBRATO_RATE_HOLD_MS = 300;
export const PITCH_MIN_NOTE_DEFAULT = "C1";
export const PITCH_MAX_NOTE_DEFAULT = "F6";
const SPECTROGRAM_MIN_HZ_DEFAULT = 30;
const SPECTROGRAM_MAX_HZ_DEFAULT = 11_000;
const AUTO_PAUSE_ON_SILENCE_DEFAULT = true;
const RUN_AT_30_FPS_DEFAULT = false;
const HALF_RESOLUTION_CANVAS_DEFAULT = false;
const PITCH_LINE_COLOR_MODE_DEFAULT = "terrain";
const PITCH_LINE_COLOR_MODE_SET = new Set(PITCH_LINE_COLOR_MODES.map((item) => item.value));

function safeReadPitchNote(storageKey, fallback) {
  const stored = ls.get(storageKey, fallback);
  if (typeof stored !== "string") return fallback;
  return PITCH_NOTE_OPTIONS.includes(stored) ? stored : fallback;
}

function safeReadPositiveNumber(storageKey, fallback) {
  const stored = ls.get(storageKey, fallback);
  const value = Number(stored);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readKeepRunningInBackground() {
  return ls.get(KEEP_RUNNING_IN_BACKGROUND_STORAGE_KEY, false) === true;
}

export function writeKeepRunningInBackground(value) {
  ls.set(KEEP_RUNNING_IN_BACKGROUND_STORAGE_KEY, value);
}

export function readAutoPauseOnSilence() {
  return ls.get(AUTO_PAUSE_ON_SILENCE_STORAGE_KEY, AUTO_PAUSE_ON_SILENCE_DEFAULT) === true;
}

export function writeAutoPauseOnSilence(value) {
  ls.set(AUTO_PAUSE_ON_SILENCE_STORAGE_KEY, value);
}

export function readRunAt30Fps() {
  return ls.get(RUN_AT_30_FPS_STORAGE_KEY, RUN_AT_30_FPS_DEFAULT) === true;
}

export function writeRunAt30Fps(value) {
  ls.set(RUN_AT_30_FPS_STORAGE_KEY, value);
}

export function readHalfResolutionCanvas() {
  return ls.get(HALF_RESOLUTION_CANVAS_STORAGE_KEY, HALF_RESOLUTION_CANVAS_DEFAULT) === true;
}

export function writeHalfResolutionCanvas(value) {
  ls.set(HALF_RESOLUTION_CANVAS_STORAGE_KEY, value);
}

export function readPitchMinNote() {
  return safeReadPitchNote(PITCH_MIN_NOTE_STORAGE_KEY, PITCH_MIN_NOTE_DEFAULT);
}

export function readPitchMaxNote() {
  return safeReadPitchNote(PITCH_MAX_NOTE_STORAGE_KEY, PITCH_MAX_NOTE_DEFAULT);
}

export function writePitchMinNote(value) {
  ls.set(PITCH_MIN_NOTE_STORAGE_KEY, value);
}

export function writePitchMaxNote(value) {
  ls.set(PITCH_MAX_NOTE_STORAGE_KEY, value);
}

export function readPitchLineColorMode() {
  const stored = ls.get(PITCH_LINE_COLOR_MODE_STORAGE_KEY, PITCH_LINE_COLOR_MODE_DEFAULT);
  return PITCH_LINE_COLOR_MODE_SET.has(stored) ? stored : PITCH_LINE_COLOR_MODE_DEFAULT;
}

export function writePitchLineColorMode(value) {
  if (!PITCH_LINE_COLOR_MODE_SET.has(value)) return;
  ls.set(PITCH_LINE_COLOR_MODE_STORAGE_KEY, value);
}

export function readSpectrogramMinHz() {
  return safeReadPositiveNumber(SPECTROGRAM_MIN_HZ_STORAGE_KEY, SPECTROGRAM_MIN_HZ_DEFAULT);
}

export function readSpectrogramMaxHz() {
  return safeReadPositiveNumber(SPECTROGRAM_MAX_HZ_STORAGE_KEY, SPECTROGRAM_MAX_HZ_DEFAULT);
}

export function writeSpectrogramMinHz(value) {
  ls.set(SPECTROGRAM_MIN_HZ_STORAGE_KEY, value);
}

export function writeSpectrogramMaxHz(value) {
  ls.set(SPECTROGRAM_MAX_HZ_STORAGE_KEY, value);
}

export function readSpectrogramNoiseProfile() {
  const stored = ls.get(SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) return null;
  const profile = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i += 1) {
    const value = Number(stored[i]);
    profile[i] = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  }
  return profile;
}

export function writeSpectrogramNoiseProfile(profile) {
  ls.set(
      SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY,
      profile === null ? null : Array.from(profile)
  );
}
