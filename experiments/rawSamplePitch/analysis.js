import {
  analyzeDecodedPitchSample as analyzeDecodedFftPitchSample,
  loadAudioSample,
} from "../pitchDetection/analysis.js";
import { getRawSampleWindowSize } from "./windowing.js";

const DEFAULT_MAX_EXTREMA_PER_FOLD = 2;
const DEFAULT_MAX_CROSSINGS_PER_PERIOD = 20;
const DEFAULT_MAX_COMPARISON_PATCHES = 3;
const DEFAULT_MAX_WALK_STEPS = 10;
const DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF = 0;
const DEFAULT_OCTAVE_BIAS = 0;
const RAW_MIN_WINDOW_MAX_AMPLITUDE = 0.01;
const RAW_MIN_HZ = 40;
const RAW_MAX_HZ = 2200;
const MAX_LOG_CORRELATION = 0.999999;

function toLogCorrelation(correlation) {
  if (!Number.isFinite(correlation) || correlation <= 0) return 0;
  return -Math.log10(1 - Math.min(correlation, MAX_LOG_CORRELATION));
}

function getCandidateWeightedScore(periodSamples, sampleRate, correlation, octaveBias) {
  if (!(periodSamples > 0) || !(sampleRate > 0) || !Number.isFinite(correlation)) {
    return Number.NEGATIVE_INFINITY;
  }
  const candidateHz = sampleRate / periodSamples;
  if (!(candidateHz > 0)) return Number.NEGATIVE_INFINITY;
  return toLogCorrelation(correlation) + octaveBias * Math.log2(candidateHz / RAW_MIN_HZ);
}

function centsDifference(aHz, bHz) {
  if (!(aHz > 0) || !(bHz > 0)) return Number.NaN;
  return Math.abs(1200 * Math.log2(aHz / bHz));
}

function getMaxAbsoluteAmplitude(samples) {
  let max = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    if (absolute > max) max = absolute;
  }
  return max;
}

function scoreRawAccuracy(referenceHz, predictedHz) {
  let correctCount = 0;
  let comparedCount = 0;
  for (let index = 0; index < referenceHz.length; index += 1) {
    const fftHz = referenceHz[index];
    const rawHz = predictedHz[index];
    if (!(fftHz > 0) || !(rawHz > 0)) continue;
    comparedCount += 1;
    if (centsDifference(fftHz, rawHz) <= 50) {
      correctCount += 1;
    }
  }
  return {
    correctCount,
    comparedCount,
    accuracy: comparedCount > 0 ? correctCount / comparedCount : Number.NaN,
  };
}

function hasZeroCrossing(a, b) {
  return a === 0 || b === 0 || (a < 0 && b > 0) || (a > 0 && b < 0);
}

function countZeroCrossings(samples) {
  let count = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (hasZeroCrossing(samples[index - 1], samples[index])) {
      count += 1;
    }
  }
  return count;
}

function measurePeriodPatchCorrelation(samples, periodSamples, maxComparisonPatches) {
  if (!Number.isFinite(periodSamples) || periodSamples < 1) return Number.NEGATIVE_INFINITY;
  const period = Math.max(1, Math.round(periodSamples));
  const requestedPatchCount = Number.isFinite(maxComparisonPatches)
    ? Math.max(2, Math.floor(maxComparisonPatches))
    : DEFAULT_MAX_COMPARISON_PATCHES;
  const availablePatchCount = Math.floor(samples.length / period);
  const patchCount = Math.min(requestedPatchCount, availablePatchCount);
  if (patchCount < 2) return Number.NEGATIVE_INFINITY;

  let correlationSum = 0;
  let comparisonCount = 0;
  const firstPatchStart = samples.length - patchCount * period;
  for (let patchIndex = 1; patchIndex < patchCount; patchIndex += 1) {
    const previousStart = firstPatchStart + (patchIndex - 1) * period;
    const currentStart = firstPatchStart + patchIndex * period;
    let dot = 0;
    let sumSquaresA = 0;
    let sumSquaresB = 0;
    for (let offset = 0; offset < period; offset += 1) {
      const a = samples[previousStart + offset];
      const b = samples[currentStart + offset];
      dot += a * b;
      sumSquaresA += a * a;
      sumSquaresB += b * b;
    }
    if (!(sumSquaresA > 0) || !(sumSquaresB > 0)) continue;
    correlationSum += dot / Math.sqrt(sumSquaresA * sumSquaresB);
    comparisonCount += 1;
  }
  return comparisonCount > 0 ? correlationSum / comparisonCount : Number.NEGATIVE_INFINITY;
}

