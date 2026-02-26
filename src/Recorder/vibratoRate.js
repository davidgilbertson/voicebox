function orderedTimelineValues(values, writeIndex, count) {
  const ordered = [];
  const total = values.length;
  const firstIndex = count === total ? writeIndex : 0;
  for (let i = 0; i < count; i += 1) {
    ordered.push(values[(firstIndex + i) % total]);
  }
  return ordered;
}

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
