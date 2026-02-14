import {createWindowSpectrumComputer} from "./browserSpectrum.js";

export const FFT_HARMONIC_COMB_METHOD = "fftHarmonicComb";
// export const AUDIO_PATH = "./assets/david_vocals.wav";
export const AUDIO_PATH = "./assets/david_vocals2.wav";
// export const AUDIO_PATH = "./assets/david_vocals_vibrato.wav";
// export const AUDIO_PATH = "./assets/opera-vocals_129bpm_F_minor.wav";
// export const AUDIO_PATH = "./assets/opera-female-vocals_140bpm_A_major.wav";
export const FFT_BIN_COUNT = 4096;
export const WINDOW_SIZE = 2048;
export const SAMPLES_PER_SECOND = 200;
export const MIN_HZ = 65.406; // C2
export const MAX_HZ = 2093.005; // C7
export const RMS_MIN = 0.01;
const AUTOCORR_CONFIDENCE_MIN = 0.25;
let autocorrScratch = new Float64Array(0);

// ********** TERMINOLOGY ********** //
// p = partial, which includes the fundamental + the harmonic series. It's the peaks.
// p0 = f0, p1 = h1, etc.
// ********************************* //


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hzToBinIndex(freqHz, binSizeHz) {
  return freqHz / binSizeHz;
}

function sampleMagnitudeLinear(magnitudes, fractionalBinIndex) {
  const leftBinIndex = Math.floor(fractionalBinIndex);
  if (leftBinIndex < 0 || leftBinIndex >= magnitudes.length - 1) {
    return 0;
  }
  const rightBinIndex = leftBinIndex + 1;
  const mix = fractionalBinIndex - leftBinIndex;
  const left = magnitudes[leftBinIndex];
  const right = magnitudes[rightBinIndex];
  return left + ((right - left) * mix);
}

function sampleMagnitudeAtHz(magnitudes, freqHz, binSizeHz) {
  return sampleMagnitudeLinear(magnitudes, hzToBinIndex(freqHz, binSizeHz));
}

function refineLocalPeakBinParabolic(magnitudes, binIndex) {
  if (!Number.isFinite(binIndex)) return Number.NaN;
  const nyquistBin = magnitudes.length - 1;
  const clampedBin = clamp(Math.round(binIndex), 1, nyquistBin - 1);
  const left = magnitudes[clampedBin - 1];
  const mid = magnitudes[clampedBin];
  const right = magnitudes[clampedBin + 1];
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

function refineF0FromPartials({
                                magnitudes,
                                binSizeHz,
                                minBin,
                                maxBin,
                                baseF0Bin,
                                pCount = 4,
                                searchRadiusBins = 2,
                              } = {}) {
  if (!Number.isFinite(baseF0Bin) || baseF0Bin <= 0) {
    return {refinedF0Hz: Number.NaN, refinedF0Bin: Number.NaN, partials: [], totalWeight: 0};
  }
  const nyquistBin = magnitudes.length - 1;
  let weightedSum = 0;
  let totalWeight = 0;
  const partials = [];

  for (let p = 1; p <= pCount; p += 1) {
    const targetBin = baseF0Bin * p;
    if (targetBin < minBin || targetBin > maxBin) break;
    const searchStart = clamp(Math.floor(targetBin) - searchRadiusBins, minBin, maxBin);
    const searchEnd = clamp(Math.ceil(targetBin) + searchRadiusBins, minBin, maxBin);

    let bestBin = searchStart;
    let bestMagnitude = Number.NEGATIVE_INFINITY;
    for (let bin = searchStart; bin <= searchEnd; bin += 1) {
      const magnitude = magnitudes[bin];
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestBin = bin;
      }
    }

    const refinedPBin = refineLocalPeakBinParabolic(magnitudes, bestBin);
    if (!Number.isFinite(refinedPBin) || refinedPBin <= 0 || refinedPBin >= nyquistBin) {
      continue;
    }
    const refinedPHz = refinedPBin * binSizeHz;
    const f0FromPHz = refinedPHz / p;
    if (!Number.isFinite(f0FromPHz) || f0FromPHz <= 0) continue;

    const localBaseline = (magnitudes[Math.max(0, bestBin - 1)] + magnitudes[Math.min(nyquistBin, bestBin + 1)]) / 2;
    const peakiness = Math.max(0, bestMagnitude - localBaseline);
    const weight = bestMagnitude * peakiness;
    if (!(weight > 0)) continue;

    weightedSum += f0FromPHz * weight;
    totalWeight += weight;
    partials.push({
      p,
      targetBin,
      bestBin,
      refinedPBin,
      refinedPHz,
      f0FromPHz,
      peakMagnitude: bestMagnitude,
      peakiness,
      weight,
    });
  }

  if (totalWeight <= 0) {
    return {refinedF0Hz: Number.NaN, refinedF0Bin: Number.NaN, partials, totalWeight};
  }
  const refinedF0Hz = weightedSum / totalWeight;
  const refinedF0Bin = refinedF0Hz / binSizeHz;
  return {refinedF0Hz, refinedF0Bin, partials, totalWeight};
}

