import test from "node:test";
import assert from "node:assert/strict";
import {detectPitchAutocorr} from "../src/tools.js";
import {interpolateFillValues} from "../src/seriesFill.js";
import {consumeTimelineElapsed} from "../src/timelineSteps.js";
import {copyWindowWithZeroPad, generateVibratoSignal} from "./assets/vibrato.js";

test("vibrato timeline produces expected step count for 5-second window", () => {
  const sampleRate = 48_000;
  const durationSeconds = 5;
  const samplesPerSecond = 300;
  const fftSize = 2048;
  const frameMs = 1000 / 60;
  const totalFrames = Math.round((durationSeconds * 1000) / frameMs);
  const frameAdvanceSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const source = generateVibratoSignal({
    durationSeconds,
    sampleRate,
    baseHz: 261.63, // C4
    vibratoRateHz: 5,
    vibratoDepthCents: 100,
  });

  let accumulator = 0;
  let lastValue = Number.NaN;
  let writtenCount = 0;
  let finiteCount = 0;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const start = frame * frameAdvanceSamples;
    const window = copyWindowWithZeroPad(source, start, fftSize);
    const hz = detectPitchAutocorr(window, sampleRate, 65, 1100);
    const cents = hz > 0 ? 1200 * Math.log2(hz) : Number.NaN;
    const stepResult = consumeTimelineElapsed(frameMs, samplesPerSecond, accumulator);
    accumulator = stepResult.accumulator;
    const fillValues = interpolateFillValues(lastValue, cents, stepResult.steps);
    for (const value of fillValues) {
      writtenCount += 1;
      if (Number.isFinite(value)) {
        finiteCount += 1;
      }
    }
    if (stepResult.steps > 0) {
      lastValue = cents;
    }
  }

  assert.equal(writtenCount, durationSeconds * samplesPerSecond);
  assert.ok(finiteCount > writtenCount * 0.9);
});