export function buildRawCorrelationHistogram(samples, sampleRate, maxComparisonPatches) {
  const hz = [];
  const correlation = [];
  for (let candidateHz = RAW_MIN_HZ; candidateHz <= RAW_MAX_HZ; candidateHz += 1) {
    const periodSamples = sampleRate / candidateHz;
    hz.push(candidateHz);
    correlation.push(measurePeriodPatchCorrelation(samples, periodSamples, maxComparisonPatches));
  }
  return {
    minHz: RAW_MIN_HZ,
    maxHz: RAW_MAX_HZ,
    hz,
    correlation,
  };
}

function getHistogramPeak(samples, sampleRate, maxComparisonPatches) {
  const histogram = buildRawCorrelationHistogram(samples, sampleRate, maxComparisonPatches);
  let bestHz = Number.NaN;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < histogram.hz.length; index += 1) {
    const correlation = histogram.correlation[index];
    if (!Number.isFinite(correlation) || correlation <= bestCorrelation) continue;
    bestCorrelation = correlation;
    bestHz = histogram.hz[index];
  }
  return {
    hz: bestHz,
    logCorrelation: toLogCorrelation(bestCorrelation),
  };
}

export function evaluateRawWindow(windowSamples, sampleRate, shouldPredict, options = null) {
  const maxExtremaPerFold = Number.isFinite(options?.maxExtremaPerFold)
    ? Math.max(1, Math.floor(options.maxExtremaPerFold))
    : DEFAULT_MAX_EXTREMA_PER_FOLD;
  const maxCrossingsPerPeriod = Number.isFinite(options?.maxCrossingsPerPeriod)
    ? Math.max(2, Math.floor(options.maxCrossingsPerPeriod))
    : DEFAULT_MAX_CROSSINGS_PER_PERIOD;
  const maxComparisonPatches = Number.isFinite(options?.maxComparisonPatches)
    ? Math.max(2, Math.floor(options.maxComparisonPatches))
    : DEFAULT_MAX_COMPARISON_PATCHES;
  const maxWalkSteps = Number.isFinite(options?.maxWalkSteps)
    ? Math.max(0, Math.floor(options.maxWalkSteps))
    : DEFAULT_MAX_WALK_STEPS;
  const rawGlobalLogCorrelationCutoff = Number.isFinite(options?.rawGlobalLogCorrelationCutoff)
    ? Math.max(0, options.rawGlobalLogCorrelationCutoff)
    : DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF;

  const rawResult = detectPitchFromRawWindow(windowSamples, sampleRate, {
    maxExtremaPerFold,
    maxCrossingsPerPeriod,
    maxComparisonPatches,
    maxWalkSteps,
    rawGlobalLogCorrelationCutoff,
  });
  const histogramPeak = getHistogramPeak(windowSamples, sampleRate, maxComparisonPatches);
  const maxAmplitude = getMaxAbsoluteAmplitude(windowSamples);
  const passesRawGlobalCutoff =
    Number.isFinite(rawResult.debug?.winningLogCorrelation) &&
    rawResult.debug.winningLogCorrelation >= rawGlobalLogCorrelationCutoff;
  const passesAmplitudeCutoff = maxAmplitude >= RAW_MIN_WINDOW_MAX_AMPLITUDE;

  if (!shouldPredict) {
    rawResult.debug.rejectionReason = "fft_mask";
  } else if (!passesAmplitudeCutoff) {
    rawResult.debug.rejectionReason = "low_amplitude";
  } else if (!passesRawGlobalCutoff) {
    rawResult.debug.rejectionReason = "low_log_correlation";
  } else {
    rawResult.debug.rejectionReason = null;
  }

  return {
    rawResult,
    histogramPeak,
    maxAmplitude,
    passesRawGlobalCutoff,
    passesAmplitudeCutoff,
    rawPitchHz:
      shouldPredict && passesRawGlobalCutoff && passesAmplitudeCutoff ? rawResult.hz : Number.NaN,
    autocorrelationPitchHz:
      shouldPredict && passesRawGlobalCutoff && passesAmplitudeCutoff ? histogramPeak.hz : Number.NaN,
  };
}