function detectPitchAutocorrDetailed(data, sampleRate, minHz, maxHz) {
  const size = data.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) {
    const value = data[i];
    rms += value * value;
  }
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return {hz: 0, corrRatio: 0};
  const energy = rms * rms * size;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  const requiredSize = maxLag + 1;
  if (autocorrScratch.length < requiredSize) {
    autocorrScratch = new Float64Array(requiredSize);
  }

  let bestLag = 0;
  let bestCorr = 0;
  const correlations = autocorrScratch;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i < size - lag; i += 1) {
      corr += data[i] * data[i + lag];
    }
    correlations[lag] = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (!bestLag) return {hz: 0, corrRatio: 0};
  const corrRatio = energy > 0 ? bestCorr / energy : 0;
  if (corrRatio < AUTOCORR_CONFIDENCE_MIN) return {hz: 0, corrRatio};

  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = correlations[bestLag - 1];
    const mid = correlations[bestLag];
    const right = correlations[bestLag + 1];
    const denominator = left - (2 * mid) + right;
    if (denominator !== 0) {
      const offset = 0.5 * (left - right) / denominator;
      if (Number.isFinite(offset)) {
        refinedLag = bestLag + clamp(offset, -1, 1);
      }
    }
  }
  if (!Number.isFinite(refinedLag) || refinedLag <= 0) return {hz: 0, corrRatio};
  return {hz: sampleRate / refinedLag, corrRatio};
}

function computeFreqCandidateScoresV0(magnitudes, minBin, maxBin, binSizeHz, context = {}) {
  const nyquistBin = magnitudes.length - 1;
  const candidateScores = new Float64Array(nyquistBin + 1);
  const analysisWindow = context.analysisWindow;
  const sampleRate = context.sampleRate;
  const minHz = context.minHz ?? MIN_HZ;
  const maxHz = context.maxHz ?? MAX_HZ;
  if (!analysisWindow || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return {candidateScores, predictedBinIndex: null, debug: null};
  }

  const detection = detectPitchAutocorrDetailed(analysisWindow, sampleRate, minHz, maxHz);
  if (!Number.isFinite(detection.hz) || detection.hz <= 0) {
    return {
      candidateScores,
      predictedBinIndex: null,
      debug: {
        autocorrHz: null,
        corrRatio: detection.corrRatio,
      },
    };
  }

  const predictedBinIndex = clamp(Math.round(hzToBinIndex(detection.hz, binSizeHz)), minBin, maxBin);
  candidateScores[predictedBinIndex] = detection.corrRatio;
  return {
    candidateScores,
    predictedBinIndex,
    debug: {
      autocorrHz: detection.hz,
      corrRatio: detection.corrRatio,
    },
  };
}

export function predictF0(values, {
  tol = 1.5,
  maxDivisor = 8,
  minInliers = 2,
  minValue = 0,
} = {}) {
  const xs = [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))]
      .sort((a, b) => a - b);
  if (xs.length < 2) return Number.NaN;

  const candidates = new Set();
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const diff = xs[j] - xs[i];
      if (diff <= tol) continue;
      for (let divisor = 1; divisor <= maxDivisor; divisor += 1) {
        const candidate = diff / divisor;
        if (candidate > tol) {
          candidates.add(candidate);
        }
      }
    }
  }

  function distanceToNearestMultiple(value, gcdCandidate) {
    const multiple = Math.max(1, Math.round(value / gcdCandidate));
    return Math.abs(value - (multiple * gcdCandidate));
  }

  let bestGcd = Number.NaN;
  let bestInliers = -1;
  let bestError = Number.POSITIVE_INFINITY;
  for (const gcdCandidate of candidates) {
    if (gcdCandidate < minValue) continue;
    let inliers = 0;
    let error = 0;
    for (const value of xs) {
      const distance = distanceToNearestMultiple(value, gcdCandidate);
      if (distance <= tol) {
        inliers += 1;
      }
      error += Math.min(distance, tol);
    }
    if (
        inliers > bestInliers ||
        (inliers === bestInliers && gcdCandidate > bestGcd) ||
        (inliers === bestInliers && gcdCandidate === bestGcd && error < bestError)
    ) {
      bestGcd = gcdCandidate;
      bestInliers = inliers;
      bestError = error;
    }
  }
  if (bestInliers >= minInliers) {
    return bestGcd;
  }

  let smallestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const gap = Math.abs(xs[j] - xs[i]);
      if (gap < smallestGap) {
        smallestGap = gap;
      }
    }
  }
  const smallestValue = xs[0];
  const fallback = Math.min(smallestGap, smallestValue);
  return Number.isFinite(fallback) ? fallback : Number.NaN;
}

function computeFreqCandidateScoresV1(magnitudes, minBin, maxBin) {
  const nyquistBin = magnitudes.length - 1;
  let totalMagnitude = 0;
  for (let bin = 0; bin <= nyquistBin; bin += 1) {
    totalMagnitude += magnitudes[bin];
  }
  const globalMean = totalMagnitude / (nyquistBin + 1);

  const candidateScores = new Float64Array(nyquistBin + 1);
  for (let candidateBin = minBin; candidateBin <= maxBin; candidateBin += 1) {
    let multiplesMagnitude = 0;
    let multiplesCount = 0;
    for (let harmonicBin = candidateBin; harmonicBin <= nyquistBin; harmonicBin += candidateBin) {
      multiplesMagnitude += magnitudes[harmonicBin];
      multiplesCount += 1;
    }
    candidateScores[candidateBin] = multiplesMagnitude - (multiplesCount * globalMean);
  }
  return candidateScores;
}

