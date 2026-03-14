import {
  analyzeDecodedPitchSample as analyzeDecodedFftPitchSample,
  loadAudioSample,
} from "../pitchDetection/analysis.js";
import { getRawSampleWindowSize } from "./windowing.js";

const DEFAULT_PEAK_COUNT = 10;
const DEFAULT_LOG_CORRELATION_CUTOFF = 1.8;
const DEFAULT_MAX_COMPARISON_PATCHES = 2;
const DEFAULT_MAX_WALK_STEPS = 10;
const RAW_GLOBAL_LOG_CORRELATION_CUTOFF = 1;
const RAW_MIN_WINDOW_MAX_AMPLITUDE = 0.01;
const RAW_MIN_HZ = 40;
const RAW_MAX_HZ = 2200;
const MAX_LOG_CORRELATION = 0.999999;

function toLogCorrelation(correlation) {
  if (!Number.isFinite(correlation) || correlation <= 0) return 0;
  return -Math.log10(1 - Math.min(correlation, MAX_LOG_CORRELATION));
}

function getSortedCandidateFamilies(rawDebug, sampleRate) {
  const families = rawDebug?.candidateFamilies ?? [];
  return [...families].sort(
    (a, b) => sampleRate / a.originalPeriodSamples - sampleRate / b.originalPeriodSamples,
  );
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

function findHighestExtrema(samples, peakCount, type) {
  const extrema = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const left = samples[index - 1];
    const center = samples[index];
    const right = samples[index + 1];
    const isPeak = center >= left && center > right;
    const isTrough = center <= left && center < right;
    if ((type === "peak" && !isPeak) || (type === "trough" && !isTrough)) continue;
    extrema.push({ index, value: center, type });
  }
  extrema.sort((a, b) =>
    type === "peak" ? b.value - a.value : a.value - b.value,
  );
  return extrema.slice(0, peakCount).sort((a, b) => a.index - b.index);
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

export function getHigherCandidateDiagnosticForWindow(result, windowIndex, minRatio = 1.2) {
  const fftHz = result.pitchHz?.[windowIndex];
  if (!(fftHz > 0)) return null;
  const rawDebug = result.rawDebug?.[windowIndex];
  if (!rawDebug) return null;
  const minCandidateHz = fftHz * minRatio;
  const sortedFamilies = getSortedCandidateFamilies(rawDebug, result.sampleRate);
  let best = null;

  for (let columnIndex = 0; columnIndex < sortedFamilies.length; columnIndex += 1) {
    const family = sortedFamilies[columnIndex];
    for (const variant of ["half", "original", "double"]) {
      const isEnabled = variant !== "double" || family.allowDouble;
      const candidate = family[variant];
      if (!isEnabled || !Number.isFinite(candidate?.correlation) || !Number.isFinite(candidate?.periodSamples)) {
        continue;
      }
      const candidateHz = result.sampleRate / candidate.periodSamples;
      if (!(candidateHz > minCandidateHz)) continue;
      const item = {
        windowIndex,
        timeSec: result.timeSec?.[windowIndex] ?? Number.NaN,
        fftHz,
        candidateHz,
        ratio: candidateHz / fftHz,
        logCorr: toLogCorrelation(candidate.correlation),
        correlation: candidate.correlation,
        variant,
        type: family.type,
        column: columnIndex + 1,
        pointPair: family.pointPair,
        periodSamples: candidate.periodSamples,
        originalPeriodSamples: family.originalPeriodSamples,
        sourcePeriodSamples: family.sourcePeriodSamples,
      };
      if (!best || item.logCorr > best.logCorr) {
        best = item;
      }
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

function getHistogramPeakHz(samples, sampleRate, maxComparisonPatches) {
  const histogram = buildRawCorrelationHistogram(samples, sampleRate, maxComparisonPatches);
  let bestHz = Number.NaN;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < histogram.hz.length; index += 1) {
    const correlation = histogram.correlation[index];
    if (!Number.isFinite(correlation) || correlation <= bestCorrelation) continue;
    bestCorrelation = correlation;
    bestHz = histogram.hz[index];
  }
  return bestHz;
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

function buildCandidatePeriods(
  samples,
  extrema,
  sampleRate,
  logCorrelationCutoff,
  maxComparisonPatches,
  maxWalkSteps,
  type,
) {
  const originalPeriods = [];
  for (let index = 0; index < extrema.length - 1; index += 1) {
    const periodSamples = extrema[index + 1].index - extrema[index].index;
    if (!isPeriodInVoiceRange(periodSamples, sampleRate)) continue;
    const originalCandidate = walkToBestNearbyPeriod(
      samples,
      periodSamples,
      sampleRate,
      maxComparisonPatches,
      maxWalkSteps,
    );
    originalPeriods.push({
      periodSamples: originalCandidate.periodSamples,
      pointPair: [extrema[index].index, extrema[index + 1].index],
      sourcePeriodSamples: periodSamples,
      correlation: originalCandidate.correlation,
      walkOffset: originalCandidate.walkOffset,
      type,
    });
  }

  const dedupedPeriods = [];
  const seenPeriods = new Set();
  const candidateFamilies = [];
  for (const originalPeriod of originalPeriods) {
    const halfCandidate = walkToBestNearbyPeriod(
      samples,
      originalPeriod.periodSamples / 2,
      sampleRate,
      maxComparisonPatches,
      maxWalkSteps,
    );
    const doubleCandidate = walkToBestNearbyPeriod(
      samples,
      originalPeriod.periodSamples * 2,
      sampleRate,
      maxComparisonPatches,
      maxWalkSteps,
    );
    const originalLogCorrelation = toLogCorrelation(originalPeriod.correlation);
    const allowDouble =
      !Number.isFinite(originalPeriod.correlation) ||
      originalLogCorrelation < logCorrelationCutoff;
    const preferHalf =
      Number.isFinite(halfCandidate.correlation) &&
      toLogCorrelation(halfCandidate.correlation) >= logCorrelationCutoff;
    candidateFamilies.push({
      pointPair: originalPeriod.pointPair,
      originalPeriodSamples: originalPeriod.periodSamples,
      sourcePeriodSamples: originalPeriod.sourcePeriodSamples,
      type,
      half: {
        periodSamples: halfCandidate.periodSamples,
        correlation: halfCandidate.correlation,
        walkOffset: halfCandidate.walkOffset,
      },
      original: {
        periodSamples: originalPeriod.periodSamples,
        correlation: originalPeriod.correlation,
        walkOffset: originalPeriod.walkOffset,
      },
      double: {
        periodSamples: doubleCandidate.periodSamples,
        correlation: allowDouble ? doubleCandidate.correlation : Number.NEGATIVE_INFINITY,
        walkOffset: doubleCandidate.walkOffset,
      },
      preferHalf,
      allowDouble,
    });
    const candidates =
      Number.isFinite(halfCandidate.correlation) &&
      toLogCorrelation(halfCandidate.correlation) >= logCorrelationCutoff
        ? [{ periodSamples: halfCandidate.periodSamples, variant: "half" }]
        : [
            { periodSamples: originalPeriod.periodSamples, variant: "original" },
            { periodSamples: halfCandidate.periodSamples, variant: "half" },
          ];
    if (allowDouble) {
      candidates.push({ periodSamples: doubleCandidate.periodSamples, variant: "double" });
    }
    for (const candidate of candidates) {
      const roundedCandidate = Math.max(1, Math.round(candidate.periodSamples));
      if (!isPeriodInVoiceRange(roundedCandidate, sampleRate)) continue;
      if (seenPeriods.has(roundedCandidate)) continue;
      seenPeriods.add(roundedCandidate);
      dedupedPeriods.push({
        periodSamples: roundedCandidate,
        pointPair: originalPeriod.pointPair,
        originalPeriodSamples: originalPeriod.periodSamples,
        variant: candidate.variant,
        type,
      });
    }
  }
  return {
    originalPeriods: originalPeriods.map((item) => item.periodSamples),
    dedupedPeriods,
    candidateFamilies,
  };
}

export function detectPitchFromRawWindow(samples, sampleRate, options = null) {
  if (!(samples instanceof Float32Array) || samples.length < 3 || !(sampleRate > 0)) {
    return { hz: Number.NaN, debug: null };
  }

  const peakCount = Number.isFinite(options?.peakCount)
    ? Math.max(2, Math.floor(options.peakCount))
    : DEFAULT_PEAK_COUNT;
  const logCorrelationCutoff = Number.isFinite(options?.logCorrelationCutoff)
    ? Math.max(0, Math.min(2, options.logCorrelationCutoff))
    : DEFAULT_LOG_CORRELATION_CUTOFF;
  const maxComparisonPatches = Number.isFinite(options?.maxComparisonPatches)
    ? Math.max(2, Math.floor(options.maxComparisonPatches))
    : DEFAULT_MAX_COMPARISON_PATCHES;
  const maxWalkSteps = Number.isFinite(options?.maxWalkSteps)
    ? Math.max(0, Math.floor(options.maxWalkSteps))
    : DEFAULT_MAX_WALK_STEPS;
  const peaks = findHighestExtrema(samples, peakCount, "peak");
  const troughs = findHighestExtrema(samples, peakCount, "trough");
  const extrema = [...peaks, ...troughs].sort((a, b) => a.index - b.index);
  if (peaks.length < 2 && troughs.length < 2) {
    return {
      hz: Number.NaN,
      debug: {
        peakCount,
        logCorrelationCutoff,
        maxComparisonPatches,
        maxWalkSteps,
        extrema,
        peaks,
        troughs,
        originalCandidatePeriods: [],
        candidatePeriods: [],
        candidateFamilies: [],
        winningPointPair: null,
        winningPeriodSamples: Number.NaN,
      }
    };
  }

  const peakCandidates = buildCandidatePeriods(
    samples,
    peaks,
    sampleRate,
    logCorrelationCutoff,
    maxComparisonPatches,
    maxWalkSteps,
    "peak",
  );
  const troughCandidates = buildCandidatePeriods(
    samples,
    troughs,
    sampleRate,
    logCorrelationCutoff,
    maxComparisonPatches,
    maxWalkSteps,
    "trough",
  );
  const originalPeriods = [
    ...peakCandidates.originalPeriods,
    ...troughCandidates.originalPeriods,
  ];
  const dedupedPeriods = [...peakCandidates.dedupedPeriods, ...troughCandidates.dedupedPeriods];
  const candidateFamilies = [...peakCandidates.candidateFamilies, ...troughCandidates.candidateFamilies];
  let bestPeriodSamples = Number.NaN;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  let winningPointPair = null;
  let winningOriginalPeriodSamples = Number.NaN;
  let winningVariant = "original";
  let winningType = "peak";
  for (const candidate of dedupedPeriods) {
    const correlation = measurePeriodPatchCorrelation(
      samples,
      candidate.periodSamples,
      maxComparisonPatches,
    );
    if (correlation <= bestCorrelation) continue;
    bestCorrelation = correlation;
    bestPeriodSamples = candidate.periodSamples;
    winningPointPair = candidate.pointPair;
    winningOriginalPeriodSamples = candidate.originalPeriodSamples;
    winningVariant = candidate.variant;
    winningType = candidate.type;
  }

  const hz = bestPeriodSamples > 0 ? sampleRate / bestPeriodSamples : Number.NaN;
  const winningLogCorrelation = toLogCorrelation(bestCorrelation);
  return {
    hz,
    debug: {
      peakCount,
      logCorrelationCutoff,
      maxComparisonPatches,
      maxWalkSteps,
      extrema,
      peaks,
      troughs,
      originalCandidatePeriods: originalPeriods,
      candidatePeriods: dedupedPeriods.map((item) => item.periodSamples),
      candidateFamilies,
      winningPointPair,
      winningPeriodSamples: bestPeriodSamples,
      winningOriginalPeriodSamples,
      winningVariant,
      winningType,
      winningCorrelation: bestCorrelation,
      winningLogCorrelation,
      minHz: RAW_MIN_HZ,
      maxHz: RAW_MAX_HZ
    }
  };
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
  const peakCount = Number.isFinite(options?.peakCount)
    ? Math.max(2, Math.floor(options.peakCount))
    : DEFAULT_PEAK_COUNT;
  const logCorrelationCutoff = Number.isFinite(options?.logCorrelationCutoff)
    ? Math.max(0, Math.min(2, options.logCorrelationCutoff))
    : DEFAULT_LOG_CORRELATION_CUTOFF;
  const maxComparisonPatches = Number.isFinite(options?.maxComparisonPatches)
    ? Math.max(2, Math.floor(options.maxComparisonPatches))
    : DEFAULT_MAX_COMPARISON_PATCHES;
  const maxWalkSteps = Number.isFinite(options?.maxWalkSteps)
    ? Math.max(0, Math.floor(options.maxWalkSteps))
    : DEFAULT_MAX_WALK_STEPS;
  const rawPitchHz = new Array(fftResult.timeSec.length);
  const rawDebug = new Array(fftResult.timeSec.length);
  const fftPitchHz = new Array(fftResult.timeSec.length);
  const autocorrelationPitchHz = new Array(fftResult.timeSec.length);
  const rawMaxLogCorrelation = new Array(fftResult.timeSec.length);
  let rawElapsedMs = 0;

  for (let windowIndex = 0; windowIndex < fftResult.timeSec.length; windowIndex += 1) {
    const endSample = Math.min(
      fftResult.samples.length,
      Math.max(0, Math.round(fftResult.timeSec[windowIndex] * fftResult.sampleRate))
    );
    const startSample = Math.max(0, endSample - rawWindowSamples);
    const windowSamples = fftResult.samples.subarray(startSample, endSample);
    const startMs = performance.now();
    const rawResult = detectPitchFromRawWindow(windowSamples, fftResult.sampleRate, {
      peakCount,
      logCorrelationCutoff,
      maxComparisonPatches,
      maxWalkSteps,
    });
    const histogramPeak = getHistogramPeak(
      windowSamples,
      fftResult.sampleRate,
      maxComparisonPatches,
    );
    const maxAmplitude = getMaxAbsoluteAmplitude(windowSamples);
    const shouldPredict = predictionMask[windowIndex] === true;
    const passesRawGlobalCutoff =
      Number.isFinite(rawResult.debug?.winningLogCorrelation) &&
      rawResult.debug.winningLogCorrelation >= RAW_GLOBAL_LOG_CORRELATION_CUTOFF;
    const passesAmplitudeCutoff = maxAmplitude >= RAW_MIN_WINDOW_MAX_AMPLITUDE;
    fftPitchHz[windowIndex] = shouldPredict ? fftResult.pitchHz[windowIndex] : Number.NaN;
    rawPitchHz[windowIndex] =
      shouldPredict && passesRawGlobalCutoff && passesAmplitudeCutoff ? rawResult.hz : Number.NaN;
    autocorrelationPitchHz[windowIndex] =
      shouldPredict && passesRawGlobalCutoff && passesAmplitudeCutoff ? histogramPeak.hz : Number.NaN;
    rawMaxLogCorrelation[windowIndex] = histogramPeak.logCorrelation;
    rawDebug[windowIndex] = rawResult.debug;
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
      peakCount,
      logCorrelationCutoff,
      maxComparisonPatches,
      maxWalkSteps,
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
          : Number.NaN
    }
  };
}

export async function analyzePitchSample(audioInput, options = null) {
  const preparedSample = await loadPitchSample(audioInput);
  return analyzePreparedPitchSample(preparedSample, options);
}
