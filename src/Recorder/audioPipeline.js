export function createRawAudioBuffer(sampleRate, {
  windowSize,
  fftSize,
  rawBufferSeconds,
} = {}) {
  const safeWindowSize = Number.isFinite(windowSize) && windowSize > 0
      ? Math.floor(windowSize)
      : Number.isFinite(fftSize) && fftSize > 0
          ? Math.floor(fftSize)
          : 2048;
  const safeRawBufferSeconds = Number.isFinite(rawBufferSeconds) && rawBufferSeconds > 0
      ? rawBufferSeconds
      : 8;
  const capacity = Math.max(safeWindowSize * 2, Math.floor(sampleRate * safeRawBufferSeconds));
  return {
    values: new Float32Array(capacity),
    writeIndex: 0,
    readIndex: 0,
    size: 0,
  };
}

export function enqueueAudioSamples(rawBuffer, chunk) {
  if (!rawBuffer || !chunk?.length) return 0;
  let dropped = 0;
  for (let i = 0; i < chunk.length; i += 1) {
    rawBuffer.values[rawBuffer.writeIndex] = chunk[i];
    rawBuffer.writeIndex = (rawBuffer.writeIndex + 1) % rawBuffer.values.length;
    if (rawBuffer.size < rawBuffer.values.length) {
      rawBuffer.size += 1;
    } else {
      rawBuffer.readIndex = (rawBuffer.readIndex + 1) % rawBuffer.values.length;
      dropped += 1;
    }
  }
  return dropped;
}

export function createAnalysisState(sampleRate, {
  windowSize,
  fftSize,
  samplesPerSecond,
} = {}) {
  const safeWindowSize = Number.isFinite(windowSize) && windowSize > 0
      ? Math.floor(windowSize)
      : Number.isFinite(fftSize) && fftSize > 0
          ? Math.floor(fftSize)
          : 2048;
  const safeSamplesPerSecond = Number.isFinite(samplesPerSecond) && samplesPerSecond > 0
      ? samplesPerSecond
      : 200;
  return {
    sampleRate,
    hopSize: sampleRate / safeSamplesPerSecond,
    hopAccumulator: 0,
    processedSamples: 0,
    windowValues: new Float32Array(safeWindowSize),
    windowIndex: 0,
    windowCount: 0,
    scratch: new Float32Array(safeWindowSize),
  };
}

function copyAnalysisWindowToScratch(analysisState) {
  if (analysisState.windowCount < analysisState.windowValues.length) return null;
  const start = analysisState.windowIndex;
  const size = analysisState.windowValues.length;
  const tailLength = size - start;
  analysisState.scratch.set(analysisState.windowValues.subarray(start), 0);
  analysisState.scratch.set(analysisState.windowValues.subarray(0, start), tailLength);
  return analysisState.scratch;
}

export function drainRawBuffer(rawBuffer, analysisState, onWindowReady) {
  if (!rawBuffer || !analysisState || typeof onWindowReady !== "function") return 0;
  let emitted = 0;

  while (rawBuffer.size > 0) {
    const sample = rawBuffer.values[rawBuffer.readIndex];
    rawBuffer.readIndex = (rawBuffer.readIndex + 1) % rawBuffer.values.length;
    rawBuffer.size -= 1;

    analysisState.windowValues[analysisState.windowIndex] = sample;
    analysisState.windowIndex = (analysisState.windowIndex + 1) % analysisState.windowValues.length;
    if (analysisState.windowCount < analysisState.windowValues.length) {
      analysisState.windowCount += 1;
    }
    analysisState.processedSamples += 1;
    analysisState.hopAccumulator += 1;

    if (analysisState.hopAccumulator < analysisState.hopSize) {
      continue;
    }
    analysisState.hopAccumulator -= analysisState.hopSize;

    const windowSamples = copyAnalysisWindowToScratch(analysisState);
    if (!windowSamples) continue;

    const nowMs = (analysisState.processedSamples / analysisState.sampleRate) * 1000;
    onWindowReady(windowSamples, nowMs);
    emitted += 1;
  }

  return emitted;
}