function isPeriodInVoiceRange(periodSamples, sampleRate) {
  if (!(periodSamples > 0) || !(sampleRate > 0)) return false;
  const hz = sampleRate / periodSamples;
  return hz >= RAW_MIN_HZ && hz <= RAW_MAX_HZ;
}

function walkToBestNearbyPeriod(
  samples,
  startPeriodSamples,
  sampleRate,
  maxComparisonPatches,
  maxWalkSteps,
) {
  const startPeriod = Math.max(1, Math.round(startPeriodSamples));
  if (!isPeriodInVoiceRange(startPeriod, sampleRate)) {
    return {
      periodSamples: startPeriod,
      correlation: Number.NEGATIVE_INFINITY,
      walkOffset: 0,
    };
  }
  let bestPeriod = startPeriod;
  let bestCorrelation = measurePeriodPatchCorrelation(samples, bestPeriod, maxComparisonPatches);
  let stepsUsed = 0;
  while (stepsUsed < maxWalkSteps) {
    const lowerPeriod = bestPeriod - 1;
    const upperPeriod = bestPeriod + 1;
    const lowerCorrelation = isPeriodInVoiceRange(lowerPeriod, sampleRate)
      ? measurePeriodPatchCorrelation(samples, lowerPeriod, maxComparisonPatches)
      : Number.NEGATIVE_INFINITY;
    const upperCorrelation = isPeriodInVoiceRange(upperPeriod, sampleRate)
      ? measurePeriodPatchCorrelation(samples, upperPeriod, maxComparisonPatches)
      : Number.NEGATIVE_INFINITY;
    if (lowerCorrelation <= bestCorrelation && upperCorrelation <= bestCorrelation) {
      break;
    }
    if (upperCorrelation > lowerCorrelation) {
      bestPeriod = upperPeriod;
      bestCorrelation = upperCorrelation;
    } else {
      bestPeriod = lowerPeriod;
      bestCorrelation = lowerCorrelation;
    }
    stepsUsed += 1;
  }
  return {
    periodSamples: bestPeriod,
    correlation: bestCorrelation,
    walkOffset: bestPeriod - startPeriod,
  };
}

function getFoldType(samples, startIndex, endIndex) {
  for (let index = startIndex; index < endIndex; index += 1) {
    const sample = samples[index];
    if (sample > 0) return "peak";
    if (sample < 0) return "trough";
  }
  return null;
}

function getStrongestExtremaInFold(
  samples,
  startIndex,
  endIndex,
  type,
  maxExtremaPerFold,
  foldIndex,
) {
  const isTrailingFold = foldIndex === 0;
  const extrema = [];
  for (
    let index = Math.max(1, startIndex);
    index < Math.min(samples.length - 1, endIndex);
    index += 1
  ) {
    const left = samples[index - 1];
    const center = samples[index];
    const right = samples[index + 1];
    const isPeak = isTrailingFold
      ? center > left && center > right && center > 0
      : center >= left && center > right && center > 0;
    const isTrough = isTrailingFold
      ? center < left && center < right && center < 0
      : center <= left && center < right && center < 0;
    if ((type === "peak" && !isPeak) || (type === "trough" && !isTrough)) continue;
    extrema.push({ index, value: center, type, foldIndex });
  }

  if (!isTrailingFold && extrema.length === 0) {
    let bestIndex = startIndex;
    let bestValue = samples[startIndex] ?? 0;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const value = samples[index];
      if ((type === "peak" && value > bestValue) || (type === "trough" && value < bestValue)) {
        bestIndex = index;
        bestValue = value;
      }
    }
    if ((type === "peak" && bestValue > 0) || (type === "trough" && bestValue < 0)) {
      extrema.push({ index: bestIndex, value: bestValue, type, foldIndex });
    }
  }

  const strongest = [...extrema]
    .sort((a, b) => (type === "peak" ? b.value - a.value : a.value - b.value))
    .slice(0, maxExtremaPerFold);
  strongest.sort((a, b) => b.index - a.index);
  return strongest;
}

