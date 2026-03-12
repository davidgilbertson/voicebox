import { ls } from "../tools.js";

const ACTIVE_VIEW_STORAGE_KEY = "voicebox.activeView";
const ACTIVE_VIEW_DEFAULT = "pitch";
const DEVELOPER_MODE_STORAGE_KEY = "voicebox.developerMode";

export function readActiveView() {
  const stored = ls.get(ACTIVE_VIEW_STORAGE_KEY, ACTIVE_VIEW_DEFAULT);
  return stored === "scales" ||
    stored === "pitch" ||
    stored === "vibrato" ||
    stored === "spectrogram"
    ? stored
    : ACTIVE_VIEW_DEFAULT;
}

export function writeActiveView(value) {
  ls.set(ACTIVE_VIEW_STORAGE_KEY, value);
}

export function readDeveloperMode() {
  return ls.get(DEVELOPER_MODE_STORAGE_KEY, false) === true;
}

export function writeDeveloperMode(value) {
  ls.set(DEVELOPER_MODE_STORAGE_KEY, value);
}
