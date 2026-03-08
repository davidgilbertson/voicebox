import { expect, test } from "vitest";
import { readMinVolumeThreshold, writeMinVolumeThreshold } from "../../src/Recorder/config.js";

test("min volume threshold persists as a positive number", () => {
  window.localStorage.removeItem("voicebox.minVolumeThreshold");
  expect(readMinVolumeThreshold()).toBe(2);

  writeMinVolumeThreshold(3.4);
  expect(readMinVolumeThreshold()).toBe(3.4);

  writeMinVolumeThreshold(-1);
  expect(readMinVolumeThreshold()).toBe(3.4);
});