function collectRecentFoldExtrema(samples, maxExtremaPerFold, maxCrossingsPerPeriod) {
  const folds = [];
  const extrema = [];
  let endIndex = samples.length;
  let crossingCount = 0;
  const maxCrossingsToTraverse = maxCrossingsPerPeriod * 2;

  while (endIndex > 1 && crossingCount < maxCrossingsToTraverse) {
    let crossingIndex = 0;
    let foundCrossing = false;
    for (let index = endIndex - 1; index > 0; index -= 1) {
      if (hasZeroCrossing(samples[index - 1], samples[index])) {
        crossingIndex = index;
        foundCrossing = true;
        break;
      }
    }

    const startIndex = foundCrossing ? crossingIndex : 0;
    const type = getFoldType(samples, startIndex, endIndex);
    const fold = {
      startIndex,
      endIndex,
      type,
      extrema: type
        ? getStrongestExtremaInFold(
            samples,
            startIndex,
            endIndex,
            type,
            maxExtremaPerFold,
            folds.length,
          )
        : [],
    };
    folds.push(fold);
    extrema.push(...fold.extrema);

    if (!foundCrossing) break;
    endIndex = crossingIndex;
    crossingCount += 1;
  }

  return {
    folds,
    extrema: extrema.sort((a, b) => a.index - b.index),
    traversedCrossings: crossingCount,
  };
}

function buildCandidateFamilies(
  samples,
  extrema,
  sampleRate,
  maxComparisonPatches,
  maxWalkSteps,
  type,
) {
  const orderedExtrema = extrema
    .filter((item) => item.type === type)
    .sort((a, b) => b.index - a.index);
  if (orderedExtrema.length < 2) return [];

  const anchor = orderedExtrema[0];
  const families = [];
  const seenPeriods = new Set();
  for (let index = 1; index < orderedExtrema.length; index += 1) {
    const other = orderedExtrema[index];
    if (other.foldIndex === anchor.foldIndex) continue;
    const sourcePeriodSamples = anchor.index - other.index;
    if (!isPeriodInVoiceRange(sourcePeriodSamples, sampleRate)) continue;
    const candidate = walkToBestNearbyPeriod(
      samples,
      sourcePeriodSamples,
      sampleRate,
      maxComparisonPatches,
      maxWalkSteps,
    );
    const roundedPeriod = Math.max(1, Math.round(candidate.periodSamples));
    if (!isPeriodInVoiceRange(roundedPeriod, sampleRate)) continue;
    if (seenPeriods.has(roundedPeriod)) continue;
    seenPeriods.add(roundedPeriod);
    families.push({
      type,
      pointPair: [anchor.index, other.index],
      sourcePeriodSamples,
      periodSamples: roundedPeriod,
      correlation: candidate.correlation,
      walkOffset: candidate.walkOffset,
    });
  }
  return families;
}

function buildEmptyDebug(
  maxExtremaPerFold,
  maxCrossingsPerPeriod,
  maxComparisonPatches,
  maxWalkSteps,
  rawGlobalLogCorrelationCutoff,
  octaveBias,
) {
  return {
    maxExtremaPerFold,
    maxCrossingsPerPeriod,
    maxComparisonPatches,
    maxWalkSteps,
    rawGlobalLogCorrelationCutoff,
    octaveBias,
    zeroCrossingCount: 0,
    foldExtrema: [],
    folds: [],
    candidatePeriods: [],
    candidateFamilies: [],
    winningPointPair: null,
    winningPeriodSamples: Number.NaN,
    winningCorrelation: Number.NEGATIVE_INFINITY,
    winningLogCorrelation: 0,
    winningWeightedScore: Number.NEGATIVE_INFINITY,
    rejectionReason: null,
    minHz: RAW_MIN_HZ,
    maxHz: RAW_MAX_HZ,
  };
}

