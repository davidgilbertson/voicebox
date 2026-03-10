import { clamp } from "../tools.js";

export const BATTERY_SAMPLE_INTERVAL_MS = 60_000;

export class BatteryUsageMonitor {
  constructor() {
    this.listeners = new Set();
    this.currentUsage = null;
    this.batteryManagerPromise = null;
    this.baselineStartedAtMs = null;
    this.baselineStartLevel = null;
    this.intervalId = globalThis.setInterval(this.sample, BATTERY_SAMPLE_INTERVAL_MS);
    this.sample();
  }

  async getBatteryManager() {
    const getBattery = navigator.getBattery?.bind(navigator);
    if (typeof getBattery !== "function") return null;
    if (!this.batteryManagerPromise) {
      this.batteryManagerPromise = getBattery().catch(() => null);
    }
    return this.batteryManagerPromise;
  }

  async readUsagePerMinute() {
    const batteryManager = await this.getBatteryManager();
    if (!batteryManager) return null;

    const level = Number(batteryManager.level);
    if (!Number.isFinite(level)) return null;
    if (batteryManager.charging === true) return null;

    const normalizedLevel = clamp(level, 0, 1);
    const now = Date.now();
    if (this.baselineStartedAtMs === null || this.baselineStartLevel === null) {
      this.baselineStartedAtMs = now;
      this.baselineStartLevel = normalizedLevel;
      return "--";
    }

    const elapsedMinutes = (now - this.baselineStartedAtMs) / BATTERY_SAMPLE_INTERVAL_MS;
    if (elapsedMinutes < 1) {
      return "--";
    }

    return ((this.baselineStartLevel - normalizedLevel) * 100) / elapsedMinutes;
  }

  sample = async () => {
    this.currentUsage = await this.readUsagePerMinute();
    for (const listener of this.listeners) {
      listener(this.currentUsage);
    }
    return this.currentUsage;
  };

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentUsage);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy() {
    globalThis.clearInterval(this.intervalId);
    this.intervalId = 0;
    this.listeners.clear();
  }
}

export function createBatteryUsageMonitor() {
  return new BatteryUsageMonitor();
}
