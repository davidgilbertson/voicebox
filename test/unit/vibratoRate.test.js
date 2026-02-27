import {test} from "vitest";
import assert from "node:assert/strict";
import {
  computeTimelineVibratoDetectionAlpha,
  estimateLastKnownTimelineVibratoRate,
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

test("vibrato detection alpha uses one-way fade-to-solid within a run", () => {
  const samplesPerSecond = 200;
  const values = [];
  for (let i = 0; i < samplesPerSecond * 2; i += 1) {
    const t = i / samplesPerSecond;
    values.push(Math.sin(2 * Math.PI * 6 * t) * 70);
  }
  for (let i = 0; i < samplesPerSecond; i += 1) {
    values.push(0);
  }
  const timeline = createTimelineFromSeries(values);
  const alpha = computeTimelineVibratoDetectionAlpha({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
    analysisWindowSeconds: 0.5,
    minContinuousSeconds: 0.4,
  });

  const orderedAlpha = Array.from(alpha.subarray(0, timeline.count));
  const firstSolidIndex = orderedAlpha.findIndex((value) => value === 1);
  assert.ok(firstSolidIndex > 0);
  const leadingFaded = orderedAlpha.slice(0, firstSolidIndex).every((value) => value === 0.25);
  const trailingSolid = orderedAlpha.slice(firstSolidIndex).every((value) => value === 1);
  assert.equal(leadingFaded, true);
  assert.equal(trailingSolid, true);
});

test("last-known vibrato rate survives trailing non-vibrato samples", () => {
  const samplesPerSecond = 200;
  const values = [];
  for (let i = 0; i < samplesPerSecond * 2; i += 1) {
    const t = i / samplesPerSecond;
    values.push(Math.sin(2 * Math.PI * 6 * t) * 70);
  }
  for (let i = 0; i < samplesPerSecond; i += 1) {
    values.push(0);
  }
  const timeline = createTimelineFromSeries(values);
  const lastKnownRate = estimateLastKnownTimelineVibratoRate({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
    analysisWindowSeconds: 0.5,
    minContinuousSeconds: 0.4,
  });

  assert.ok(lastKnownRate !== null);
  assert.ok(Math.abs(lastKnownRate - 6) < 0.3);
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
