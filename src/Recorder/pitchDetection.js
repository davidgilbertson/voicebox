import { clamp } from "../tools.js";

function finalizeDetection(detectionState, { hz, minHz, maxHz }) {
  const { hzBuffer } = detectionState;
  const inHzRange = hz >= minHz && hz <= maxHz;
  const cents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;

  if (inHzRange) {
    hzBuffer[detectionState.hzIndex] = hz;
    detectionState.hzIndex = (detectionState.hzIndex + 1) % hzBuffer.length;
  }

  return cents;
}

function fftBinsToPitch(spectrumBins, sampleRate, minHz, maxHz) {
  if (!spectrumBins || spectrumBins.length < 8) {
    return Number.NaN;
  }
  const nyquistBin = spectrumBins.length - 1;
  const binSizeHz = sampleRate / 2 / spectrumBins.length;
  const minBin = Math.max(1, Math.floor(minHz / binSizeHz));
  const maxBin = Math.min(nyquistBin, Math.floor(maxHz / binSizeHz));
  if (maxBin <= minBin) return Number.NaN;

  function detectPeakiness() {
    const epsilon = 1e-12;
    const count = spectrumBins.length - 1;
    const invCount = 1 / count;
    let logSum = 0;
    let linearSum = 0;
    for (let i = 1; i < spectrumBins.length; i += 1) {
      const magnitude = spectrumBins[i];
      const safeMagnitude = magnitude > epsilon ? magnitude : epsilon;
      logSum += Math.log(safeMagnitude);
      linearSum += safeMagnitude;
    }
    const flatness = Math.exp(logSum * invCount) / (linearSum * invCount);
    return 1 - flatness;
  }

  if (detectPeakiness() < 0.8) return Number.NaN;

  // Set max P to the highest likely partial that the biggest peak could be.
  // With subharmonics I've seen 13.
  // Linear-ish effect on performance
  const maxP = 15;
  // P count defines how many peaks to simulate for each hypothesis spectrum
  // That hypothesis spectrum is then compared to the real spectrum
  // Logically this should be >= maxP (think about it!)
  const pCount = 17;
  // Once a fundamental pitch has been selected, it is refined by looking
  //  at `pRefineCount` different partials
  const pRefineCount = 4;
  const offWeight = 1.25;
  const expectedP0MinRatio = 0.05;
  const expectedP0PenaltyWeight = 2;
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
    const denominator = left - 2 * mid + right;
    if (!Number.isFinite(denominator) || denominator === 0) {
      return clampedBin;
    }
    const offset = (0.5 * (left - right)) / denominator;
    return clampedBin + clamp(offset, -1, 1);
  }

  function sampleMagnitude3Bin(binPosition) {
    if (!Number.isFinite(binPosition)) return 0;
    const centerBin = clamp(Math.round(binPosition), 1, nyquistBin - 1);
    const frac = clamp(binPosition - centerBin, -1, 1);
    const left = spectrumBins[centerBin - 1];
    const mid = spectrumBins[centerBin];
    const right = spectrumBins[centerBin + 1];
    return mid + 0.5 * frac * (right - left) + 0.5 * frac * frac * (left - 2 * mid + right);
  }

  function scoreHypothesis(f0Bin) {
    if (!Number.isFinite(f0Bin) || f0Bin < minBin || f0Bin > maxBin) {
      return { score: Number.NEGATIVE_INFINITY, p0Magnitude: 0 };
    }
    let score = 0;
    let p0Magnitude = 0;
    for (let p = 1; p <= pCount; p += 1) {
      const pBin = f0Bin * p;
      if (pBin < minBin || pBin > maxBin) break;
      const onMagnitude = sampleMagnitude3Bin(pBin);
      if (p === 1) {
        p0Magnitude = onMagnitude;
      }
      const offBin = f0Bin * (p + 0.5);
      const offMagnitude = offBin >= minBin && offBin <= maxBin ? sampleMagnitude3Bin(offBin) : 0;
      score += onMagnitude - offWeight * offMagnitude;
    }
    return { score, p0Magnitude };
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
      const localBaseline =
        (spectrumBins[Math.max(0, bestBin - 1)] + spectrumBins[Math.min(nyquistBin, bestBin + 1)]) /
        2;
      const peakiness = Math.max(0, bestMagnitude - localBaseline);
      const weight = bestMagnitude * peakiness;
      if (!(weight > 0) || !Number.isFinite(f0FromPBin)) continue;
      weightedSum += f0FromPBin * weight;
      totalWeight += weight;
    }
    if (!(totalWeight > 0)) return Number.NaN;
    return weightedSum / totalWeight;
  }

  // We look for a 'peak' - a bin with larger magnitude than the bins on either side
  // In the unlikely event we don't find one, we return the largest value
  let topLocalPeakBin = -1;
  let topLocalPeakMagnitude = Number.NEGATIVE_INFINITY;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const magnitude = spectrumBins[bin];
    if (bin <= minBin || bin >= maxBin) continue;
    const left = spectrumBins[bin - 1];
    const right = spectrumBins[bin + 1];
    // Plateau tie-break: >= on the left and > on the right selects the rightmost bin.
    if (!(magnitude >= left && magnitude > right)) continue;
    if (magnitude > topLocalPeakMagnitude) {
      topLocalPeakMagnitude = magnitude;
      topLocalPeakBin = bin;
    }
  }
  if (topLocalPeakBin < 0) return Number.NaN;

  let bestF0Bin = topLocalPeakBin;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let p = 1; p <= maxP; p += 1) {
    const f0Bin = topLocalPeakBin / p;
    if (f0Bin < minBin || f0Bin > maxBin) continue;
    const { score, p0Magnitude } = scoreHypothesis(f0Bin);
    let hypothesisScore = score;
    if (p > 1) {
      const expectedP0Magnitude = topLocalPeakMagnitude * expectedP0MinRatio;
      const p0Deficit = Math.max(0, expectedP0Magnitude - p0Magnitude);
      hypothesisScore -= p0Deficit * expectedP0PenaltyWeight;
    }
    hypothesisScore -= p * downwardBiasPerP;
    if (hypothesisScore > bestScore) {
      bestScore = hypothesisScore;
      bestF0Bin = f0Bin;
    }
  }

  const refinedF0Bin = refineF0FromPartials(bestF0Bin);
  const finalF0Bin = Number.isFinite(refinedF0Bin) ? refinedF0Bin : bestF0Bin;
  const hz = finalF0Bin * binSizeHz;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) {
    return Number.NaN;
  }

  return hz;
}

export function getPitchFromSpectrum(detectionState, spectrumBins, minHz, maxHz) {
  const { hzBuffer } = detectionState;
  if (!hzBuffer || !spectrumBins || !spectrumBins.length) return Number.NaN;

  const hz = fftBinsToPitch(spectrumBins, detectionState.sampleRate, minHz, maxHz);

  return finalizeDetection(detectionState, {
    hz,
    minHz,
    maxHz,
  });
}