export function detectPitchFromRawWindow(samples, sampleRate, options = null) {
  const maxExtremaPerFold = Number.isFinite(options?.maxExtremaPerFold)
    ? Math.max(1, Math.floor(options.maxExtremaPerFold))
    : DEFAULT_MAX_EXTREMA_PER_FOLD;
  const maxCrossingsPerPeriod = Number.isFinite(options?.maxCrossingsPerPeriod)
    ? Math.max(2, Math.floor(options.maxCrossingsPerPeriod))
    : DEFAULT_MAX_CROSSINGS_PER_PERIOD;
  const maxComparisonPatches = Number.isFinite(options?.maxComparisonPatches)
    ? Math.max(2, Math.floor(options.maxComparisonPatches))
    : DEFAULT_MAX_COMPARISON_PATCHES;
  const maxWalkSteps = Number.isFinite(options?.maxWalkSteps)
    ? Math.max(0, Math.floor(options.maxWalkSteps))
    : DEFAULT_MAX_WALK_STEPS;
  const rawGlobalLogCorrelationCutoff = Number.isFinite(options?.rawGlobalLogCorrelationCutoff)
    ? Math.max(0, options.rawGlobalLogCorrelationCutoff)
    : DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF;
  const octaveBias = Number.isFinite(options?.octaveBias) ? options.octaveBias : DEFAULT_OCTAVE_BIAS;
  if (!(samples instanceof Float32Array) || samples.length < 3 || !(sampleRate > 0)) {
    const debug = buildEmptyDebug(
      maxExtremaPerFold,
      maxCrossingsPerPeriod,
      maxComparisonPatches,
      maxWalkSteps,
      rawGlobalLogCorrelationCutoff,
      octaveBias,
    );
    debug.rejectionReason = "invalid_window";
    return { hz: Number.NaN, debug };
  }

  const zeroCrossingCount = countZeroCrossings(samples);
  const debug = buildEmptyDebug(
    maxExtremaPerFold,
    maxCrossingsPerPeriod,
    maxComparisonPatches,
    maxWalkSteps,
    rawGlobalLogCorrelationCutoff,
    octaveBias,
  );
  debug.zeroCrossingCount = zeroCrossingCount;

  if (zeroCrossingCount === 0) {
    debug.rejectionReason = "no_zero_crossings";
    return { hz: Number.NaN, debug };
  }

  const foldData = collectRecentFoldExtrema(samples, maxExtremaPerFold, maxCrossingsPerPeriod);
  debug.folds = foldData.folds;
  debug.foldExtrema = foldData.extrema;

  const candidateFamilies = [
    ...buildCandidateFamilies(
      samples,
      foldData.extrema,
      sampleRate,
      maxComparisonPatches,
      maxWalkSteps,
      "peak",
    ),
    ...buildCandidateFamilies(
      samples,
      foldData.extrema,
      sampleRate,
      maxComparisonPatches,
      maxWalkSteps,
      "trough",
    ),
  ];
  debug.candidateFamilies = candidateFamilies;
  debug.candidatePeriods = candidateFamilies.map((family) => family.periodSamples);

  let bestCandidate = null;
  for (const family of candidateFamilies) {
    if (!Number.isFinite(family.correlation)) continue;
    const weightedScore = getCandidateWeightedScore(
      family.periodSamples,
      sampleRate,
      family.correlation,
      octaveBias,
    );
    if (!Number.isFinite(weightedScore)) continue;
    if (!bestCandidate || weightedScore > bestCandidate.weightedScore) {
      bestCandidate = family;
      bestCandidate.weightedScore = weightedScore;
    }
  }

  if (!bestCandidate || !Number.isFinite(bestCandidate.periodSamples)) {
    debug.rejectionReason = "no_candidates";
    return { hz: Number.NaN, debug };
  }

  debug.winningPointPair = bestCandidate.pointPair;
  debug.winningPeriodSamples = bestCandidate.periodSamples;
  debug.winningCorrelation = bestCandidate.correlation;
  debug.winningLogCorrelation = toLogCorrelation(bestCandidate.correlation);
  debug.winningWeightedScore = bestCandidate.weightedScore;

  return {
    hz: sampleRate / bestCandidate.periodSamples,
    debug,
  };
}

