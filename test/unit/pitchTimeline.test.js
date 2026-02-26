import {test} from "vitest";
import assert from "node:assert/strict";
import {createPitchTimeline, writePitchTimeline} from "../../src/Recorder/pitchTimeline.js";

function silencePauseStepThreshold(columnRateHz, silencePauseThresholdMs) {
  return Math.max(1, Math.round((silencePauseThresholdMs / 1000) * columnRateHz));
}

function orderedValues(state) {
  const values = [];
  const firstIndex = state.count === state.values.length ? state.writeIndex : 0;
  for (let i = 0; i < state.count; i += 1) {
    values.push(state.values[(firstIndex + i) % state.values.length]);
  }
  return values;
}

function orderedIntensities(state) {
  const intensities = [];
  const firstIndex = state.count === state.intensities.length ? state.writeIndex : 0;
  for (let i = 0; i < state.count; i += 1) {
    intensities.push(state.intensities[(firstIndex + i) % state.intensities.length]);
  }
  return intensities;
}

test("timeline keeps SPS * seconds points and 60 points per 5Hz oscillation at 300 SPS", () => {
  const samplesPerSecond = 300;
  const seconds = 5;
  const state = createPitchTimeline({
    columnRateHz: samplesPerSecond,
    seconds,
    silencePauseStepThreshold: silencePauseStepThreshold(samplesPerSecond, 300),
  });
  const vibratoRate = 5;
  const totalTicks = samplesPerSecond * seconds;
  for (let i = 1; i <= totalTicks; i += 1) {
    const t = i / samplesPerSecond;
    const cents = Math.sin(2 * Math.PI * vibratoRate * t) * 50;
    writePitchTimeline(state, {
      cents,
      intensity: 0.5,
    });
  }

  assert.equal(state.count, samplesPerSecond * seconds);
  const values = orderedValues(state);
  const firstOscillation = values.slice(0, samplesPerSecond / vibratoRate);
  assert.equal(firstOscillation.length, 60);
  assert.ok(firstOscillation.every(Number.isFinite));
  const intensities = orderedIntensities(state);
  assert.ok(intensities.every((value) => value === 0.5));
});

test("columnRateHz defines timeline resolution when provided", () => {
  const samplesPerSecond = 1200;
  const columnRateHz = 60;
  const seconds = 5;
  const state = createPitchTimeline({
    columnRateHz,
    seconds,
    silencePauseStepThreshold: silencePauseStepThreshold(columnRateHz, 300),
  });
  const totalColumns = columnRateHz * seconds;
  for (let i = 1; i <= totalColumns; i += 1) {
    const t = i / columnRateHz;
    const cents = Math.sin(2 * Math.PI * 5 * t) * 50;
    writePitchTimeline(state, {
      cents,
      intensity: 0.8,
    });
  }

  assert.equal(state.values.length, totalColumns);
  assert.equal(state.count, totalColumns);
  assert.equal(state.diagnostics.totalTickCount, totalColumns);
});

test("silence auto-pause can be disabled so timeline keeps advancing with NaN values", () => {
  const samplesPerSecond = 100;
  const state = createPitchTimeline({
    columnRateHz: samplesPerSecond,
    seconds: 2,
    silencePauseStepThreshold: silencePauseStepThreshold(samplesPerSecond, 300),
  });

  for (let i = 1; i <= samplesPerSecond; i += 1) {
    writePitchTimeline(state, {
      cents: Number.NaN,
      intensity: Number.NaN,
      autoPauseOnSilence: false,
    });
  }

  assert.equal(state.silencePaused, false);
  assert.equal(state.count, samplesPerSecond);
  const values = orderedValues(state);
  assert.ok(values.every(Number.isNaN));
  const intensities = orderedIntensities(state);
  assert.ok(intensities.every(Number.isNaN));
});

test("silence auto-pause enabled stops writes after threshold", () => {
  const samplesPerSecond = 100;
  const state = createPitchTimeline({
    columnRateHz: samplesPerSecond,
    seconds: 2,
    silencePauseStepThreshold: silencePauseStepThreshold(samplesPerSecond, 300),
  });
  let pausedWrites = 0;

  for (let i = 1; i <= samplesPerSecond; i += 1) {
    const result = writePitchTimeline(state, {
      cents: Number.NaN,
      intensity: Number.NaN,
    });
    if (result.paused) pausedWrites += 1;
  }

  assert.ok(pausedWrites > 0);
  assert.equal(state.silencePaused, true);
});

test("each write keeps intensity samples aligned with pitch samples", () => {
  const state = createPitchTimeline({
    columnRateHz: 10,
    seconds: 1,
    silencePauseStepThreshold: silencePauseStepThreshold(10, 300),
  });

  writePitchTimeline(state, {
    cents: 100,
    intensity: 0.2,
  });
  writePitchTimeline(state, {
    cents: 200,
    intensity: 0.8,
  });

  const intensities = orderedIntensities(state);
  assert.equal(intensities.length, state.count);
  assert.equal(intensities.length, 2);
  assert.deepEqual(intensities.map((value) => Number(value.toFixed(3))), [0.2, 0.8]);
});
