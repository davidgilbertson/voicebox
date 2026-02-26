import {test} from "vitest";
import assert from "node:assert/strict";
import {
  estimateTimelineVibratoRate,
} from "../../src/Recorder/vibratoRate.js";

function createTimelineFromSeries(series) {
  return {
    values: Float32Array.from(series),
    writeIndex: 0,
    count: series.length,
  };
}

function assertDetectsStable6Hz(estimate) {
  const samplesPerSecond = 200;
  const seconds = 5;
  const total = samplesPerSecond * seconds;
  const series = new Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / samplesPerSecond;
    series[i] = Math.sin(2 * Math.PI * 6 * t) * 70;
  }

  const timeline = createTimelineFromSeries(series);
  const rateHz = estimate({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });

  assert.ok(rateHz !== null);
  assert.ok(Math.abs(rateHz - 6) < 0.2);
}

function assertOutOfRangeReturnsNull(estimate) {
  const samplesPerSecond = 200;
  const seconds = 5;
  const total = samplesPerSecond * seconds;
  const series = new Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / samplesPerSecond;
    series[i] = Math.sin(2 * Math.PI * 10 * t) * 70;
  }

  const timeline = createTimelineFromSeries(series);
  const rateHz = estimate({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });

  assert.equal(rateHz, null);
}

function assertSilentGapReturnsNull(estimate) {
  const samplesPerSecond = 200;
  const values = Float32Array.from([
    ...new Array(700).fill(Number.NaN),
    ...new Array(300).fill(0),
  ]);
  const rateHz = estimate({
    values,
    writeIndex: 0,
    count: values.length,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });
  assert.equal(rateHz, null);
}

test("default vibrato estimator detects a stable 6Hz signal", () => {
  assertDetectsStable6Hz(estimateTimelineVibratoRate);
});

test("default vibrato estimator returns null when signal is out of range", () => {
  assertOutOfRangeReturnsNull(estimateTimelineVibratoRate);
});

test("default vibrato estimator returns null for silent gaps", () => {
  assertSilentGapReturnsNull(estimateTimelineVibratoRate);
});
