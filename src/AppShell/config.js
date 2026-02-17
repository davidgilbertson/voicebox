import {ls} from "../tools.js";

const ACTIVE_VIEW_STORAGE_KEY = "voicebox.activeView";
const ACTIVE_VIEW_DEFAULT = "vibrato";

export function readActiveView() {
  const stored = ls.get(ACTIVE_VIEW_STORAGE_KEY, ACTIVE_VIEW_DEFAULT);
  return stored === "pitch" || stored === "vibrato" || stored === "spectrogram"
      ? stored
      : ACTIVE_VIEW_DEFAULT;
}

export function writeActiveView(value) {
  ls.set(ACTIVE_VIEW_STORAGE_KEY, value);
}

