export function createPitchTimeline({
  columnRateHz,
  seconds,
  silencePauseStepThreshold,
}) {
  const length = Math.max(1, Math.floor(columnRateHz * seconds));
  const values = new Float32Array(length);
  const intensities = new Float32Array(length);
  values.fill(Number.NaN);
  intensities.fill(Number.NaN);
  return {
    values,
    intensities,
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
  state.values[state.writeIndex] = value;
  state.intensities[state.writeIndex] = intensity;
  state.writeIndex = (state.writeIndex + 1) % state.values.length;
  if (state.count < state.values.length) {
    state.count += 1;
  }
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
  const nextIntensities = new Float32Array(targetLength);
  nextValues.fill(Number.NaN);
  nextIntensities.fill(Number.NaN);

  if (state.count > 0) {
    const orderedValues = extractOrderedValues(state.values, state.writeIndex, state.count);
    const orderedIntensities = extractOrderedValues(state.intensities, state.writeIndex, state.count);
    const nextCount = Math.min(targetLength, state.count);
    const start = orderedValues.length - nextCount;
    nextValues.set(orderedValues.subarray(start), 0);
    nextIntensities.set(orderedIntensities.subarray(start), 0);
    state.count = nextCount;
    state.writeIndex = nextCount === targetLength ? 0 : nextCount;
  } else {
    state.count = 0;
    state.writeIndex = 0;
  }

  state.values = nextValues;
  state.intensities = nextIntensities;
}
