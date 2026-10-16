import { describe, expect, test } from "vitest";
import { getPicaPitchResult, getPicaWindowSampleCount } from "../../src/Recorder/picaPitch.js";
import { hzToCents, noteNameToHz } from "../../src/pitchScale.js";

const sampleRate = 48_000;

function makeSineWindow(hz, { minHz = 80, amplitude = 0.5 } = {}) {
  const length = getPicaWindowSampleCount(sampleRate, minHz);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * amplitude;
  }
  return samples;
}

describe("PICA pitch detection", () => {
  test("Detects the pitch of a steady sine wave", () => {
    const hz = noteNameToHz("A3"); // 220 Hz
    const { cents } = getPicaPitchResult(makeSineWindow(hz), sampleRate, 80, 1000);

    // Time-domain correlation refines to sub-sample, so this should land within a
    // few cents of the true pitch (well under a quarter-tone, which is 50 cents).
    expect(Math.abs(cents - hzToCents(hz))).toBeLessThan(15);
  });

  test("Detects a higher sine wave at its true pitch", () => {
    const hz = noteNameToHz("E5"); // ~659 Hz
    const { cents } = getPicaPitchResult(makeSineWindow(hz), sampleRate, 80, 1000);

    expect(Math.abs(cents - hzToCents(hz))).toBeLessThan(15);
  });

  test("Returns NaN for a silent window", () => {
    const samples = new Float32Array(getPicaWindowSampleCount(sampleRate, 80));
    const { cents } = getPicaPitchResult(samples, sampleRate, 80, 1000);

    expect(cents).toBeNaN();
  });

  test("Returns NaN when the pitch is outside the configured range", () => {
    const hz = noteNameToHz("A3"); // 220 Hz, below the 300 Hz floor below
    const { cents } = getPicaPitchResult(makeSineWindow(hz), sampleRate, 300, 1000);

    expect(cents).toBeNaN();
  });
});
