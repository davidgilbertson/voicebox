const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];

function wrapIndex(length, index) {
  const wrapped = index % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

function updateDisplaySmoothingAtWrite(state) {
  if (state.count < (SMOOTH_RADIUS * 2) + 1) return;
  const length = state.values.length;
  const newestIndex = wrapIndex(length, state.writeIndex - 1);
  const targetIndex = wrapIndex(length, newestIndex - SMOOTH_RADIUS);

  let smoothed = 0;
  for (let offset = -SMOOTH_RADIUS; offset <= SMOOTH_RADIUS; offset += 1) {
    const sample = state.values[wrapIndex(length, targetIndex + offset)];
    if (!Number.isFinite(sample)) {
      return;
    }
    smoothed += sample * SMOOTH_KERNEL[offset + SMOOTH_RADIUS];
  }
  state.displayValues[targetIndex] = smoothed;
}

export function createPitchTimeline({
  columnRateHz,
  seconds,
  silencePauseStepThreshold,
}) {
  const length = Math.max(1, Math.floor(columnRateHz * seconds));
  const values = new Float32Array(length);
  const displayValues = new Float32Array(length);
  const intensities = new Float32Array(length);
  const vibratoRates = new Float32Array(length);
  values.fill(Number.NaN);
  displayValues.fill(Number.NaN);
  intensities.fill(Number.NaN);
  vibratoRates.fill(Number.NaN);
  return {
    values,
    displayValues,
    intensities,
    vibratoRates,
    writeIndex: 0,
    count: 0,
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
  const writeIndex = state.writeIndex;
  state.values[writeIndex] = value;
  state.displayValues[writeIndex] = value;
  state.intensities[writeIndex] = intensity;
  state.vibratoRates[writeIndex] = Number.NaN;
  state.writeIndex = (writeIndex + 1) % state.values.length;
  if (state.count < state.values.length) {
    state.count += 1;
  }
  updateDisplaySmoothingAtWrite(state);
  return writeIndex;
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
    return {steps: 0, paused: true, lastWriteIndex: null};
  }

  const hasPitch = Number.isFinite(cents);
  const value = hasPitch ? cents : Number.NaN;
  const nextIntensity = hasPitch ? intensity : Number.NaN;
  const lastWriteIndex = pushValue(state, value, nextIntensity);
  return {steps: 1, paused: false, lastWriteIndex};
}

function extractOrderedValues(buffer, writeIndex, count) {
  if (count <= 0) return new Float32Array(0);
  const totalLength = buffer.length;
  const firstIndex = count === totalLength ? writeIndex : 0;
  const ordered = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    ordered[i] = buffer[(firstIndex + i) % totalLength];
  }
  return ordered;
}

export function resizePitchTimeline(state, nextLength) {
  if (!state) return;
  const targetLength = Math.max(1, Math.floor(nextLength));
  const currentLength = state.values.length;
  if (targetLength === currentLength) return;

  const nextValues = new Float32Array(targetLength);
  const nextDisplayValues = new Float32Array(targetLength);
  const nextIntensities = new Float32Array(targetLength);
  const nextVibratoRates = new Float32Array(targetLength);
  nextValues.fill(Number.NaN);
  nextDisplayValues.fill(Number.NaN);
  nextIntensities.fill(Number.NaN);
  nextVibratoRates.fill(Number.NaN);

  if (state.count > 0) {
    const orderedValues = extractOrderedValues(state.values, state.writeIndex, state.count);
    const orderedDisplayValues = extractOrderedValues(state.displayValues, state.writeIndex, state.count);
    const orderedIntensities = extractOrderedValues(state.intensities, state.writeIndex, state.count);
    const orderedVibratoRates = extractOrderedValues(state.vibratoRates, state.writeIndex, state.count);
    const nextCount = Math.min(targetLength, state.count);
    const start = orderedValues.length - nextCount;
    nextValues.set(orderedValues.subarray(start), 0);
    nextDisplayValues.set(orderedDisplayValues.subarray(start), 0);
    nextIntensities.set(orderedIntensities.subarray(start), 0);
    nextVibratoRates.set(orderedVibratoRates.subarray(start), 0);
    state.count = nextCount;
    state.writeIndex = nextCount === targetLength ? 0 : nextCount;
  } else {
    state.count = 0;
    state.writeIndex = 0;
  }

  state.values = nextValues;
  state.displayValues = nextDisplayValues;
  state.intensities = nextIntensities;
  state.vibratoRates = nextVibratoRates;
}
