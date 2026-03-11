import { readConfig } from "../../src/config.js";

export function createRecordingEngineConfig() {
  const config = readConfig();
  return {
    ...config.shared,
    ...config.recorder,
    isForeground: true,
    activeView: config.app.activeView,
  };
}

export function createPlaybackEngineConfig() {
  const config = readConfig();
  return { ...config.shared, ...config.scales, isForeground: true };
}
