import { expect, test } from "vitest";
import { mapWaveformIntensityToStrokeColor } from "../../src/Recorder/colorTools.js";

test("palette pitch-line colors have bottom and top intensity plateaus", () => {
  const fallback = "rgb(96, 165, 250)";

  expect(mapWaveformIntensityToStrokeColor(0, fallback, "cool")).toBe(
    mapWaveformIntensityToStrokeColor(0.25, fallback, "cool"),
  );
  expect(mapWaveformIntensityToStrokeColor(0.5, fallback, "cool")).not.toBe(
    mapWaveformIntensityToStrokeColor(0.25, fallback, "cool"),
  );
  expect(mapWaveformIntensityToStrokeColor(0.95, fallback, "cool")).toBe(
    mapWaveformIntensityToStrokeColor(1, fallback, "cool"),
  );
});