function computeFreqCandidateScoresV2(magnitudes, minBin, maxBin) {
  function refinePeakBinParabolic(binIndex) {
    if (binIndex <= 0 || binIndex >= magnitudes.length - 1) {
      return binIndex;
    }
    const left = magnitudes[binIndex - 1];
    const mid = magnitudes[binIndex];
    const right = magnitudes[binIndex + 1];
    const denominator = left - (2 * mid) + right;
    if (denominator === 0) {
      return binIndex;
    }
    const offset = 0.5 * (left - right) / denominator;
    return binIndex + clamp(offset, -1, 1);
  }

  const nyquistBin = magnitudes.length - 1;
  let totalMagnitude = 0;
  for (let bin = 0; bin <= nyquistBin; bin += 1) {
    totalMagnitude += magnitudes[bin];
  }
  const globalMean = totalMagnitude / (nyquistBin + 1);

  const candidateScores = new Float64Array(nyquistBin + 1);
  for (let candidateBin = minBin; candidateBin <= maxBin; candidateBin += 1) {
    const refinedCandidateBin = refinePeakBinParabolic(candidateBin);
    if (!Number.isFinite(refinedCandidateBin) || refinedCandidateBin <= 0) {
      candidateScores[candidateBin] = Number.NEGATIVE_INFINITY;
      continue;
    }
    let multiplesMagnitude = 0;
    let multiplesCount = 0;
    for (let harmonic = 1; harmonic <= nyquistBin; harmonic += 1) {
      const harmonicBin = refinedCandidateBin * harmonic;
      if (harmonicBin > nyquistBin) {
        break;
      }
      multiplesMagnitude += sampleMagnitudeLinear(magnitudes, harmonicBin);
      multiplesCount += 1;
    }
    candidateScores[candidateBin] = multiplesMagnitude - (multiplesCount * globalMean);
  }
  return candidateScores;
}

