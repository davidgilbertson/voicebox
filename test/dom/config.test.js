import { expect, test } from "vitest";
import { readMinSignalThreshold, writeMinSignalThreshold } from "../../src/Recorder/config.js";

test("min signal threshold persists as a positive number", () => {
  window.localStorage.removeItem("voicebox.minSignalThreshold");
  expect(readMinSignalThreshold()).toBe(0.015);

  writeMinSignalThreshold(0.003);
  expect(readMinSignalThreshold()).toBe(0.003);

  writeMinSignalThreshold(-1);
  expect(readMinSignalThreshold()).toBe(0.003);
});
