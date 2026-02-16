import {test} from "vitest";
import assert from "node:assert/strict";
import {smoothDisplayTimeline} from "../../src/displaySmoothing.js";

function orderedValues({values, writeIndex, count}) {
  const result = [];
  const firstIndex = count === values.length ? writeIndex : 0;
  for (let i = 0; i < count; i += 1) {
    result.push(values[(firstIndex + i) % values.length]);
  }
  return result;
}

function peakToPeak(values) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function roughness(values) {
  let total = 0;
  let count = 0;
  for (let i = 2; i < values.length; i += 1) {
    const prev = values[i - 2];
    const current = values[i - 1];
    const next = values[i];
    if (!Number.isFinite(prev) || !Number.isFinite(current) || !Number.isFinite(next)) continue;
    total += Math.abs((next - current) - (current - prev));
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

function zeroCrossings(values) {
  const crossings = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const next = values[i];
    if (!(prev <= 0 && next > 0)) continue;
    const slope = next - prev;
    if (slope === 0) continue;
    const t = (0 - prev) / slope;
    crossings.push((i - 1) + t);
  }
  return crossings;
}

test("display smoothing keeps NaN gaps and short runs unchanged", () => {
  const values = Float32Array.from([
    Number.NaN,
    10,
    20,
    Number.NaN,
    30,
    40,
    Number.NaN,
    Number.NaN,
  ]);
  const state = {
    values,
    writeIndex: 0,
    count: values.length,
  };
  const output = new Float32Array(values.length);
  const smoothed = smoothDisplayTimeline(state, {output});
  assert.deepEqual(Array.from(smoothed), Array.from(values));
});

test("display smoothing keeps constant regions unchanged", () => {
  const values = new Float32Array(16);
  values.fill(42);
  const state = {
    values,
    writeIndex: 0,
    count: values.length,
  };
  const output = new Float32Array(values.length);
  const smoothed = smoothDisplayTimeline(state, {output});
  for (const value of smoothed) {
    assert.equal(value, 42);
  }
});

test("display smoothing reduces jitter while preserving vibrato depth and rate", () => {
  const sampleRate = 200;
  const durationSeconds = 5;
  const total = sampleRate * durationSeconds;
  const values = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    const vibrato = Math.sin(2 * Math.PI * 5 * t) * 60;
    const jitter = Math.sin(2 * Math.PI * 23 * t) * 2.5;
    values[i] = vibrato + jitter;
  }
  const state = {values, writeIndex: 0, count: values.length};
  const output = new Float32Array(values.length);
  smoothDisplayTimeline(state, {output});

  const raw = orderedValues(state);
  const smoothed = orderedValues({...state, values: output});

  const rawAmplitude = peakToPeak(raw);
  const smoothedAmplitude = peakToPeak(smoothed);
  assert.ok(smoothedAmplitude >= rawAmplitude * 0.9);

  const rawRoughness = roughness(raw);
  const smoothedRoughness = roughness(smoothed);
  assert.ok(smoothedRoughness < rawRoughness);

  const rawCrossings = zeroCrossings(raw);
  const smoothedCrossings = zeroCrossings(smoothed);
  assert.equal(smoothedCrossings.length, rawCrossings.length);
  let totalDelta = 0;
  for (let i = 0; i < rawCrossings.length; i += 1) {
    totalDelta += Math.abs(rawCrossings[i] - smoothedCrossings[i]);
  }
  const avgCrossingDelta = totalDelta / rawCrossings.length;
  assert.ok(avgCrossingDelta < 0.15);
});

test("fixed kernel smoothing preserves finite sample count", () => {
  const values = Float32Array.from([
    Number.NaN, -3, -2, -1, 0, 1, 2, 3, Number.NaN,
  ]);
  const state = {values, writeIndex: 0, count: values.length};
  const output = new Float32Array(values.length);
  const smoothed = smoothDisplayTimeline(state, {output});

  let finiteRaw = 0;
  let finiteSmoothed = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (Number.isFinite(values[i])) finiteRaw += 1;
    if (Number.isFinite(smoothed[i])) finiteSmoothed += 1;
  }
  assert.equal(finiteSmoothed, finiteRaw);
  assert.equal(smoothed[0], values[0]);
  assert.equal(smoothed[values.length - 1], values[values.length - 1]);
});
