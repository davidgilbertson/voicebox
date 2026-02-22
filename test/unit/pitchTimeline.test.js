import {test} from "vitest";
import assert from "node:assert/strict";
import {createPitchTimeline, writePitchTimeline} from "../../src/Recorder/pitchTimeline.js";

function orderedValues(state) {
  const values = [];
  const firstIndex = state.count === state.values.length ? state.writeIndex : 0;
  for (let i = 0; i < state.count; i += 1) {
    values.push(state.values[(firstIndex + i) % state.values.length]);
  }
  return values;
}

function orderedLevels(state) {
  const levels = [];
  const firstIndex = state.count === state.levels.length ? state.writeIndex : 0;
  for (let i = 0; i < state.count; i += 1) {
    levels.push(state.levels[(firstIndex + i) % state.levels.length]);
  }
  return levels;
}

test("timeline keeps SPS * seconds points and 60 points per 5Hz oscillation at 300 SPS", () => {
  const samplesPerSecond = 300;
  const seconds = 5;
  const state = createPitchTimeline({
    samplesPerSecond,
    seconds,
    silencePauseThresholdMs: 300,
    nowMs: 0,
  });
  const stepMs = 1000 / samplesPerSecond;
  const vibratoRateHz = 5;
  const totalTicks = samplesPerSecond * seconds;
  for (let i = 1; i <= totalTicks; i += 1) {
    const t = i / samplesPerSecond;
    const cents = Math.sin(2 * Math.PI * vibratoRateHz * t) * 50;
    writePitchTimeline(state, {
      nowMs: i * stepMs,
      cents,
      level: 0.5,
    });
  }

  assert.equal(state.count, samplesPerSecond * seconds);
  const values = orderedValues(state);
  const firstOscillation = values.slice(0, samplesPerSecond / vibratoRateHz);
  assert.equal(firstOscillation.length, 60);
  assert.ok(firstOscillation.every(Number.isFinite));
  const levels = orderedLevels(state);
  assert.ok(levels.every((value) => value === 0.5));
});

test("columnRateHz defines timeline resolution when provided", () => {
  const samplesPerSecond = 1200;
  const columnRateHz = 60;
  const seconds = 5;
  const state = createPitchTimeline({
    columnRateHz,
    samplesPerSecond,
    seconds,
    silencePauseThresholdMs: 300,
  });
  const totalColumns = columnRateHz * seconds;
  for (let i = 1; i <= totalColumns; i += 1) {
    const t = i / columnRateHz;
    const cents = Math.sin(2 * Math.PI * 5 * t) * 50;
    writePitchTimeline(state, {
      cents,
      level: 0.8,
    });
  }

  assert.equal(state.values.length, totalColumns);
  assert.equal(state.count, totalColumns);
  assert.equal(state.diagnostics.totalTickCount, totalColumns);
});

test("silence auto-pause can be disabled so timeline keeps advancing with NaN values", () => {
  const samplesPerSecond = 100;
  const state = createPitchTimeline({
    samplesPerSecond,
    seconds: 2,
    silencePauseThresholdMs: 300,
    autoPauseOnSilence: false,
    nowMs: 0,
  });
  const stepMs = 1000 / samplesPerSecond;

  for (let i = 1; i <= samplesPerSecond; i += 1) {
    writePitchTimeline(state, {
      nowMs: i * stepMs,
      cents: Number.NaN,
      level: Number.NaN,
    });
  }

  assert.equal(state.silencePaused, false);
  assert.equal(state.count, samplesPerSecond);
  const values = orderedValues(state);
  assert.ok(values.every(Number.isNaN));
  const levels = orderedLevels(state);
  assert.ok(levels.every(Number.isNaN));
});

test("silence auto-pause enabled stops writes after threshold", () => {
  const samplesPerSecond = 100;
  const state = createPitchTimeline({
    samplesPerSecond,
    seconds: 2,
    silencePauseThresholdMs: 300,
    autoPauseOnSilence: true,
    nowMs: 0,
  });
  const stepMs = 1000 / samplesPerSecond;
  let pausedWrites = 0;

  for (let i = 1; i <= samplesPerSecond; i += 1) {
    const result = writePitchTimeline(state, {
      nowMs: i * stepMs,
      cents: Number.NaN,
      level: Number.NaN,
    });
    if (result.paused) pausedWrites += 1;
  }

  assert.ok(pausedWrites > 0);
  assert.equal(state.silencePaused, true);
});

test("each write keeps level samples aligned with pitch samples", () => {
  const state = createPitchTimeline({
    samplesPerSecond: 10,
    seconds: 1,
    silencePauseThresholdMs: 300,
  });

  writePitchTimeline(state, {
    cents: 100,
    level: 0.2,
  });
  writePitchTimeline(state, {
    cents: 200,
    level: 0.8,
  });

  const levels = orderedLevels(state);
  assert.equal(levels.length, state.count);
  assert.equal(levels.length, 2);
  assert.deepEqual(levels.map((value) => Number(value.toFixed(3))), [0.2, 0.8]);
});
