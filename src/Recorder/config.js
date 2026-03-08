import { PITCH_NOTE_OPTIONS } from "../pitchScale.js";
import { ls } from "../tools.js";
import { PITCH_LINE_COLOR_MODES } from "./colorTools.js";

// User-changeable preferences persisted in localStorage.
const KEEP_RUNNING_IN_BACKGROUND_STORAGE_KEY = "voicebox.keepRunningInBackground";
const AUTO_PAUSE_ON_SILENCE_STORAGE_KEY = "voicebox.autoPauseOnSilence";
const RUN_AT_30_FPS_STORAGE_KEY = "voicebox.runAt30Fps";
const HALF_RESOLUTION_CANVAS_STORAGE_KEY = "voicebox.halfResolutionCanvas";
const HIGH_RES_SPECTROGRAM_STORAGE_KEY = "voicebox.highResSpectrogram";
const PITCH_MIN_NOTE_STORAGE_KEY = "voicebox.pitchMinNote";
const PITCH_MAX_NOTE_STORAGE_KEY = "voicebox.pitchMaxNote";
const PITCH_LINE_COLOR_MODE_STORAGE_KEY = "voicebox.pitchLineColorMode";
const MAX_VOLUME_STORAGE_KEY = "voicebox.maxVolume";
const MIN_VOLUME_THRESHOLD_STORAGE_KEY = "voicebox.minVolumeThreshold";
const SPECTROGRAM_MIN_HZ_STORAGE_KEY = "voicebox.spectrogramMinHz";
const SPECTROGRAM_MAX_HZ_STORAGE_KEY = "voicebox.spectrogramMaxHz";

// Developer-changeable tuning and defaults.
// The FFT_SIZE trade-off:
// 8192 means ~170ms of input at 48kHz, and a bin near 50Hz is 20px tall on a 1000px-high log spectrogram (40->11000Hz)
// 4096 means ~85ms of input at 48kHz, and a bin near 50Hz is 38px tall on a 1000px-high log spectrogram (40->11000Hz)
// export const FFT_SIZE = 8192; // AnalyserNode uses this as the input window sample count
export const FFT_SIZE = 4096; // AnalyserNode uses this as the input window sample count
export const SPECTROGRAM_BIN_COUNT = FFT_SIZE / 2; // output bin count is always FFT_SIZE / 2
export const DISPLAY_PIXELS_PER_SECOND = 75; // E.g. @ 400px wide, the chart would show 5 seconds of audio
export const SILENCE_PAUSE_THRESHOLD_MS = 300;
export const CENTER_SECONDS = 1; // Window to use for vertical centering
export const VIBRATO_RATE_MIN_HZ = 3;
export const VIBRATO_SWEET_MIN_HZ = 4;
export const VIBRATO_SWEET_MAX_HZ = 8;
export const VIBRATO_RATE_MAX_HZ = 9;
export const VIBRATO_ANALYSIS_WINDOW_SECONDS = 0.7;
export const VIBRATO_MIN_CONTIGUOUS_SECONDS = 0.4;
export const MAX_DRAW_JUMP_CENTS = 150;
export const PITCH_MIN_NOTE_DEFAULT = "C1";
export const PITCH_MAX_NOTE_DEFAULT = "F6";
const PITCH_LINE_COLOR_MODE_DEFAULT = "terrain";
const SPECTROGRAM_MIN_HZ_DEFAULT = 30;
const SPECTROGRAM_MAX_HZ_DEFAULT = 11_000;
const AUTO_PAUSE_ON_SILENCE_DEFAULT = true;
const RUN_AT_30_FPS_DEFAULT = false;
const HALF_RESOLUTION_CANVAS_DEFAULT = false;
const HIGH_RES_SPECTROGRAM_DEFAULT = true;
const MAX_VOLUME_DEFAULT = 6;
export const MIN_VOLUME_THRESHOLD_DEFAULT = 2;
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

export function readHighResSpectrogram() {
  return ls.get(HIGH_RES_SPECTROGRAM_STORAGE_KEY, HIGH_RES_SPECTROGRAM_DEFAULT) === true;
}

export function writeHighResSpectrogram(value) {
  ls.set(HIGH_RES_SPECTROGRAM_STORAGE_KEY, value);
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

export function readMaxVolume() {
  return safeReadPositiveNumber(MAX_VOLUME_STORAGE_KEY, MAX_VOLUME_DEFAULT);
}

export function writeMaxVolume(value) {
  if (!Number.isFinite(value) || value <= 0) return;
  ls.set(MAX_VOLUME_STORAGE_KEY, value);
}

export function readMinVolumeThreshold() {
  return safeReadPositiveNumber(MIN_VOLUME_THRESHOLD_STORAGE_KEY, MIN_VOLUME_THRESHOLD_DEFAULT);
}

export function writeMinVolumeThreshold(value) {
  if (!Number.isFinite(value) || value <= 0) return;
  ls.set(MIN_VOLUME_THRESHOLD_STORAGE_KEY, value);
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
