import {afterEach, beforeEach, vi} from "vitest";

if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {},
  });
}

beforeEach(() => {
  navigator.getBattery = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
