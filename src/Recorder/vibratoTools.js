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
                              ring,
                              samplesPerSecond,
                              analysisWindowSeconds,
                              minContinuousSeconds,
                            }) {
  if (!ring || ring.sampleCount <= 0 || samplesPerSecond <= 0) return null;
  const values = ring.values();
  const maxSamples = Math.max(1, Math.floor(samplesPerSecond * analysisWindowSeconds));
  const tail = contiguousFiniteTail(values, maxSamples);
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
  // Keep slope probe aligned with the first extrema candidate index (length - 3).
  let expectedType = centered[centered.length - 2] - centered[centered.length - 3] >= 0 ? "trough" : "peak";
  const extrema = [];
  let peakCount = 0;
  let troughCount = 0;
  let index = centered.length - 3;
  while (index >= 2 && (peakCount < 2 || troughCount < 2)) {
    const left2 = centered[index - 2];
    const left1 = centered[index - 1];
    const value = centered[index];
    const right1 = centered[index + 1];
    const right2 = centered[index + 2];
    if (expectedType === "trough") {
      const isTrough = value <= left2
          && value <= left1
          && value <= right1
          && value <= right2
          && (value < left2 || value < left1 || value < right1 || value < right2);
      if (isTrough) {
        extrema.push({type: "trough", index});
        troughCount += 1;
        expectedType = "peak";
        // Skip one sample to avoid duplicate detections on flat bottoms.
        index -= 2;
        continue;
      }
    } else {
      const isPeak = value >= left2
          && value >= left1
          && value >= right1
          && value >= right2
          && (value > left2 || value > left1 || value > right1 || value > right2);
      if (isPeak) {
        extrema.push({type: "peak", index});
        peakCount += 1;
        expectedType = "trough";
        // Skip one sample to avoid duplicate detections on flat tops.
        index -= 2;
        continue;
      }
    }
    index -= 1;
  }

  if (peakCount < 2 || troughCount < 2 || extrema.length < 4) return null;
  const leg1 = extrema[0].index - extrema[1].index;
  const leg2 = extrema[1].index - extrema[2].index;
  const leg3 = extrema[2].index - extrema[3].index;
  if (!(leg1 > 0 && leg2 > 0 && leg3 > 0)) return null;
  const legSamples = (leg1 + leg2 + leg3) / 3;
  let minInWindow = Number.POSITIVE_INFINITY;
  let maxInWindow = Number.NEGATIVE_INFINITY;
  for (const value of centered) {
    if (value < minInWindow) minInWindow = value;
    if (value > maxInWindow) maxInWindow = value;
  }
  if ((maxInWindow - minInWindow) < 12) return null;
  const rateHz = samplesPerSecond / (legSamples * 2);
  return Number.isFinite(rateHz) ? rateHz : null;
}

export function estimateTimelineVibratoRate({
                                              ring = null,
                                              samplesPerSecond,
                                              minRateHz = 4,
                                              maxRateHz = 10,
                                              analysisWindowSeconds = 2.5,
                                              minContinuousSeconds = 0.6,
                                            }) {
  const tailData = centeredFiniteTail({
    ring,
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

export function estimateTimelineCenterCents({
                                              ring = null,
                                              detectionAlphas = null,
                                              recentSampleCount = 160,
                                            }) {
  if (!ring || ring.sampleCount <= 0) return null;
  const start = Math.max(0, ring.sampleCount - Math.max(1, Math.floor(recentSampleCount)));
  let sum = 0;
  let finiteCount = 0;
  for (let i = start; i < ring.sampleCount; i += 1) {
    if (detectionAlphas && detectionAlphas[i] < 0.99) continue;
    const value = ring.at(i);
    if (!Number.isFinite(value)) continue;
    sum += value;
    finiteCount += 1;
  }
  if (finiteCount === 0) return null;
  return sum / finiteCount;
}
