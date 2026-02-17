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
      hasVoice: true,
      cents,
    });
  }

  assert.equal(state.count, samplesPerSecond * seconds);
  const values = orderedValues(state);
  const firstOscillation = values.slice(0, samplesPerSecond / vibratoRateHz);
  assert.equal(firstOscillation.length, 60);
  assert.ok(firstOscillation.every(Number.isFinite));
});

test("very high SPS with slow analysis cadence produces heavy backfill", () => {
  const samplesPerSecond = 1200;
  const seconds = 5;
  const state = createPitchTimeline({
    samplesPerSecond,
    seconds,
    silencePauseThresholdMs: 300,
    nowMs: 0,
  });
  const analysisHz = 60;
  const frameMs = 1000 / analysisHz;
  const totalFrames = seconds * analysisHz;
  for (let i = 1; i <= totalFrames; i += 1) {
    const t = i / analysisHz;
    const cents = Math.sin(2 * Math.PI * 5 * t) * 50;
    writePitchTimeline(state, {
      nowMs: i * frameMs,
      hasVoice: true,
      cents,
    });
  }

  assert.equal(state.count, samplesPerSecond * seconds);
  assert.ok(state.diagnostics.backfillTickCount > 0);
  assert.ok(state.diagnostics.maxFillSteps >= 10);
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
      hasVoice: false,
      cents: Number.NaN,
    });
  }

  assert.equal(state.silencePaused, false);
  assert.equal(state.count, samplesPerSecond);
  const values = orderedValues(state);
  assert.ok(values.every(Number.isNaN));
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
      hasVoice: false,
      cents: Number.NaN,
    });
    if (result.paused) pausedWrites += 1;
  }

  assert.ok(pausedWrites > 0);
  assert.equal(state.silencePaused, true);
});
