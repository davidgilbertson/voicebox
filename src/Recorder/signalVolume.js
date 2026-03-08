import { clamp } from "../tools.js";

export const STARTUP_MAX_VOLUME_DECAY_FACTOR = 0.8;

export function rmsToVolume(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Map RMS to a 0..10 log scale, with 0.0001 -> 0 and full-scale sine RMS (~0.707) -> 10.
  return clamp((4 + Math.log10(value)) * 2.6, 0, 10);
}
