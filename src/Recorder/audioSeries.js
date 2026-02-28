import {clamp} from "../tools.js";

function finalizeDetection(state, {
  hz,
  minHz,
  maxHz,
}) {
  const {hzBuffer} = state;
  const inHzRange = hz >= minHz && hz <= maxHz;
  const absCents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;

  if (inHzRange) {
    hzBuffer[state.hzIndex] = hz;
    state.hzIndex = (state.hzIndex + 1) % hzBuffer.length;
  }

  return {
    hz,
    cents: absCents,
  };
}

function fftBinsToPitchDetailed(spectrumBins, sampleRate, minHz, maxHz) {
  if (!spectrumBins || spectrumBins.length < 8) {
    return {hz: 0, confidence: 0};
  }
  const nyquistBin = spectrumBins.length - 1;
  const binSizeHz = (sampleRate / 2) / spectrumBins.length;
  const minBin = Math.max(1, Math.floor(minHz / binSizeHz));
  const maxBin = Math.min(nyquistBin, Math.floor(maxHz / binSizeHz));
  if (maxBin <= minBin) {
    return {hz: 0, confidence: 0};
  }

  // Set max P to the highest likely partial that the biggest peak could be.
  // With subharmonics this can easily be 7 or 8.
  // Linear-ish effect on performance
  const maxP = 10;
  // P count defines how many peaks to simulate for each hypothesis spectrum
  // That hypothesis spectrum is then compared to the real spectrum
  const pCount = 12;
  // Once a fundamental pitch has been selected, it is refined by looking
  //  at `pRefineCount` different partials
  const pRefineCount = 4;
  const offWeight = 0.5;
  const expectedP0MinRatio = 0.18;
  const expectedP0PenaltyWeight = 2.0;
  const downwardBiasPerP = 0.02;
  const searchRadiusBins = 2;

  function refineLocalPeakBinParabolic(binIndex) {
    const clampedBin = clamp(Math.round(binIndex), 1, nyquistBin - 1);
    const left = spectrumBins[clampedBin - 1];
    const mid = spectrumBins[clampedBin];
    const right = spectrumBins[clampedBin + 1];
    if (mid < left || mid < right) {
      return clampedBin;
    }
    const denominator = left - (2 * mid) + right;
    if (!Number.isFinite(denominator) || denominator === 0) {
      return clampedBin;
    }
    const offset = 0.5 * (left - right) / denominator;
    return clampedBin + clamp(offset, -1, 1);
  }

  function scoreHypothesis(f0Bin) {
    if (!Number.isFinite(f0Bin) || f0Bin < minBin || f0Bin > maxBin) {
      return {score: Number.NEGATIVE_INFINITY, p0Magnitude: 0};
    }
    let score = 0;
    let p0Magnitude = 0;
    for (let p = 1; p <= pCount; p += 1) {
      const pBin = Math.round(f0Bin * p);
      if (pBin < minBin || pBin > maxBin) break;
      const onMagnitude = spectrumBins[pBin];
      if (p === 1) {
        p0Magnitude = onMagnitude;
      }
      const offBin = Math.round(f0Bin * (p + 0.5));
      const offMagnitude = offBin >= minBin && offBin <= maxBin ? spectrumBins[offBin] : 0;
      score += onMagnitude - (offWeight * offMagnitude);
    }
    return {score, p0Magnitude};
  }

  function findTopTwoSeedPeaks() {
    const localPeaks = [];
    for (let bin = minBin + 1; bin < maxBin; bin += 1) {
      const left = spectrumBins[bin - 1];
      const center = spectrumBins[bin];
      const right = spectrumBins[bin + 1];
      if (!(center >= left && center > right)) continue;
      localPeaks.push({bin, magnitude: center});
    }
    localPeaks.sort((a, b) => b.magnitude - a.magnitude);
    if (localPeaks.length >= 2) return [localPeaks[0], localPeaks[1]];
    if (localPeaks.length === 1) return [localPeaks[0]];
    return [];
  }

  function refineF0FromPartials(baseF0Bin) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let p = 1; p <= pRefineCount; p += 1) {
      const targetBin = baseF0Bin * p;
      if (targetBin < minBin || targetBin > maxBin) break;
      const searchStart = clamp(Math.floor(targetBin) - searchRadiusBins, minBin, maxBin);
      const searchEnd = clamp(Math.ceil(targetBin) + searchRadiusBins, minBin, maxBin);
      let bestBin = searchStart;
      let bestMagnitude = Number.NEGATIVE_INFINITY;
      for (let bin = searchStart; bin <= searchEnd; bin += 1) {
        const magnitude = spectrumBins[bin];
        if (magnitude > bestMagnitude) {
          bestMagnitude = magnitude;
          bestBin = bin;
        }
      }
      const refinedPBin = refineLocalPeakBinParabolic(bestBin);
      const f0FromPBin = refinedPBin / p;
      const localBaseline = (spectrumBins[Math.max(0, bestBin - 1)] + spectrumBins[Math.min(nyquistBin, bestBin + 1)]) / 2;
      const peakiness = Math.max(0, bestMagnitude - localBaseline);
      const weight = bestMagnitude * peakiness;
      if (!(weight > 0) || !Number.isFinite(f0FromPBin)) continue;
      weightedSum += f0FromPBin * weight;
      totalWeight += weight;
    }
    if (!(totalWeight > 0)) return Number.NaN;
    return weightedSum / totalWeight;
  }

  let strongestPeakBin = minBin;
  let strongestPeakMagnitude = Number.NEGATIVE_INFINITY;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (spectrumBins[bin] > strongestPeakMagnitude) {
      strongestPeakMagnitude = spectrumBins[bin];
      strongestPeakBin = bin;
    }
  }

  const seedPeaks = findTopTwoSeedPeaks();
  if (!seedPeaks.length) {
    seedPeaks.push({bin: strongestPeakBin, magnitude: strongestPeakMagnitude});
  }
  if (seedPeaks.length === 1 && seedPeaks[0].bin !== strongestPeakBin) {
    seedPeaks.push({bin: strongestPeakBin, magnitude: strongestPeakMagnitude});
  }

  let bestP = 1;
  let bestF0Bin = strongestPeakBin;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const seedPeak of seedPeaks.slice(0, 2)) {
    for (let p = 1; p <= maxP; p += 1) {
      const f0Bin = seedPeak.bin / p;
      if (f0Bin < minBin || f0Bin > maxBin) continue;
      const {score, p0Magnitude} = scoreHypothesis(f0Bin);
      let hypothesisScore = score;
      if (p > 1) {
        const expectedP0Magnitude = seedPeak.magnitude * expectedP0MinRatio;
        const p0Deficit = Math.max(0, expectedP0Magnitude - p0Magnitude);
        hypothesisScore -= p0Deficit * expectedP0PenaltyWeight;
      }
      hypothesisScore -= p * downwardBiasPerP;
      if (hypothesisScore > bestScore) {
        bestScore = hypothesisScore;
        bestP = p;
        bestF0Bin = f0Bin;
      }
    }
  }

  const refinedF0Bin = refineF0FromPartials(bestF0Bin);
  const finalF0Bin = Number.isFinite(refinedF0Bin) ? refinedF0Bin : bestF0Bin;
  const hz = finalF0Bin * binSizeHz;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) {
    return {hz: 0, confidence: 0};
  }

  const confidence = clamp(strongestPeakMagnitude, 0, 1);
  return {
    hz,
    confidence,
    bestP,
    strongestPeakBin,
  };
}

export function analyzeAudioWindowFftPitch(
    state,
    _timeData,
    spectrumBins,
    minHz,
    maxHz
) {
  const {hzBuffer} = state;
  if (!hzBuffer || !spectrumBins || !spectrumBins.length) return null;

  const detection = fftBinsToPitchDetailed(
      spectrumBins,
      state.sampleRate,
      minHz,
      maxHz
  );

  const result = finalizeDetection(state, {
    hz: detection.hz,
    minHz,
    maxHz,
  });
  return {
    ...result,
    confidence: detection.confidence,
  };
}
