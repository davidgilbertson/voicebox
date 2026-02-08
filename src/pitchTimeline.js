import {interpolateFillValues} from "./seriesFill.js";
import {consumeTimelineElapsed} from "./timelineSteps.js";

export function createPitchTimeline({
  samplesPerSecond,
  seconds,
  silencePauseThresholdMs,
  autoPauseOnSilence = true,
  nowMs,
}) {
  const length = Math.max(1, Math.floor(samplesPerSecond * seconds));
  const values = new Float32Array(length);
  values.fill(Number.NaN);
  return {
    values,
    writeIndex: 0,
    count: 0,
    samplesPerSecond,
    seconds,
    silencePauseThresholdMs,
    autoPauseOnSilence,
    lastWrittenValue: Number.NaN,
    silenceSinceMs: null,
    silencePaused: false,
    writeClockMs: nowMs,
    accumulator: 0,
    diagnostics: {
      lastFillSteps: 0,
      maxFillSteps: 0,
      backfillTickCount: 0,
      totalTickCount: 0,
    },
  };
}

function pushValue(state, value) {
  state.values[state.writeIndex] = value;
  state.writeIndex = (state.writeIndex + 1) % state.values.length;
  if (state.count < state.values.length) {
    state.count += 1;
  }
}

export function writePitchTimeline(state, {nowMs, hasVoice, cents}) {
  const autoPauseOnSilence = state.autoPauseOnSilence !== false;
  if (autoPauseOnSilence) {
    if (hasVoice) {
      state.silencePaused = false;
      state.silenceSinceMs = null;
    } else if (state.silenceSinceMs === null) {
      state.silenceSinceMs = nowMs;
    } else if (nowMs - state.silenceSinceMs >= state.silencePauseThresholdMs) {
      state.silencePaused = true;
    }
  } else {
    state.silencePaused = false;
    state.silenceSinceMs = null;
  }

  state.diagnostics.totalTickCount += 1;

  if (state.silencePaused) {
    state.writeClockMs = nowMs;
    state.accumulator = 0;
    state.lastWrittenValue = Number.NaN;
    state.diagnostics.lastFillSteps = 0;
    return {steps: 0, paused: true};
  }

  const elapsedMs = nowMs - state.writeClockMs;
  state.writeClockMs = nowMs;
  const stepResult = consumeTimelineElapsed(
      elapsedMs,
      state.samplesPerSecond,
      state.accumulator
  );
  state.accumulator = stepResult.accumulator;
  const steps = stepResult.steps;
  state.diagnostics.lastFillSteps = steps;
  if (steps > state.diagnostics.maxFillSteps) {
    state.diagnostics.maxFillSteps = steps;
  }
  if (steps > 1) {
    state.diagnostics.backfillTickCount += 1;
  }
  if (steps <= 0) {
    return {steps: 0, paused: false};
  }

  const value = hasVoice ? cents : Number.NaN;
  const fillValues = interpolateFillValues(state.lastWrittenValue, value, steps);
  for (const fillValue of fillValues) {
    pushValue(state, fillValue);
  }
  state.lastWrittenValue = value;
  return {steps, paused: false};
}