export function getHigherCandidateDiagnosticForWindow(result, windowIndex, minRatio = 1.2) {
  const fftHz = result.pitchHz?.[windowIndex];
  if (!(fftHz > 0)) return null;
  const rawDebug = result.rawDebug?.[windowIndex];
  if (!rawDebug) return null;
  const minCandidateHz = fftHz * minRatio;
  const sortedFamilies = [...(rawDebug.candidateFamilies ?? [])].sort(
    (a, b) => result.sampleRate / a.periodSamples - result.sampleRate / b.periodSamples,
  );
  let best = null;

  for (let columnIndex = 0; columnIndex < sortedFamilies.length; columnIndex += 1) {
    const family = sortedFamilies[columnIndex];
    if (!Number.isFinite(family?.correlation) || !Number.isFinite(family?.periodSamples)) continue;
    const candidateHz = result.sampleRate / family.periodSamples;
    if (!(candidateHz > minCandidateHz)) continue;
    const item = {
      windowIndex,
      timeSec: result.timeSec?.[windowIndex] ?? Number.NaN,
      fftHz,
      candidateHz,
      ratio: candidateHz / fftHz,
      logCorr: toLogCorrelation(family.correlation),
      correlation: family.correlation,
      type: family.type,
      column: columnIndex + 1,
      pointPair: family.pointPair,
      periodSamples: family.periodSamples,
      sourcePeriodSamples: family.sourcePeriodSamples,
    };
    if (!best || item.logCorr > best.logCorr) {
      best = item;
    }
  }

  return best;
}

export function getSampleMaxHigherCandidateDiagnostic(result, minRatio = 1.2) {
  let best = null;
  for (let windowIndex = 0; windowIndex < result.timeSec.length; windowIndex += 1) {
    const item = getHigherCandidateDiagnosticForWindow(result, windowIndex, minRatio);
    if (!item) continue;
    if (!best || item.logCorr > best.logCorr) {
      best = item;
    }
  }
  return best;
}

export async function loadPitchSample(audioInput = null) {
  const loaded = await loadAudioSample(audioInput);
  const fftResult = await analyzeDecodedFftPitchSample(loaded, null, {
    disablePeakinessGate: true,
    disablePeakinessMetrics: true,
  });
  const peakinessResult = await analyzeDecodedFftPitchSample(loaded, null, {
    disablePeakinessGate: true,
  });
  const predictionMask = peakinessResult.peakiness.map(
    (value) => value >= peakinessResult.peakinessCutoff,
  );
  return {
    loaded,
    fftResult,
    peakinessResult,
    predictionMask,
  };
}