function computeFreqCandidateScoresV3(magnitudes, minBin, maxBin, binSizeHz) {
  const nyquistBin = magnitudes.length - 1;
  const candidateScores = new Float64Array(nyquistBin + 1);
  const windowRadiusBins = 4;
  const centerRadiusBins = 1;
  const flatThresholdRatio = 0.1;
  const peakScoreThresholdRatio = 0.2;
  // Harmonics for voiced pitch should be separated by at least MIN_HZ.
  // Use this spacing both to merge too-close local maxima and to reject tiny GCD candidates.
  const minHarmonicSpacingBins = Math.max(2, Math.ceil(MIN_HZ / binSizeHz));

  let maxMagnitude = 0;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (magnitudes[bin] > maxMagnitude) {
      maxMagnitude = magnitudes[bin];
    }
  }
  const flatThreshold = maxMagnitude * flatThresholdRatio;
  let firstEnergyBin = minBin;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (magnitudes[bin] >= flatThreshold) {
      firstEnergyBin = bin;
      break;
    }
  }
  const lastFlatBin = Math.max(minBin, firstEnergyBin - 1);
  const leadingFlatBins = Math.max(0, lastFlatBin - minBin);
  const adaptiveMinSpacingBins = Math.max(minHarmonicSpacingBins, leadingFlatBins);

  function refinePeakBinForPrediction(binIndex) {
    const leftBin = Math.max(1, binIndex - 1);
    const centerBin = clamp(binIndex, 1, nyquistBin - 1);
    const rightBin = Math.min(nyquistBin - 1, binIndex + 1);
    let anchorBin = centerBin;
    if (magnitudes[leftBin] > magnitudes[anchorBin]) {
      anchorBin = leftBin;
    }
    if (magnitudes[rightBin] > magnitudes[anchorBin]) {
      anchorBin = rightBin;
    }
    const left = magnitudes[anchorBin - 1];
    const mid = magnitudes[anchorBin];
    const right = magnitudes[anchorBin + 1];
    if (mid < left || mid < right) {
      return anchorBin;
    }
    const denominator = left - (2 * mid) + right;
    if (!Number.isFinite(denominator) || denominator === 0) {
      return anchorBin;
    }
    const offset = 0.5 * (left - right) / denominator;
    return anchorBin + clamp(offset, -1, 1);
  }

  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const candidateHz = bin * binSizeHz;
    let centerSum = 0;
    let centerCount = 0;
    for (let offset = -centerRadiusBins; offset <= centerRadiusBins; offset += 1) {
      centerSum += sampleMagnitudeAtHz(magnitudes, candidateHz + (offset * binSizeHz), binSizeHz);
      centerCount += 1;
    }
    const centerMean = centerCount > 0 ? centerSum / centerCount : 0;

    let leftOuterSum = 0;
    let leftOuterCount = 0;
    for (let offset = -windowRadiusBins; offset <= -centerRadiusBins - 1; offset += 1) {
      leftOuterSum += sampleMagnitudeAtHz(magnitudes, candidateHz + (offset * binSizeHz), binSizeHz);
      leftOuterCount += 1;
    }
    const leftOuterMean = leftOuterCount > 0 ? leftOuterSum / leftOuterCount : 0;

    let rightOuterSum = 0;
    let rightOuterCount = 0;
    for (let offset = centerRadiusBins + 1; offset <= windowRadiusBins; offset += 1) {
      rightOuterSum += sampleMagnitudeAtHz(magnitudes, candidateHz + (offset * binSizeHz), binSizeHz);
      rightOuterCount += 1;
    }
    const rightOuterMean = rightOuterCount > 0 ? rightOuterSum / rightOuterCount : 0;
    const surroundMean = (leftOuterMean + rightOuterMean) / 2;
    candidateScores[bin] = centerMean - surroundMean;
  }

  const localPeakBins = [];
  for (let bin = minBin + 1; bin <= maxBin - 1; bin += 1) {
    const score = candidateScores[bin];
    if (score <= 0) continue;
    if (score > candidateScores[bin - 1] && score >= candidateScores[bin + 1]) {
      localPeakBins.push(bin);
    }
  }

  localPeakBins.sort((left, right) => candidateScores[right] - candidateScores[left]);
  const strongestPeakScore = localPeakBins.length > 0 ? candidateScores[localPeakBins[0]] : 0;
  const peakScoreThreshold = strongestPeakScore * peakScoreThresholdRatio;
  const topPeakBins = [];
  for (const peakBin of localPeakBins) {
    const peakScore = candidateScores[peakBin];
    if (peakScore < peakScoreThreshold) {
      continue;
    }
    const tooClose = topPeakBins.some((selectedBin) => (
        Math.abs(selectedBin - peakBin) < adaptiveMinSpacingBins
    ));
    if (tooClose) continue;
    topPeakBins.push(peakBin);
  }

  function hasSpacingViolation(bins, minSpacingBins) {
    for (let i = 0; i < bins.length; i += 1) {
      for (let j = i + 1; j < bins.length; j += 1) {
        if (Math.abs(bins[i] - bins[j]) < minSpacingBins) {
          return true;
        }
      }
    }
    return false;
  }

  if (hasSpacingViolation(topPeakBins, adaptiveMinSpacingBins)) {
    throw new Error("Internal invariant failed: topPeakBins includes peaks that are too close");
  }

  function getSmallestPairwiseGapBins(bins) {
    if (bins.length < 2) return Number.NaN;
    let smallestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < bins.length; i += 1) {
      for (let j = i + 1; j < bins.length; j += 1) {
        const gap = Math.abs(bins[i] - bins[j]);
        if (gap < smallestGap) {
          smallestGap = gap;
        }
      }
    }
    return Number.isFinite(smallestGap) ? smallestGap : Number.NaN;
  }

  const topPeakRefinedBins = topPeakBins.map((bin) => refinePeakBinForPrediction(bin));
  const smallestPairwiseGapBins = getSmallestPairwiseGapBins(topPeakRefinedBins);
  let predictedBinIndex = null;
  let predictedF0Bin = Number.NaN;
  let predictedHz = Number.NaN;
  let fallbackReason = null;
  if (topPeakRefinedBins.length >= 2) {
    predictedF0Bin = predictF0(topPeakRefinedBins, {minValue: adaptiveMinSpacingBins});
    if (Number.isFinite(predictedF0Bin)) {
      predictedBinIndex = clamp(Math.round(predictedF0Bin), minBin, maxBin);
      predictedHz = predictedF0Bin * binSizeHz;
    }
  }
  if (predictedBinIndex === null && topPeakRefinedBins.length > 0) {
    const lowestPeakBin = Math.min(...topPeakRefinedBins);
    predictedBinIndex = clamp(Math.round(lowestPeakBin), minBin, maxBin);
    predictedHz = lowestPeakBin * binSizeHz;
    fallbackReason = "single selected peak, used that peak";
  }

  return {
    candidateScores,
    predictedBinIndex,
    predictedHz: Number.isFinite(predictedHz) ? predictedHz : null,
    debug: {
      minHarmonicSpacingBins,
      adaptiveMinSpacingBins,
      flatThresholdRatio,
      peakScoreThresholdRatio,
      peakScoreThreshold,
      flatThreshold,
      firstEnergyBin,
      firstEnergyHz: firstEnergyBin * binSizeHz,
      lastFlatBin,
      lastFlatHz: lastFlatBin * binSizeHz,
      topPeakBins,
      topPeakHz: topPeakBins.map((bin) => bin * binSizeHz),
      topPeakRefinedBins,
      topPeakRefinedHz: topPeakRefinedBins.map((bin) => bin * binSizeHz),
      smallestPairwiseGapBins: Number.isFinite(smallestPairwiseGapBins) ? smallestPairwiseGapBins : null,
      smallestPairwiseGapHz: Number.isFinite(smallestPairwiseGapBins) ? smallestPairwiseGapBins * binSizeHz : null,
      predictedF0Bin: Number.isFinite(predictedF0Bin) ? predictedF0Bin : null,
      predictedF0Hz: Number.isFinite(predictedF0Bin) ? predictedF0Bin * binSizeHz : null,
      predictedHz: Number.isFinite(predictedBinIndex) ? predictedBinIndex * binSizeHz : null,
      fallbackReason,
    },
  };
}

