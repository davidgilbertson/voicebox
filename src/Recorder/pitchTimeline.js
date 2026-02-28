import {RingBuffer} from "./ringBuffer.js";

const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];

function updateDisplaySmoothingAtWrite(state) {
  const rawPitchCentsRing = state.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < (SMOOTH_RADIUS * 2) + 1) return;

  let smoothed = 0;
  for (let offset = -SMOOTH_RADIUS; offset <= SMOOTH_RADIUS; offset += 1) {
    const sample = rawPitchCentsRing.fromNewest(SMOOTH_RADIUS - offset);
    if (!Number.isFinite(sample)) {
      return;
    }
    smoothed += sample * SMOOTH_KERNEL[offset + SMOOTH_RADIUS];
  }
  state.smoothedPitchCentsRing.setAt(-(SMOOTH_RADIUS + 1), smoothed);
}

export function createPitchTimeline({
  columnRateHz,
  seconds,
  silencePauseStepThreshold,
}) {
  const length = Math.max(1, Math.floor(columnRateHz * seconds));
  const rawPitchCentsRing = new RingBuffer(length);
  const smoothedPitchCentsRing = new RingBuffer(length);
  const signalStrengthRing = new RingBuffer(length);
  const vibratoRateHzRing = new RingBuffer(length);
  return {
    rawPitchCentsRing,
    smoothedPitchCentsRing,
    signalStrengthRing,
    vibratoRateHzRing,
    columnRateHz,
    silencePauseStepThreshold,
    silentStepCount: 0,
    silencePaused: false,
    diagnostics: {
      totalTickCount: 0,
    },
  };
}

function pushValue(state, value, intensity) {
  state.rawPitchCentsRing.push(value);
  state.smoothedPitchCentsRing.push(value);
  state.signalStrengthRing.push(intensity);
  state.vibratoRateHzRing.push(Number.NaN);
  updateDisplaySmoothingAtWrite(state);
}

export function writePitchTimeline(state, {
  cents,
  intensity = Number.NaN,
  hasSignal = Number.isFinite(cents),
  autoPauseOnSilence = true,
}) {
  if (autoPauseOnSilence) {
    if (hasSignal) {
      state.silencePaused = false;
      state.silentStepCount = 0;
    } else {
      state.silentStepCount += 1;
    }
    if (state.silentStepCount >= state.silencePauseStepThreshold) {
      state.silencePaused = true;
    }
  } else {
    state.silencePaused = false;
    state.silentStepCount = 0;
  }

  state.diagnostics.totalTickCount += 1;

  if (state.silencePaused) {
    return {steps: 0, paused: true};
  }

  const hasPitch = Number.isFinite(cents);
  const value = hasPitch ? cents : Number.NaN;
  const nextIntensity = hasPitch ? intensity : Number.NaN;
  pushValue(state, value, nextIntensity);
  return {steps: 1, paused: false};
}

export function resizePitchTimeline(state, nextLength) {
  if (!state) return;
  state.rawPitchCentsRing.resize(nextLength);
  state.smoothedPitchCentsRing.resize(nextLength);
  state.signalStrengthRing.resize(nextLength);
  state.vibratoRateHzRing.resize(nextLength);
}
