import {test} from "vitest";
import assert from "node:assert/strict";
import {estimateTimelineVibratoRateHz} from "../src/vibratoRate.js";

function createTimelineFromSeries(series) {
  return {
    values: Float32Array.from(series),
    writeIndex: 0,
    count: series.length,
  };
}

test("vibrato rate estimator detects a stable 6Hz signal", () => {
  const samplesPerSecond = 200;
  const seconds = 5;
  const total = samplesPerSecond * seconds;
  const series = new Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / samplesPerSecond;
    series[i] = Math.sin(2 * Math.PI * 6 * t) * 70;
  }

  const timeline = createTimelineFromSeries(series);
  const rateHz = estimateTimelineVibratoRateHz({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });

  assert.ok(rateHz !== null);
  assert.ok(Math.abs(rateHz - 6) < 0.2);
});

test("vibrato rate estimator returns null when signal is out of range", () => {
  const samplesPerSecond = 200;
  const seconds = 5;
  const total = samplesPerSecond * seconds;
  const series = new Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / samplesPerSecond;
    series[i] = Math.sin(2 * Math.PI * 10 * t) * 70;
  }

  const timeline = createTimelineFromSeries(series);
  const rateHz = estimateTimelineVibratoRateHz({
    ...timeline,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });

  assert.equal(rateHz, null);
});

test("vibrato rate estimator returns null for silent gaps", () => {
  const samplesPerSecond = 200;
  const values = Float32Array.from([
    ...new Array(700).fill(Number.NaN),
    ...new Array(300).fill(0),
  ]);
  const rateHz = estimateTimelineVibratoRateHz({
    values,
    writeIndex: 0,
    count: values.length,
    samplesPerSecond,
    minRateHz: 4,
    maxRateHz: 9,
  });
  assert.equal(rateHz, null);
});