function computeFreqCandidateScoresV4(magnitudes, minBin, maxBin, binSizeHz) {
  const nyquistBin = magnitudes.length - 1;
  const candidateScores = new Float64Array(nyquistBin + 1);
  const windowRadiusBins = 4;
  const centerRadiusBins = 1;
  const flatThresholdRatio = 0.1;
  const peakScoreThresholdRatio = 0.2;
  const minHarmonicSpacingBins = Math.max(2, Math.ceil(MIN_HZ / binSizeHz));
  const peakSelectionMinSpacingBins = minHarmonicSpacingBins;
  const harmonicCount = 4;
  const harmonicSearchRadiusBins = 2;

  let maxMagnitude = 0;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (magnitudes[bin] > maxMagnitude) {
      maxMagnitude = magnitudes[bin];
    }
  }
  const flatThreshold = maxMagnitude * flatThresholdRatio;
  let firstEnergyBin = minBin;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (magnitudes[bin] >= flatThreshold) {
      firstEnergyBin = bin;
      break;
    }
  }
  const lastFlatBin = Math.max(minBin, firstEnergyBin - 1);
  const leadingFlatBins = Math.max(0, lastFlatBin - minBin);
  const adaptiveMinSpacingBins = Math.max(minHarmonicSpacingBins, leadingFlatBins);

  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const candidateHz = bin * binSizeHz;
    let centerSum = 0;
    let centerCount = 0;
    for (let offset = -centerRadiusBins; offset <= centerRadiusBins; offset += 1) {
      centerSum += sampleMagnitudeAtHz(magnitudes, candidateHz + (offset * binSizeHz), binSizeHz);
      centerCount += 1;
    }
    const centerMean = centerCount > 0 ? centerSum / centerCount : 0;

    let leftOuterSum = 0;
    let leftOuterCount = 0;
    for (let offset = -windowRadiusBins; offset <= -centerRadiusBins - 1; offset += 1) {
      leftOuterSum += sampleMagnitudeAtHz(magnitudes, candidateHz + (offset * binSizeHz), binSizeHz);
      leftOuterCount += 1;
    }
    const leftOuterMean = leftOuterCount > 0 ? leftOuterSum / leftOuterCount : 0;

    let rightOuterSum = 0;
    let rightOuterCount = 0;
    for (let offset = centerRadiusBins + 1; offset <= windowRadiusBins; offset += 1) {
      rightOuterSum += sampleMagnitudeAtHz(magnitudes, candidateHz + (offset * binSizeHz), binSizeHz);
      rightOuterCount += 1;
    }
    const rightOuterMean = rightOuterCount > 0 ? rightOuterSum / rightOuterCount : 0;
    const surroundMean = (leftOuterMean + rightOuterMean) / 2;
    candidateScores[bin] = centerMean - surroundMean;
  }

  const localPeakBins = [];
  for (let bin = minBin + 1; bin <= maxBin - 1; bin += 1) {
    const score = candidateScores[bin];
    if (score <= 0) continue;
    if (score > candidateScores[bin - 1] && score >= candidateScores[bin + 1]) {
      localPeakBins.push(bin);
    }
  }

  localPeakBins.sort((left, right) => candidateScores[right] - candidateScores[left]);
  const strongestPeakScore = localPeakBins.length > 0 ? candidateScores[localPeakBins[0]] : 0;
  const peakScoreThreshold = strongestPeakScore * peakScoreThresholdRatio;
  const topPeakBins = [];
  for (const peakBin of localPeakBins) {
    if (candidateScores[peakBin] < peakScoreThreshold) continue;
    const tooClose = topPeakBins.some((selectedBin) => (
        Math.abs(selectedBin - peakBin) < peakSelectionMinSpacingBins
    ));
    if (tooClose) continue;
    topPeakBins.push(peakBin);
  }

  function scoreCoarseF0Candidate(candidateBin) {
    if (!Number.isFinite(candidateBin) || candidateBin < minBin || candidateBin > maxBin) {
      return Number.NEGATIVE_INFINITY;
    }
    let score = 0;
    for (const peakBin of topPeakBins) {
      const peakStrength = Math.max(0, candidateScores[peakBin]);
      if (peakStrength <= 0) continue;
      const multiple = Math.max(1, Math.round(peakBin / candidateBin));
      const errorBins = Math.abs(peakBin - (multiple * candidateBin));
      const alignment = Math.max(0, 1 - (errorBins / peakSelectionMinSpacingBins));
      score += peakStrength * alignment;
    }
    return score;
  }

  function pickBestCoarseF0Bin() {
    const candidates = new Set();
    if (topPeakBins.length >= 2) {
      const fromGcd = predictF0(topPeakBins, {minValue: adaptiveMinSpacingBins});
      if (Number.isFinite(fromGcd)) {
        candidates.add(fromGcd);
      }
    }
    for (const peakBin of topPeakBins) {
      for (let divisor = 1; divisor <= harmonicCount; divisor += 1) {
        const candidate = peakBin / divisor;
        if (candidate >= minBin && candidate <= maxBin) {
          candidates.add(candidate);
        }
      }
    }
    let bestCandidate = Number.NaN;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      const score = scoreCoarseF0Candidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    if (Number.isFinite(bestCandidate)) {
      return bestCandidate;
    }
    if (topPeakBins.length > 0) {
      return Math.min(...topPeakBins);
    }
    return Number.NaN;
  }

  const coarseF0Bin = pickBestCoarseF0Bin();

  let predictedHz = Number.NaN;
  const harmonicEstimates = [];
  if (Number.isFinite(coarseF0Bin) && coarseF0Bin > 0) {
    const coarseF0Hz = coarseF0Bin * binSizeHz;
    let weightedSum = 0;
    let totalWeight = 0;
    for (let harmonicIndex = 1; harmonicIndex <= harmonicCount; harmonicIndex += 1) {
      const harmonicTargetHz = coarseF0Hz * harmonicIndex;
      const harmonicTargetBin = hzToBinIndex(harmonicTargetHz, binSizeHz);
      if (!Number.isFinite(harmonicTargetBin) || harmonicTargetBin <= 1 || harmonicTargetBin >= nyquistBin - 1) {
        continue;
      }
      const searchStart = clamp(Math.floor(harmonicTargetBin) - harmonicSearchRadiusBins, minBin, maxBin);
      const searchEnd = clamp(Math.ceil(harmonicTargetBin) + harmonicSearchRadiusBins, minBin, maxBin);
      let bestHarmonicBin = searchStart;
      let bestHarmonicMagnitude = Number.NEGATIVE_INFINITY;
      for (let bin = searchStart; bin <= searchEnd; bin += 1) {
        const magnitude = magnitudes[bin];
        if (magnitude > bestHarmonicMagnitude) {
          bestHarmonicMagnitude = magnitude;
          bestHarmonicBin = bin;
        }
      }
      const refinedHarmonicBin = refineLocalPeakBinParabolic(magnitudes, bestHarmonicBin);
      const harmonicHz = refinedHarmonicBin * binSizeHz;
      const f0FromHarmonicHz = harmonicHz / harmonicIndex;
      const peakinessWeight = Math.max(0, candidateScores[bestHarmonicBin]);
      const magnitudeWeight = Math.max(0, bestHarmonicMagnitude);
      const weight = peakinessWeight * magnitudeWeight;
      if (weight <= 0 || !Number.isFinite(f0FromHarmonicHz)) {
        continue;
      }
      weightedSum += f0FromHarmonicHz * weight;
      totalWeight += weight;
      harmonicEstimates.push({
        harmonicIndex,
        harmonicBin: bestHarmonicBin,
        refinedHarmonicBin,
        harmonicHz,
        f0FromHarmonicHz,
        peakinessWeight,
        magnitudeWeight,
        weight,
      });
    }
    if (totalWeight > 0) {
      predictedHz = weightedSum / totalWeight;
    } else {
      predictedHz = coarseF0Hz;
    }
  }

  const predictedBinIndex = Number.isFinite(predictedHz)
      ? clamp(Math.round(hzToBinIndex(predictedHz, binSizeHz)), minBin, maxBin)
      : null;

  return {
    candidateScores,
    predictedBinIndex,
    predictedHz: Number.isFinite(predictedHz) ? predictedHz : null,
    debug: {
      flatThresholdRatio,
      flatThreshold,
      firstEnergyBin,
      lastFlatBin,
      minHarmonicSpacingBins,
      peakSelectionMinSpacingBins,
      adaptiveMinSpacingBins,
      peakScoreThresholdRatio,
      peakScoreThreshold,
      topPeakBins,
      topPeakHz: topPeakBins.map((bin) => bin * binSizeHz),
      coarseF0Bin: Number.isFinite(coarseF0Bin) ? coarseF0Bin : null,
      coarseF0Hz: Number.isFinite(coarseF0Bin) ? coarseF0Bin * binSizeHz : null,
      harmonicEstimates,
      predictedHz: Number.isFinite(predictedHz) ? predictedHz : null,
    },
  };
}

