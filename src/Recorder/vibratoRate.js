function orderedTimelineValues(values, writeIndex, count) {
  const ordered = [];
  const total = values.length;
  const firstIndex = count === total ? writeIndex : 0;
  for (let i = 0; i < count; i += 1) {
    ordered.push(values[(firstIndex + i) % total]);
  }
  return ordered;
}

const NON_VIBRATO_ALPHA = 0.25;

function contiguousFiniteTail(values, maxSamples) {
  const tail = [];
  for (let i = values.length - 1; i >= 0 && tail.length < maxSamples; i -= 1) {
    const value = values[i];
    if (!Number.isFinite(value)) break;
    tail.push(value);
  }
  tail.reverse();
  return tail;
}

function centeredFiniteTail({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  analysisWindowSeconds,
  minContinuousSeconds,
}) {
  if (!values || count <= 0 || samplesPerSecond <= 0) return null;

  const ordered = orderedTimelineValues(values, writeIndex, count);
  const maxSamples = Math.max(1, Math.floor(samplesPerSecond * analysisWindowSeconds));
  const tail = contiguousFiniteTail(ordered, maxSamples);
  const minSamples = Math.max(8, Math.floor(samplesPerSecond * minContinuousSeconds));
  if (tail.length < minSamples) return null;

  let sum = 0;
  for (const value of tail) {
    sum += value;
  }
  const mean = sum / tail.length;

  const centered = new Array(tail.length);
  let sumSquares = 0;
  for (let i = 0; i < tail.length; i += 1) {
    const delta = tail[i] - mean;
    centered[i] = delta;
    sumSquares += delta * delta;
  }
  const rms = Math.sqrt(sumSquares / centered.length);
  return {
    centered,
    rms,
  };
}

function rateFromLastTwoPeaks(centered, samplesPerSecond) {
  if (!centered || centered.length < 5) return null;

  const peakIndices = [];
  const troughIndices = [];
  for (let i = 2; i < centered.length - 2; i += 1) {
    // 5-point peak shape. Same idea as the experiment code, but without debug payloads/logging.
    const isPeakShape = centered[i - 2] < centered[i - 1]
      && centered[i - 1] < centered[i]
      && centered[i] > centered[i + 1]
      && centered[i + 1] > centered[i + 2];
    const isTroughShape = centered[i - 2] > centered[i - 1]
      && centered[i - 1] > centered[i]
      && centered[i] < centered[i + 1]
      && centered[i + 1] < centered[i + 2];
    if (isPeakShape) peakIndices.push(i);
    if (isTroughShape) troughIndices.push(i);
  }

  const slopeLookback = Math.min(6, centered.length - 1);
  const endSlope = centered[centered.length - 1] - centered[centered.length - 1 - slopeLookback];
  const selected = endSlope >= 0 ? troughIndices : peakIndices;
  if (selected.length < 2) return null;

  const firstIndex = selected[selected.length - 2];
  const secondIndex = selected[selected.length - 1];
  const spacingSamples = secondIndex - firstIndex;
  if (!(spacingSamples > 0)) return null;

  let minInWindow = Number.POSITIVE_INFINITY;
  let maxInWindow = Number.NEGATIVE_INFINITY;
  for (let i = firstIndex; i <= secondIndex; i += 1) {
    const value = centered[i];
    if (value < minInWindow) minInWindow = value;
    if (value > maxInWindow) maxInWindow = value;
  }
  // Ignore tiny motion; this generally does not sound like intentional vibrato.
  if ((maxInWindow - minInWindow) < 12) return null;

  const rateHz = samplesPerSecond / spacingSamples;
  return Number.isFinite(rateHz) ? rateHz : null;
}

export function estimateTimelineVibratoRate({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  minRateHz = 4,
  maxRateHz = 10,
  analysisWindowSeconds = 2.5,
  minContinuousSeconds = 0.6,
}) {
  const tailData = centeredFiniteTail({
    values,
    writeIndex,
    count,
    samplesPerSecond,
    analysisWindowSeconds,
    minContinuousSeconds,
  });
  if (!tailData) return null;
  if (tailData.rms < 5) return null;

  const rateHz = rateFromLastTwoPeaks(tailData.centered, samplesPerSecond);
  if (!Number.isFinite(rateHz)) return null;
  if (rateHz < minRateHz || rateHz > maxRateHz) return null;
  return rateHz;
}

