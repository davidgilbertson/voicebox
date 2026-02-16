import {test} from "vitest";
import assert from "node:assert/strict";
import {interpolateFillValues} from "../../src/seriesFill.js";
import {consumeTimelineElapsed} from "../../src/timelineSteps.js";

test("vibrato timeline produces expected step count for 5-second window", () => {
  const durationSeconds = 5;
  const samplesPerSecond = 300;
  const frameMs = 1000 / 60;
  const totalFrames = Math.round((durationSeconds * 1000) / frameMs);
  const baseHz = 261.63; // C4
  const vibratoRateHz = 5;
  const vibratoDepthCents = 100;

  let accumulator = 0;
  let lastValue = Number.NaN;
  let writtenCount = 0;
  let finiteCount = 0;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const timeSeconds = (frame * frameMs) / 1000;
    const centsOffset =
        Math.sin(2 * Math.PI * vibratoRateHz * timeSeconds) * (vibratoDepthCents / 2);
    const hz = baseHz * (2 ** (centsOffset / 1200));
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