function computeFreqCandidateScoresV5(magnitudes, minBin, maxBin, binSizeHz) {
  // Uses a test of partials from FFT to predict the fundamental
  const candidateScores = new Float64Array(maxBin + 1); // Dummy, not used
  const maxP = 8; // Try hypotheses that the strongest peak is P0..P(maxP-1).
  const pCount = 12; // Number of expected partial positions used to score each hypothesis.
  const expectedP0MinRatio = 0.18; // For P1+, expected minimum P0 magnitude as ratio of strongest peak.
  const expectedP0PenaltyWeight = 2.0; // Penalty multiplier when expected P0 is too weak.
  const minHarmonicSpacingBins = Math.max(2, Math.ceil(MIN_HZ / binSizeHz)); // Debug/reference value.

  // Find the single strongest peak in the analysis range.
  let strongestPeakBin = minBin;
  let strongestPeakMagnitude = Number.NEGATIVE_INFINITY;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (magnitudes[bin] > strongestPeakMagnitude) {
      strongestPeakMagnitude = magnitudes[bin];
      strongestPeakBin = bin;
    }
  }

  // Score one hypothesis for where P0 should be.
  function scoreHypothesis(f0Bin, maxDetailP = 0) {
    if (!Number.isFinite(f0Bin) || f0Bin < minBin || f0Bin > maxBin) {
      return {score: Number.NEGATIVE_INFINITY, pContributions: [], p0Magnitude: 0};
    }
    let score = 0;
    const pContributions = [];
    let p0Magnitude = 0;
    // Compare expected partial energy with off-partial trough probes.
    for (let p = 1; p <= pCount; p += 1) {
      const pBin = Math.round(f0Bin * p);
      if (pBin < minBin || pBin > maxBin) break;
      const onMagnitude = magnitudes[pBin];
      if (p === 1) {
        p0Magnitude = onMagnitude;
      }
      const offBin = Math.round(f0Bin * (p + 0.5));
      const offMagnitude = offBin >= minBin && offBin <= maxBin ? magnitudes[offBin] : 0;
      const contribution = onMagnitude - (0.5 * offMagnitude);
      score += contribution;
      if (p <= maxDetailP) {
        pContributions.push(contribution);
      }
    }
    return {score, pContributions, p0Magnitude};
  }

  // Evaluate each P-hypothesis for the strongest peak.
  let bestP = 1;
  let bestF0Bin = strongestPeakBin;
  let bestPScore = Number.NEGATIVE_INFINITY;
  const byPContributions = {};
  const byPScore = {};
  for (let p = 1; p <= maxP; p += 1) {
    const f0Bin = strongestPeakBin / p;
    if (f0Bin < minBin || f0Bin > maxBin) continue;
    const includeDetails = p <= 4;
    const {score, pContributions, p0Magnitude} = scoreHypothesis(f0Bin, includeDetails ? 4 : 0);
    let pScore = score;
    // If strongest peak is assumed to be P1+, require some support at P0.
    // If we claim the strongest peak is P1+ then P0 should still be meaningfully present.
    if (p > 1) {
      const expectedP0Magnitude = strongestPeakMagnitude * expectedP0MinRatio;
      const p0Deficit = Math.max(0, expectedP0Magnitude - p0Magnitude);
      pScore -= p0Deficit * expectedP0PenaltyWeight;
    }
    // Mild downward preference.
    pScore -= p * 0.02;
    if (includeDetails) {
      byPContributions[`ifP${p - 1}`] = pContributions;
      byPScore[`ifP${p - 1}`] = pScore;
    }
    if (pScore > bestPScore) {
      bestPScore = pScore;
      bestP = p;
      bestF0Bin = f0Bin;
    }
  }

  // Refine coarse f0 by re-checking nearby bins at P1..Pn and combining them.
  const refinement = refineF0FromPartials({
    magnitudes,
    binSizeHz,
    minBin,
    maxBin,
    baseF0Bin: bestF0Bin,
    pCount: 4,
    searchRadiusBins: 2,
  });
  const predictedHz = Number.isFinite(refinement.refinedF0Hz)
      ? refinement.refinedF0Hz
      : (bestF0Bin * binSizeHz);
  const predictedBinIndex = clamp(Math.round(hzToBinIndex(predictedHz, binSizeHz)), minBin, maxBin);
  return {
    candidateScores,
    predictedBinIndex,
    predictedHz,
    debug: {
      strongestPeakBin,
      strongestPeakHz: strongestPeakBin * binSizeHz,
      strongestPeakMagnitude,
      bestP: bestP - 1,
      bestPScore,
      bestF0Bin,
      bestF0Hz: bestF0Bin * binSizeHz,
      prediction: `the peak at ${(strongestPeakBin * binSizeHz).toFixed(2)}hz is P${bestP - 1}`,
      byPContributions,
      byPScore,
      refinement,
      minHarmonicSpacingBins,
    },
  };
}

