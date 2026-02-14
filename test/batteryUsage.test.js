import {expect, test, vi} from "vitest";
import {createBatteryUsageMonitor} from "../src/batteryUsage.js";

test("returns -- until at least one minute has elapsed", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const battery = {level: 0.8, charging: false};
  navigator.getBattery = vi.fn(async () => battery);
  const monitor = createBatteryUsageMonitor();

  expect(await monitor.readUsagePerMinute()).toBe("--");

  vi.advanceTimersByTime(30_000);
  battery.level = 0.79;
  expect(await monitor.readUsagePerMinute()).toBe("--");
});

test("computes %/min from app-open baseline to current charge", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(5_000);
  const battery = {level: 0.8, charging: false};
  navigator.getBattery = vi.fn(async () => battery);
  const monitor = createBatteryUsageMonitor();

  expect(await monitor.readUsagePerMinute()).toBe("--");

  vi.advanceTimersByTime(60_000);
  battery.level = 0.78;
  expect(await monitor.readUsagePerMinute()).toBeCloseTo(2, 6);

  vi.advanceTimersByTime(60_000);
  battery.level = 0.76;
  expect(await monitor.readUsagePerMinute()).toBeCloseTo(2, 6);
});

test("returns null when charging or battery info is unavailable", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const battery = {level: 0.7, charging: false};
  navigator.getBattery = vi.fn(async () => battery);
  const monitor = createBatteryUsageMonitor();

  expect(await monitor.readUsagePerMinute()).toBe("--");

  battery.charging = true;
  vi.advanceTimersByTime(60_000);
  expect(await monitor.readUsagePerMinute()).toBeNull();

  navigator.getBattery = vi.fn(async () => ({
      level: undefined,
      charging: false,
  }));
  const unavailableMonitor = createBatteryUsageMonitor();
  expect(await unavailableMonitor.readUsagePerMinute()).toBeNull();
});
