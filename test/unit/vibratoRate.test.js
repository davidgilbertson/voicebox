import {test} from "vitest";
import assert from "node:assert/strict";
import {
  estimateTimelineCenterCents,
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

test("default vibrato estimator handles rounded plateaus", () => {
  const samplesPerSecond = 200;
  const seconds = 5;
  const total = samplesPerSecond * seconds;
  const series = new Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / samplesPerSecond;
    const raw = Math.sin(2 * Math.PI * 6 * t) * 70;
    series[i] = Math.round(raw / 10) * 10;
  }

  const timeline = createTimelineFromSeries(series);
  const rateHz = estimateTimelineVibratoRate({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });

  assert.ok(rateHz !== null);
  assert.ok(Math.abs(rateHz - 6) < 0.6);
});

test("default vibrato estimator handles turning-point at second-last sample", () => {
  const series = [-14, -1, -14, 3, -16, -33, -18, -2, 18, 26, 22, 9, -5, 5, 0];
  const timeline = createTimelineFromSeries(series);
  const rateHz = estimateTimelineVibratoRate({
    ...timeline,
    samplesPerSecond: 40,
    minRateHz: 4,
    maxRateHz: 10,
    minContinuousSeconds: 0.1,
  });

  assert.ok(rateHz !== null);
  assert.ok(Math.abs(rateHz - 6.6667) < 0.01);
});

test("timeline center can use vibrato-only samples", () => {
  const values = Float32Array.from([100, 100, 100, 300, 300, 300]);
  const detectionAlphas = Float32Array.from([0.25, 0.25, 0.25, 1, 1, 1]);
  const center = estimateTimelineCenterCents({
    values,
    writeIndex: 0,
    count: values.length,
    detectionAlphas,
    recentSampleCount: values.length,
  });
  assert.equal(center, 300);
});