export const SCORE_PROCESSORS = {
  "V0: autocorr": computeFreqCandidateScoresV0,
  "V1: basic comb": computeFreqCandidateScoresV1,
  // "V2: interpolation": computeFreqCandidateScoresV2,
  "V3: peakiness + approx GCD": computeFreqCandidateScoresV3,
  "V4: smarter interpolation": computeFreqCandidateScoresV4,
  "V5: walk peaks (hypothesis)": computeFreqCandidateScoresV5,
};

export async function analyzePitchTrackBrowserFft(
    samples,
    sampleRate,
    processorName = "V3: peakiness + approx GCD"
) {
  function computeRms(windowSamples) {
    let sumSquares = 0;
    for (let i = 0; i < windowSamples.length; i += 1) {
      const value = windowSamples[i];
      sumSquares += value * value;
    }
    return Math.sqrt(sumSquares / windowSamples.length);
  }

  function pickBestCandidateBinIndex(candidateScores, minBinIndex, maxBinIndex) {
    let bestBinIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let candidateBinIndex = minBinIndex; candidateBinIndex <= maxBinIndex; candidateBinIndex += 1) {
      const score = candidateScores[candidateBinIndex];
      if (score > bestScore) {
        bestScore = score;
        bestBinIndex = candidateBinIndex;
      }
    }
    if (!Number.isFinite(bestScore) || bestScore <= 0) {
      return null;
    }
    return bestBinIndex;
  }

  function refineBinParabolic(magnitudes, binIndex) {
    if (!Number.isInteger(binIndex) || binIndex <= 0 || binIndex >= magnitudes.length - 1) {
      return binIndex;
    }
    const left = magnitudes[binIndex - 1];
    const mid = magnitudes[binIndex];
    const right = magnitudes[binIndex + 1];
    const denominator = left - (2 * mid) + right;
    if (!Number.isFinite(denominator) || denominator === 0) {
      return binIndex;
    }
    const offset = 0.5 * (left - right) / denominator;
    return binIndex + clamp(offset, -1, 1);
  }

  const hopSamples = Math.max(1, Math.round(sampleRate / SAMPLES_PER_SECOND));
  const windowCount = Math.max(0, Math.floor((samples.length - WINDOW_SIZE) / hopSamples) + 1);
  const scoreCandidates = SCORE_PROCESSORS[processorName];
  if (!scoreCandidates) {
    throw new Error(`Unknown processor: ${processorName}`);
  }

  const windowIndex = new Array(windowCount);
  const hz = new Array(windowCount);
  const freqCandidateStartBins = new Array(windowCount);
  const freqCandidateScores = new Array(windowCount);
  const windowSpectrumMagnitudes = new Array(windowCount);
  const processorDebug = new Array(windowCount);
  const getWindowSpectrum = await createWindowSpectrumComputer({
    samples,
    sampleRate,
    binCount: FFT_BIN_COUNT,
    windowSize: WINDOW_SIZE,
    hopSamples,
    windowCount,
  });

  const maxAnalyzableHz = sampleRate / 2;
  const binSizeHz = maxAnalyzableHz / FFT_BIN_COUNT;
  const nyquistBinIndex = FFT_BIN_COUNT - 1;
  // Use floor so near-boundary fundamentals are not excluded by FFT bin quantization.
  const minBinIndex = clamp(Math.floor(hzToBinIndex(MIN_HZ, binSizeHz)), 2, nyquistBinIndex);
  const maxBinIndex = clamp(
      Math.floor(hzToBinIndex(MAX_HZ, binSizeHz)),
      minBinIndex,
      nyquistBinIndex
  );

  const startedAt = performance.now();
  for (let index = 0; index < windowCount; index += 1) {
    const startSample = index * hopSamples;
    const analysisWindow = samples.subarray(startSample, startSample + WINDOW_SIZE);
    const windowRms = computeRms(analysisWindow);

    windowIndex[index] = index;

    const magnitudes = getWindowSpectrum(index);
    windowSpectrumMagnitudes[index] = magnitudes;

    if (windowRms < RMS_MIN) {
      hz[index] = Number.NaN;
      processorDebug[index] = null;
      continue;
    }

    const scoreResult = scoreCandidates(
        magnitudes,
        minBinIndex,
        maxBinIndex,
        binSizeHz,
        {
          analysisWindow,
          sampleRate,
          minHz: MIN_HZ,
          maxHz: MAX_HZ,
        }
    );
    const candidateScores = scoreResult?.candidateScores ?? scoreResult;
    const hasProcessorPrediction = Object.prototype.hasOwnProperty.call(scoreResult ?? {}, "predictedBinIndex");
    const predictedHzDirect = Number.isFinite(scoreResult?.predictedHz)
        ? scoreResult.predictedHz
        : null;
    const predictedBinIndex = hasProcessorPrediction
        ? scoreResult.predictedBinIndex
        : null;
    const bestBinIndex = hasProcessorPrediction
        ? predictedBinIndex
        : pickBestCandidateBinIndex(candidateScores, minBinIndex, maxBinIndex);
    if (bestBinIndex === null) {
      hz[index] = Number.NaN;
    } else if (predictedHzDirect !== null) {
      hz[index] = predictedHzDirect;
    } else {
      const refinedBinIndex = refineBinParabolic(magnitudes, bestBinIndex);
      hz[index] = refinedBinIndex * binSizeHz;
    }
    freqCandidateStartBins[index] = minBinIndex;
    freqCandidateScores[index] = Array.from(candidateScores.subarray(minBinIndex, maxBinIndex + 1));
    processorDebug[index] = scoreResult?.debug ?? null;
  }
  const elapsedMs = performance.now() - startedAt;

  return {
    frequencyBinCount: FFT_BIN_COUNT,
    windowCount,
    elapsedMs,
    msPerWindow: windowCount > 0 ? elapsedMs / windowCount : 0,
    windowIndex,
    hz,
    freqCandidateStartBins,
    freqCandidateScores,
    windowSpectrumMagnitudes,
    processorDebug,
  };
}
