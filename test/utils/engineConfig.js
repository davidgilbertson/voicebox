import { readConfig } from "../../src/config.js";

export function createRecordingEngineConfig() {
  const config = readConfig();
  return { ...config.shared, ...config.recorder, isForeground: true };
}

export function createPlaybackEngineConfig() {
  const config = readConfig();
  return { ...config.shared, ...config.scales, isForeground: true };
}
