import test from "node:test";
import assert from "node:assert/strict";
import {consumeTimelineElapsed} from "../src/timelineSteps.js";

test("consumeTimelineElapsed computes expected steps and carry", () => {
  const samplesPerSecond = 300;
  let accumulator = 0;
  let written = 0;
  const frameCount = 300; // 5 seconds at 60fps
  const elapsedMs = 1000 / 60;
  for (let i = 0; i < frameCount; i += 1) {
    const result = consumeTimelineElapsed(elapsedMs, samplesPerSecond, accumulator);
    written += result.steps;
    accumulator = result.accumulator;
  }
  assert.equal(written, 1500);
  assert.ok(accumulator >= 0 && accumulator < 1);
});

test("consumeTimelineElapsed returns zero steps for invalid inputs", () => {
  assert.deepEqual(consumeTimelineElapsed(0, 300, 0.25), {steps: 0, accumulator: 0.25});
  assert.deepEqual(consumeTimelineElapsed(16, 0, 0.25), {steps: 0, accumulator: 0.25});
});
