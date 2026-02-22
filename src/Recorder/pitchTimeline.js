export function createPitchTimeline({
  columnRateHz,
  samplesPerSecond,
  seconds,
  silencePauseStepThreshold,
  silencePauseThresholdMs,
  autoPauseOnSilence = true,
}) {
  const resolvedColumnRateHz = Number.isFinite(columnRateHz) && columnRateHz > 0
      ? columnRateHz
      : Number.isFinite(samplesPerSecond) && samplesPerSecond > 0
          ? samplesPerSecond
          : 1;
  const resolvedSilencePauseStepThreshold = Number.isFinite(silencePauseStepThreshold) && silencePauseStepThreshold > 0
      ? silencePauseStepThreshold
      : Number.isFinite(silencePauseThresholdMs) && silencePauseThresholdMs > 0
          ? Math.max(1, Math.round((silencePauseThresholdMs / 1000) * resolvedColumnRateHz))
          : 1;
  const length = Math.max(1, Math.floor(resolvedColumnRateHz * seconds));
  const values = new Float32Array(length);
  const levels = new Float32Array(length);
  values.fill(Number.NaN);
  levels.fill(Number.NaN);
  return {
    values,
    levels,
    writeIndex: 0,
    count: 0,
    columnRateHz: resolvedColumnRateHz,
    samplesPerSecond: resolvedColumnRateHz,
    seconds,
    silencePauseStepThreshold: Math.max(1, Math.floor(resolvedSilencePauseStepThreshold)),
    autoPauseOnSilence,
    silentStepCount: 0,
    silencePaused: false,
    diagnostics: {
      totalTickCount: 0,
    },
  };
}

function pushValue(state, value, level) {
  state.values[state.writeIndex] = value;
  state.levels[state.writeIndex] = level;
  state.writeIndex = (state.writeIndex + 1) % state.values.length;
  if (state.count < state.values.length) {
    state.count += 1;
  }
}

export function writePitchTimeline(state, {
  cents,
  level = Number.NaN,
  hasSignal = Number.isFinite(cents),
}) {
  const autoPauseOnSilence = state.autoPauseOnSilence !== false;
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
  const nextLevel = hasPitch ? level : Number.NaN;
  pushValue(state, value, nextLevel);
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
  const nextLevels = new Float32Array(targetLength);
  nextValues.fill(Number.NaN);
  nextLevels.fill(Number.NaN);

  if (state.count > 0) {
    const orderedValues = extractOrderedValues(state.values, state.writeIndex, state.count);
    const orderedLevels = extractOrderedValues(state.levels, state.writeIndex, state.count);
    const nextCount = Math.min(targetLength, state.count);
    const start = orderedValues.length - nextCount;
    nextValues.set(orderedValues.subarray(start), 0);
    nextLevels.set(orderedLevels.subarray(start), 0);
    state.count = nextCount;
    state.writeIndex = nextCount === targetLength ? 0 : nextCount;
  } else {
    state.count = 0;
    state.writeIndex = 0;
  }

  state.values = nextValues;
  state.levels = nextLevels;
  state.seconds = targetLength / state.columnRateHz;
}