export async function analyzePreparedPitchSample(preparedSample, options = null) {
  const { fftResult, peakinessResult, predictionMask } = preparedSample;
  const rawWindowSamples = getRawSampleWindowSize(fftResult.sampleRate);
  const maxExtremaPerFold = Number.isFinite(options?.maxExtremaPerFold)
    ? Math.max(1, Math.floor(options.maxExtremaPerFold))
    : DEFAULT_MAX_EXTREMA_PER_FOLD;
  const maxCrossingsPerPeriod = Number.isFinite(options?.maxCrossingsPerPeriod)
    ? Math.max(2, Math.floor(options.maxCrossingsPerPeriod))
    : DEFAULT_MAX_CROSSINGS_PER_PERIOD;
  const maxComparisonPatches = Number.isFinite(options?.maxComparisonPatches)
    ? Math.max(2, Math.floor(options.maxComparisonPatches))
    : DEFAULT_MAX_COMPARISON_PATCHES;
  const maxWalkSteps = Number.isFinite(options?.maxWalkSteps)
    ? Math.max(0, Math.floor(options.maxWalkSteps))
    : DEFAULT_MAX_WALK_STEPS;
  const rawGlobalLogCorrelationCutoff = Number.isFinite(options?.rawGlobalLogCorrelationCutoff)
    ? Math.max(0, options.rawGlobalLogCorrelationCutoff)
    : DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF;
  const octaveBias = Number.isFinite(options?.octaveBias) ? options.octaveBias : DEFAULT_OCTAVE_BIAS;
  const rawPitchHz = new Array(fftResult.timeSec.length);
  const rawDebug = new Array(fftResult.timeSec.length);
  const fftPitchHz = new Array(fftResult.timeSec.length);
  const autocorrelationPitchHz = new Array(fftResult.timeSec.length);
  const rawMaxLogCorrelation = new Array(fftResult.timeSec.length);
  let rawElapsedMs = 0;

  for (let windowIndex = 0; windowIndex < fftResult.timeSec.length; windowIndex += 1) {
    const endSample = Math.min(
      fftResult.samples.length,
      Math.max(0, Math.round(fftResult.timeSec[windowIndex] * fftResult.sampleRate)),
    );
    const startSample = Math.max(0, endSample - rawWindowSamples);
    const windowSamples = fftResult.samples.subarray(startSample, endSample);
    const startMs = performance.now();
    const shouldPredict = predictionMask[windowIndex] === true;
    const evaluated = evaluateRawWindow(windowSamples, fftResult.sampleRate, shouldPredict, {
      maxExtremaPerFold,
      maxCrossingsPerPeriod,
      maxComparisonPatches,
      maxWalkSteps,
      rawGlobalLogCorrelationCutoff,
      octaveBias,
    });
    fftPitchHz[windowIndex] = shouldPredict ? fftResult.pitchHz[windowIndex] : Number.NaN;
    rawPitchHz[windowIndex] = evaluated.rawPitchHz;
    autocorrelationPitchHz[windowIndex] = evaluated.autocorrelationPitchHz;
    rawMaxLogCorrelation[windowIndex] = evaluated.histogramPeak.logCorrelation;
    rawDebug[windowIndex] = evaluated.rawResult.debug;
    rawElapsedMs += performance.now() - startMs;
  }
  const accuracy = scoreRawAccuracy(fftPitchHz, rawPitchHz);

  return {
    ...fftResult,
    pitchHz: fftPitchHz,
    peakiness: peakinessResult.peakiness,
    peakMagnitude: peakinessResult.peakMagnitude,
    spectralFlatness: peakinessResult.spectralFlatness,
    peakinessCutoff: peakinessResult.peakinessCutoff,
    rawPitchHz,
    autocorrelationPitchHz,
    rawMaxLogCorrelation,
    rawDebug,
    rawSettings: {
      maxExtremaPerFold,
      maxCrossingsPerPeriod,
      maxComparisonPatches,
      maxWalkSteps,
      rawGlobalLogCorrelationCutoff,
      octaveBias,
    },
    metrics: {
      rawAccuracy: accuracy.accuracy,
      rawCorrectCount: accuracy.correctCount,
      rawComparedCount: accuracy.comparedCount,
    },
    perf: {
      ...fftResult.perf,
      rawPipelineMsPerSecondAudio:
        fftResult.timeSec.length > 0
          ? rawElapsedMs / (fftResult.timeSec.length / fftResult.samplesPerSecond)
          : Number.NaN,
      rawMsPerSecondAudio:
        fftResult.timeSec.length > 0
          ? rawElapsedMs / (fftResult.timeSec.length / fftResult.samplesPerSecond)
          : Number.NaN,
    },
  };
}

export async function analyzePitchSample(audioInput, options = null) {
  const preparedSample = await loadPitchSample(audioInput);
  return analyzePreparedPitchSample(preparedSample, options);
}
