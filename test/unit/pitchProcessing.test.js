import {test} from "vitest";
import assert from "node:assert/strict";
import {createPitchProcessingState, processPitchSample} from "../../src/Recorder/pitchProcessing.js";

function silencePauseStepThreshold(columnRateHz, silencePauseThresholdMs) {
  return Math.max(1, Math.round((silencePauseThresholdMs / 1000) * columnRateHz));
}

function orderedValues(state) {
  return Array.from(state.rawPitchCentsRing.slice());
}

function orderedIntensities(state) {
  return Array.from(state.lineStrengthRing.slice());
}

function orderedDisplayValues(state) {
  return Array.from(state.smoothedPitchCentsRing.slice());
}

function orderedVibratoRates(state) {
  return Array.from(state.vibratoRateHzRing.slice());
}

function hzToCents(hz) {
  return 1200 * Math.log2(hz);
}

test("pitch history keeps SPS * seconds points and 60 points per 5Hz oscillation at 300 SPS", () => {
  const samplesPerSecond = 300;
  const seconds = 5;
  const state = createPitchProcessingState({
    columnRateHz: samplesPerSecond,
    seconds,
    silencePauseStepThreshold: silencePauseStepThreshold(samplesPerSecond, 300),
  });
  const vibratoRate = 5;
  const totalTicks = samplesPerSecond * seconds;
  for (let i = 1; i <= totalTicks; i += 1) {
    const t = i / samplesPerSecond;
    const cents = Math.sin(2 * Math.PI * vibratoRate * t) * 50;
    processPitchSample(state, {
      cents,
      lineStrength: 0.5,
    });
  }

  assert.equal(state.rawPitchCentsRing.sampleCount, samplesPerSecond * seconds);
  const values = orderedValues(state);
  const firstOscillation = values.slice(0, samplesPerSecond / vibratoRate);
  assert.equal(firstOscillation.length, 60);
  assert.ok(firstOscillation.every(Number.isFinite));
  const intensities = orderedIntensities(state);
  assert.ok(intensities.every((value) => value === 0.5));
});

test("columnRateHz defines pitch-history resolution when provided", () => {
  const samplesPerSecond = 1200;
  const columnRateHz = 60;
  const seconds = 5;
  const state = createPitchProcessingState({
    columnRateHz,
    seconds,
    silencePauseStepThreshold: silencePauseStepThreshold(columnRateHz, 300),
  });
  const totalColumns = columnRateHz * seconds;
  for (let i = 1; i <= totalColumns; i += 1) {
    const t = i / columnRateHz;
    const cents = Math.sin(2 * Math.PI * 5 * t) * 50;
    processPitchSample(state, {
      cents,
      lineStrength: 0.8,
    });
  }

  assert.equal(state.rawPitchCentsRing.capacity, totalColumns);
  assert.equal(state.rawPitchCentsRing.sampleCount, totalColumns);
  assert.equal(state.diagnostics.totalTickCount, totalColumns);
});

test("silence auto-pause can be disabled so pitch history keeps advancing with NaN values", () => {
  const samplesPerSecond = 100;
  const state = createPitchProcessingState({
    columnRateHz: samplesPerSecond,
    seconds: 2,
    silencePauseStepThreshold: silencePauseStepThreshold(samplesPerSecond, 300),
  });

  for (let i = 1; i <= samplesPerSecond; i += 1) {
    processPitchSample(state, {
      cents: Number.NaN,
      lineStrength: Number.NaN,
      autoPauseOnSilence: false,
    });
  }

  assert.equal(state.silencePaused, false);
  assert.equal(state.rawPitchCentsRing.sampleCount, samplesPerSecond);
  const values = orderedValues(state);
  assert.ok(values.every(Number.isNaN));
  const intensities = orderedIntensities(state);
  assert.ok(intensities.every(Number.isNaN));
});

test("silence auto-pause enabled stops pitch-history writes after threshold", () => {
  const samplesPerSecond = 100;
  const state = createPitchProcessingState({
    columnRateHz: samplesPerSecond,
    seconds: 2,
    silencePauseStepThreshold: silencePauseStepThreshold(samplesPerSecond, 300),
  });
  let pausedWrites = 0;

  for (let i = 1; i <= samplesPerSecond; i += 1) {
    const result = processPitchSample(state, {
      cents: Number.NaN,
      lineStrength: Number.NaN,
    });
    if (result.paused) pausedWrites += 1;
  }

  assert.ok(pausedWrites > 0);
  assert.equal(state.silencePaused, true);
});

test("each write keeps intensity samples aligned with pitch samples", () => {
  const state = createPitchProcessingState({
    columnRateHz: 10,
    seconds: 1,
    silencePauseStepThreshold: silencePauseStepThreshold(10, 300),
  });

  processPitchSample(state, {
    cents: 100,
    lineStrength: 0.2,
  });
  processPitchSample(state, {
    cents: 200,
    lineStrength: 0.8,
  });

  const intensities = orderedIntensities(state);
  assert.equal(intensities.length, state.lineStrengthRing.sampleCount);
  assert.equal(intensities.length, 2);
  assert.deepEqual(intensities.map((value) => Number(value.toFixed(3))), [0.2, 0.8]);
});

test("each write initializes vibrato rate to NaN", () => {
  const state = createPitchProcessingState({
    columnRateHz: 10,
    seconds: 1,
    silencePauseStepThreshold: silencePauseStepThreshold(10, 300),
  });

  processPitchSample(state, {
    cents: 100,
    lineStrength: 0.2,
  });
  processPitchSample(state, {
    cents: 200,
    lineStrength: 0.8,
  });

  const rates = orderedVibratoRates(state);
  assert.ok(rates.every(Number.isNaN));
});

test("display smoothing finalizes index i-3 as new samples arrive", () => {
  const state = createPitchProcessingState({
    columnRateHz: 20,
    seconds: 1,
    silencePauseStepThreshold: silencePauseStepThreshold(20, 300),
  });
  const series = [0, 0, 0, 10, 0, 0, 0, 0];
  for (const cents of series) {
    processPitchSample(state, {
      cents,
      lineStrength: 0.5,
    });
  }

  const raw = orderedValues(state);
  const display = orderedDisplayValues(state);
  assert.equal(raw[3], 10);
  assert.equal(Number(display[3].toFixed(2)), 3.8);
});

test("display smoothing keeps raw value when smoothing window has NaN", () => {
  const state = createPitchProcessingState({
    columnRateHz: 20,
    seconds: 1,
    silencePauseStepThreshold: silencePauseStepThreshold(20, 300),
  });
  const series = [0, 0, 0, 10, 0, Number.NaN, 0];
  for (const cents of series) {
    processPitchSample(state, {
      cents,
      lineStrength: 0.5,
      autoPauseOnSilence: false,
    });
  }

  const display = orderedDisplayValues(state);
  assert.equal(display[3], 10);
});

test("anchor outlier correction rewrites center sample (i-3) in-place", () => {
  const state = createPitchProcessingState({
    columnRateHz: 20,
    seconds: 1,
    silencePauseStepThreshold: silencePauseStepThreshold(20, 300),
  });

  const seriesHz = [100, 100, 200, 100, 100];
  for (const hz of seriesHz) {
    processPitchSample(state, {
      cents: hzToCents(hz),
      lineStrength: 0.5,
      autoPauseOnSilence: false,
    });
  }

  const raw = orderedValues(state);
  assert.equal(raw.length, 5);
  assert.ok(Math.abs(raw[2] - hzToCents(100)) < 0.1);
});
