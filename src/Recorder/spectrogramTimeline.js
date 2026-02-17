import {clamp} from "../tools.js";

export function createSpectrogramTimeline({samplesPerSecond, seconds, binCount}) {
  const columnCount = Math.max(1, Math.floor(samplesPerSecond * seconds));
  const values = new Float32Array(columnCount * binCount);
  return {
    values,
    writeIndex: 0,
    count: 0,
    columnCount,
    binCount,
  };
}

export function writeSpectrogramColumn(state, normalizedBins, steps = 1) {
  if (!state || !normalizedBins || state.binCount <= 0) return;
  const repeats = Math.max(1, Math.floor(steps));
  const binCount = state.binCount;
  const sourceBins = normalizedBins.length;
  for (let step = 0; step < repeats; step += 1) {
    const columnOffset = state.writeIndex * binCount;
    for (let bin = 0; bin < binCount; bin += 1) {
      const value = bin < sourceBins ? normalizedBins[bin] : 0;
      state.values[columnOffset + bin] = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
    }
    state.writeIndex = (state.writeIndex + 1) % state.columnCount;
    if (state.count < state.columnCount) {
      state.count += 1;
    }
  }
}
