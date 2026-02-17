import {clamp} from "../tools.js";

export const BATTERY_SAMPLE_INTERVAL_MS = 60_000;

export function createBatteryUsageMonitor() {
  const baseline = {
    startedAtMs: null,
    startLevel: null,
  };

  return {
    async readUsagePerMinute() {
      const getBattery = navigator.getBattery?.bind(navigator);
      if (typeof getBattery !== "function") return null;

      let batteryManager = null;
      try {
        batteryManager = await getBattery();
      } catch {
        return null;
      }
      if (!batteryManager) return null;

      const level = Number(batteryManager.level);
      if (!Number.isFinite(level)) return null;
      if (batteryManager.charging === true) {
        baseline.startedAtMs = null;
        baseline.startLevel = null;
        return null;
      }

      const normalizedLevel = clamp(level, 0, 1);
      const now = Date.now();
      if (baseline.startedAtMs === null || baseline.startLevel === null) {
        baseline.startedAtMs = now;
        baseline.startLevel = normalizedLevel;
        return "--";
      }

      const elapsedMinutes = (now - baseline.startedAtMs) / BATTERY_SAMPLE_INTERVAL_MS;
      if (elapsedMinutes < 1) {
        return "--";
      }

      return ((baseline.startLevel - normalizedLevel) * 100) / elapsedMinutes;
    },
  };
}