function computeRunDetectionAlphas({
  orderedValues,
  orderedIndices,
  runStart,
  runEnd,
  samplesPerSecond,
  minRateHz,
  maxRateHz,
  analysisWindowSeconds,
  minContinuousSeconds,
  output,
  onDetectedRate = null,
}) {
  const maxSamples = Math.max(1, Math.floor(samplesPerSecond * analysisWindowSeconds));
  const minSamples = Math.max(8, Math.floor(samplesPerSecond * minContinuousSeconds));
  const runLength = runEnd - runStart + 1;
  const prefixSum = new Float64Array(runLength + 1);
  const prefixSquares = new Float64Array(runLength + 1);
  for (let i = 0; i < runLength; i += 1) {
    const value = orderedValues[runStart + i];
    prefixSum[i + 1] = prefixSum[i] + value;
    prefixSquares[i + 1] = prefixSquares[i] + (value * value);
  }

  let detectedInRun = false;
  for (let i = runStart; i <= runEnd; i += 1) {
    const runOffset = i - runStart;
    const windowStart = Math.max(0, runOffset - maxSamples + 1);
    const windowLength = runOffset - windowStart + 1;
    let detectedNow = false;
    if (windowLength >= minSamples) {
      const sum = prefixSum[runOffset + 1] - prefixSum[windowStart];
      const mean = sum / windowLength;
      const sumSquares = prefixSquares[runOffset + 1] - prefixSquares[windowStart];
      const meanSquares = sumSquares / windowLength;
      const variance = Math.max(0, meanSquares - (mean * mean));
      const rms = Math.sqrt(variance);
      if (rms >= 5) {
        const centered = new Float32Array(windowLength);
        for (let j = 0; j < windowLength; j += 1) {
          centered[j] = orderedValues[runStart + windowStart + j] - mean;
        }
        const rateHz = rateFromLastTwoPeaks(centered, samplesPerSecond);
        detectedNow = Number.isFinite(rateHz) && rateHz >= minRateHz && rateHz <= maxRateHz;
        if (detectedNow && onDetectedRate) {
          onDetectedRate(rateHz);
        }
      }
    }
    if (detectedNow) {
      detectedInRun = true;
    }
    output[orderedIndices[i]] = detectedInRun ? 1 : NON_VIBRATO_ALPHA;
  }
}

export function computeTimelineVibratoDetectionAlpha({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  minRateHz = 4,
  maxRateHz = 10,
  analysisWindowSeconds = 2.5,
  minContinuousSeconds = 0.6,
  output,
}) {
  if (!values || values.length === 0) return values;
  if (!output || output.length !== values.length) {
    output = new Float32Array(values.length);
  }
  output.fill(NON_VIBRATO_ALPHA);
  if (count <= 0 || samplesPerSecond <= 0) return output;

  const totalSlots = values.length;
  const firstIndex = count === totalSlots ? writeIndex : 0;
  const orderedValues = new Float32Array(count);
  const orderedIndices = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    const bufferIndex = (firstIndex + i) % totalSlots;
    orderedIndices[i] = bufferIndex;
    orderedValues[i] = values[bufferIndex];
  }

  let runStart = -1;
  for (let i = 0; i < count; i += 1) {
    if (Number.isFinite(orderedValues[i])) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      computeRunDetectionAlphas({
        orderedValues,
        orderedIndices,
        runStart,
        runEnd: i - 1,
        samplesPerSecond,
        minRateHz,
        maxRateHz,
        analysisWindowSeconds,
        minContinuousSeconds,
        output,
      });
      runStart = -1;
    }
  }

  if (runStart !== -1) {
    computeRunDetectionAlphas({
      orderedValues,
      orderedIndices,
      runStart,
      runEnd: count - 1,
      samplesPerSecond,
      minRateHz,
      maxRateHz,
      analysisWindowSeconds,
      minContinuousSeconds,
      output,
    });
  }

  return output;
}

export function estimateLastKnownTimelineVibratoRate({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  minRateHz = 4,
  maxRateHz = 10,
  analysisWindowSeconds = 2.5,
  minContinuousSeconds = 0.6,
}) {
  if (!values || count <= 0 || samplesPerSecond <= 0) return null;
  const alphaBuffer = new Float32Array(values.length);
  let lastDetectedRateHz = null;
  const totalSlots = values.length;
  const firstIndex = count === totalSlots ? writeIndex : 0;
  const orderedValues = new Float32Array(count);
  const orderedIndices = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    const bufferIndex = (firstIndex + i) % totalSlots;
    orderedIndices[i] = bufferIndex;
    orderedValues[i] = values[bufferIndex];
  }

  let runStart = -1;
  for (let i = 0; i < count; i += 1) {
    if (Number.isFinite(orderedValues[i])) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      computeRunDetectionAlphas({
        orderedValues,
        orderedIndices,
        runStart,
        runEnd: i - 1,
        samplesPerSecond,
        minRateHz,
        maxRateHz,
        analysisWindowSeconds,
        minContinuousSeconds,
        output: alphaBuffer,
        onDetectedRate: (rateHz) => {
          lastDetectedRateHz = rateHz;
        },
      });
      runStart = -1;
    }
  }

  if (runStart !== -1) {
    computeRunDetectionAlphas({
      orderedValues,
      orderedIndices,
      runStart,
      runEnd: count - 1,
      samplesPerSecond,
      minRateHz,
      maxRateHz,
      analysisWindowSeconds,
      minContinuousSeconds,
      output: alphaBuffer,
      onDetectedRate: (rateHz) => {
        lastDetectedRateHz = rateHz;
      },
    });
  }

  return lastDetectedRateHz;
}

export function estimateTimelineCenterCents({
  values,
  writeIndex,
  count,
  detectionAlphas = null,
  recentSampleCount = 160,
}) {
  if (!values || count <= 0) return null;
  const firstIndex = count === values.length ? writeIndex : 0;
  const start = Math.max(0, count - Math.max(1, Math.floor(recentSampleCount)));
  let sum = 0;
  let finiteCount = 0;
  for (let i = start; i < count; i += 1) {
    const index = (firstIndex + i) % values.length;
    if (detectionAlphas && detectionAlphas[index] < 0.99) continue;
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    sum += value;
    finiteCount += 1;
  }
  if (finiteCount === 0) return null;
  return sum / finiteCount;
}
