import {
  PICA_MAX_HZ,
  PICA_MIN_HZ,
  PICA_MIN_WINDOW_MAX_AMPLITUDE,
  PICA_SETTINGS_DEFAULTS,
} from "./config.js";
import { getLogCorrelation, hasZeroCrossing } from "./utils.js";
export function getPicaSettings(settings = {}) {
  return {
    ...PICA_SETTINGS_DEFAULTS,
    ...settings,
    maxExtremaPerFold: settings.maxExtremaPerFold ?? PICA_SETTINGS_DEFAULTS.maxExtremaPerFold,
    carryForwardLogCorrelationThreshold:
      settings.carryForwardLogCorrelationThreshold ??
      PICA_SETTINGS_DEFAULTS.carryForwardLogCorrelationThreshold,
    picaGlobalLogCorrelationCutoff:
      settings.picaGlobalLogCorrelationCutoff ??
      PICA_SETTINGS_DEFAULTS.picaGlobalLogCorrelationCutoff,
    hzWeight: settings.hzWeight ?? PICA_SETTINGS_DEFAULTS.hzWeight,
    correlationWeight: settings.correlationWeight ?? PICA_SETTINGS_DEFAULTS.correlationWeight,
    normalizeHz: settings.normalizeHz ?? PICA_SETTINGS_DEFAULTS.normalizeHz,
    normalizeCorrelation:
      settings.normalizeCorrelation ?? PICA_SETTINGS_DEFAULTS.normalizeCorrelation,
  };
}

function getCorrelationFromPeriod(samples, periodSamples, maxComparisonPatches) {
  if (periodSamples < 1) return -1;
  const patchCount = Math.min(maxComparisonPatches, Math.floor(samples.length / periodSamples));
  if (patchCount < 2) return -1;
  const corrSamplePoints = 30;
  const stride = Math.max(1, Math.floor(periodSamples / corrSamplePoints));

  let totalCorrelation = 0;
  let comparisonCount = 0;
  for (let patchIndex = 0; patchIndex < patchCount - 1; patchIndex += 1) {
    const rightEnd = samples.length - patchIndex * periodSamples;
    const rightStart = rightEnd - periodSamples;
    const leftStart = rightStart - periodSamples;
    if (leftStart < 0) break;

    let dot = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let sampleIndex = 0; sampleIndex < periodSamples; sampleIndex += stride) {
      const left = samples[leftStart + sampleIndex];
      const right = samples[rightStart + sampleIndex];
      dot += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }
    if (leftPower <= 0 || rightPower <= 0) continue;
    totalCorrelation += dot / Math.sqrt(leftPower * rightPower);
    // totalCorrelation += dot;
    comparisonCount += 1;
  }

  return comparisonCount > 0 ? totalCorrelation / comparisonCount : -1;
}

function createWindowAnalysisCache() {
  return {
    correlationByPeriodSamples: new Map(),
    comparedRegionMaxAmplitudeByPeriodSamples: new Map(),
    walkedPeriodByPeriodSamples: new Map(),
  };
}

function getWindowStats(samples) {
  let zeroCrossingCount = 0;
  let maxAmplitude = 0;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const absolute = Math.abs(sample);
    if (absolute > maxAmplitude) {
      maxAmplitude = absolute;
    }
    if (sampleIndex > 0 && hasZeroCrossing(samples[sampleIndex - 1], sample)) {
      zeroCrossingCount += 1;
    }
  }

  return {
    zeroCrossingCount,
    maxAmplitude,
  };
}

function getCachedCorrelation(samples, periodSamples, settings, cache) {
  const cachedCorrelation = cache?.correlationByPeriodSamples.get(periodSamples);
  if (cachedCorrelation !== undefined) {
    return cachedCorrelation;
  }

  const correlation = getCorrelationFromPeriod(
    samples,
    periodSamples,
    settings.maxComparisonPatches,
  );
  cache?.correlationByPeriodSamples.set(periodSamples, correlation);
  return correlation;
}

function getComparedRegionMaxAmplitude(samples, periodSamples, maxComparisonPatches) {
  if (periodSamples < 1) return 0;
  const patchCount = Math.min(maxComparisonPatches, Math.floor(samples.length / periodSamples));
  if (patchCount < 2) return 0;

  const startSample = Math.max(0, samples.length - patchCount * periodSamples);
  let maxAmplitude = 0;
  for (let sampleIndex = startSample; sampleIndex < samples.length; sampleIndex += 1) {
    const amplitude = Math.abs(samples[sampleIndex]);
    if (amplitude > maxAmplitude) {
      maxAmplitude = amplitude;
    }
  }
  return maxAmplitude;
}

function getCachedComparedRegionMaxAmplitude(samples, periodSamples, settings, cache) {
  const cachedMaxAmplitude = cache?.comparedRegionMaxAmplitudeByPeriodSamples.get(periodSamples);
  if (cachedMaxAmplitude !== undefined) {
    return cachedMaxAmplitude;
  }

  const maxAmplitude = getComparedRegionMaxAmplitude(
    samples,
    periodSamples,
    settings.maxComparisonPatches,
  );
  cache?.comparedRegionMaxAmplitudeByPeriodSamples.set(periodSamples, maxAmplitude);
  return maxAmplitude;
}

function getRefinedPitchHz(samples, periodSamples, sampleRate, settings, cache = null) {
  const centerCorrelation = getCachedCorrelation(samples, periodSamples, settings, cache);
  const lowerCorrelation = getCachedCorrelation(samples, periodSamples - 1, settings, cache);
  const higherCorrelation = getCachedCorrelation(samples, periodSamples + 1, settings, cache);
  const curvature = lowerCorrelation - 2 * centerCorrelation + higherCorrelation;
  if (curvature === 0) {
    return sampleRate / periodSamples;
  }

  const offset = (lowerCorrelation - higherCorrelation) / (2 * curvature);
  if (offset < -1 || offset > 1) {
    return sampleRate / periodSamples;
  }

  return sampleRate / (periodSamples + offset);
}

function getPeriodSampleBounds(sampleRate) {
  const minPeriodSamples = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSamples = Math.max(minPeriodSamples, Math.floor(sampleRate / PICA_MIN_HZ));
  return {
    minPeriodSamples,
    maxPeriodSamples,
  };
}

function getWalkedPeriod(samples, seedPeriodSamples, settings, sampleRate, cache = null) {
  const cachedWalkedPeriod = cache?.walkedPeriodByPeriodSamples.get(seedPeriodSamples);
  if (cachedWalkedPeriod !== undefined) {
    return cachedWalkedPeriod;
  }

  let bestPeriodSamples = seedPeriodSamples;
  let bestCorrelation = getCachedCorrelation(samples, seedPeriodSamples, settings, cache);
  const visitedPeriodSamples = [seedPeriodSamples];

  let step = 0;
  while (step < settings.maxWalkSteps) {
    const walkStepSize = bestPeriodSamples % 2 === 0 ? 2 : 1;
    let lowerPeriodSamples = bestPeriodSamples - walkStepSize;
    let higherPeriodSamples = bestPeriodSamples + walkStepSize;
    let lowerCorrelation =
      lowerPeriodSamples > 0
        ? getCachedCorrelation(samples, lowerPeriodSamples, settings, cache)
        : -1;
    let higherCorrelation = getCachedCorrelation(samples, higherPeriodSamples, settings, cache);

    if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
      lowerPeriodSamples = bestPeriodSamples - 1;
      higherPeriodSamples = bestPeriodSamples + 1;
      lowerCorrelation =
        lowerPeriodSamples > 0
          ? getCachedCorrelation(samples, lowerPeriodSamples, settings, cache)
          : -1;
      higherCorrelation = getCachedCorrelation(samples, higherPeriodSamples, settings, cache);
      if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
        break;
      }
    }

    if (higherCorrelation > lowerCorrelation) {
      bestPeriodSamples = higherPeriodSamples;
      bestCorrelation = higherCorrelation;
      visitedPeriodSamples.push(bestPeriodSamples);
      step += 1;
      continue;
    }

    bestPeriodSamples = lowerPeriodSamples;
    bestCorrelation = lowerCorrelation;
    visitedPeriodSamples.push(bestPeriodSamples);
    step += 1;
  }

  const refinedHz = getRefinedPitchHz(samples, bestPeriodSamples, sampleRate, settings, cache);
  const walkedPeriod =
    refinedHz < PICA_MIN_HZ || refinedHz > PICA_MAX_HZ
      ? null
      : {
          periodSamples: bestPeriodSamples,
          correlation: bestCorrelation,
          logCorrelation: getLogCorrelation(bestCorrelation),
          comparedRegionMaxAmplitude: getCachedComparedRegionMaxAmplitude(
            samples,
            bestPeriodSamples,
            settings,
            cache,
          ),
          hz: refinedHz,
        };

  for (const periodSamples of visitedPeriodSamples) {
    cache?.walkedPeriodByPeriodSamples.set(periodSamples, walkedPeriod);
  }

  return walkedPeriod;
}

export function getWalkedPitchHz(samples, sampleRate, seedHz, settings = PICA_SETTINGS_DEFAULTS) {
  const picaSettings = getPicaSettings(settings);
  const seedPeriodSamples = Math.round(sampleRate / seedHz);
  const walkedPeriod = getWalkedPeriod(samples, seedPeriodSamples, picaSettings, sampleRate);
  return walkedPeriod ? walkedPeriod.hz : Number.NaN;
}

function getLocalExtremaFromFold(samples, fold, type) {
  const matches = [];
  for (let sampleIndex = fold.startSample + 1; sampleIndex < fold.endSample - 1; sampleIndex += 1) {
    const previous = samples[sampleIndex - 1];
    const current = samples[sampleIndex];
    const next = samples[sampleIndex + 1];
    const isPeak = previous < current && current > next;
    const isTrough = previous > current && current < next;
    if (type === "peak" && isPeak) {
      matches.push({ index: sampleIndex, value: current });
    }
    if (type === "trough" && isTrough) {
      matches.push({ index: sampleIndex, value: current });
    }
  }
  return matches;
}

function getExtremaFromFold(samples, fold, maxExtremaPerFold, requireStrictLocalExtrema) {
  const type = fold.type;
  if (!type) return [];

  const localExtrema = getLocalExtremaFromFold(samples, fold, type);
  if (localExtrema.length === 0 && requireStrictLocalExtrema) {
    return [];
  }

  const extrema = localExtrema.length
    ? localExtrema
    : (() => {
        let strongestIndex = fold.startSample;
        for (
          let sampleIndex = fold.startSample + 1;
          sampleIndex < fold.endSample;
          sampleIndex += 1
        ) {
          if (Math.abs(samples[sampleIndex]) > Math.abs(samples[strongestIndex])) {
            strongestIndex = sampleIndex;
          }
        }
        return [
          {
            index: strongestIndex,
            value: samples[strongestIndex],
          },
        ];
      })();

  if (extrema.length <= maxExtremaPerFold) {
    return [...extrema]
      .sort((left, right) => right.index - left.index)
      .map((extremum) => ({
        ...extremum,
        type,
        foldIndex: fold.foldIndex,
      }));
  }

  return extrema
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, maxExtremaPerFold)
    .sort((left, right) => right.index - left.index)
    .map((extremum) => ({
      ...extremum,
      type,
      foldIndex: fold.foldIndex,
    }));
}

function getRecentFoldsFromWaveform(samples, maxCrossingsPerPeriod) {
  const folds = [];
  let foldEndSample = samples.length;
  let foldStartSample = samples.length - 1;

  while (foldStartSample > 0 && folds.length < maxCrossingsPerPeriod * 2) {
    let type = null;
    while (
      foldStartSample > 0 &&
      !hasZeroCrossing(samples[foldStartSample - 1], samples[foldStartSample])
    ) {
      if (type === null) {
        const sample = samples[foldStartSample];
        if (sample > 0) type = "peak";
        if (sample < 0) type = "trough";
      }
      foldStartSample -= 1;
    }

    if (type === null) {
      const sample = samples[foldStartSample];
      if (sample > 0) type = "peak";
      if (sample < 0) type = "trough";
    }

    folds.push({
      foldIndex: folds.length,
      startSample: foldStartSample,
      endSample: foldEndSample,
      type,
    });

    if (foldStartSample === 0) break;
    foldEndSample = foldStartSample;
    foldStartSample -= 1;
  }

  return folds;
}

function getFoldExtremaFromWaveform(samples, settings) {
  const recentFolds = getRecentFoldsFromWaveform(samples, settings.maxCrossingsPerPeriod);
  return recentFolds.flatMap((fold) =>
    getExtremaFromFold(samples, fold, settings.maxExtremaPerFold, fold.foldIndex === 0),
  );
}

function getAnchorFromTypedExtrema(typedExtrema, type) {
  const anchorFoldIndex = typedExtrema[0]?.foldIndex;
  if (anchorFoldIndex === undefined) return null;

  let anchor = typedExtrema[0];
  for (let extremumIndex = 1; extremumIndex < typedExtrema.length; extremumIndex += 1) {
    const extremum = typedExtrema[extremumIndex];
    if (extremum.foldIndex !== anchorFoldIndex) break;
    if (type === "peak" ? extremum.value > anchor.value : extremum.value < anchor.value) {
      anchor = extremum;
    }
  }
  return anchor;
}

function getCandidateFamiliesFromExtrema(samples, sampleRate, foldExtrema, settings, cache = null) {
  const candidateFamilies = [];
  const peakExtrema = [];
  const troughExtrema = [];
  let hzMin = Number.POSITIVE_INFINITY;
  let hzMax = Number.NEGATIVE_INFINITY;
  let correlationMin = Number.POSITIVE_INFINITY;
  let correlationMax = Number.NEGATIVE_INFINITY;

  for (const extremum of foldExtrema) {
    if (extremum.type === "peak") {
      peakExtrema.push(extremum);
      continue;
    }
    troughExtrema.push(extremum);
  }

  for (const [type, typedExtrema] of [
    ["peak", peakExtrema],
    ["trough", troughExtrema],
  ]) {
    const anchor = getAnchorFromTypedExtrema(typedExtrema, type);
    if (!anchor) continue;

    for (let extremumIndex = 0; extremumIndex < typedExtrema.length; extremumIndex += 1) {
      const earlierExtremum = typedExtrema[extremumIndex];
      if (earlierExtremum.index === anchor.index) continue;
      if (earlierExtremum.foldIndex === anchor.foldIndex) continue;

      const sourcePeriodSamples = anchor.index - earlierExtremum.index;
      if (sourcePeriodSamples < 1) continue;
      const sourceHz = sampleRate / sourcePeriodSamples;
      if (sourceHz < PICA_MIN_HZ || sourceHz > PICA_MAX_HZ) continue;

      const walkedPeriod = getWalkedPeriod(
        samples,
        sourcePeriodSamples,
        settings,
        sampleRate,
        cache,
      );
      if (!walkedPeriod) continue;
      const hzFeature = Math.log2(walkedPeriod.hz / PICA_MIN_HZ);
      const correlationFeature = walkedPeriod.logCorrelation;
      if (hzFeature < hzMin) hzMin = hzFeature;
      if (hzFeature > hzMax) hzMax = hzFeature;
      if (correlationFeature < correlationMin) correlationMin = correlationFeature;
      if (correlationFeature > correlationMax) correlationMax = correlationFeature;

      candidateFamilies.push({
        type,
        pointPair: [anchor.index, earlierExtremum.index],
        sourcePeriodSamples,
        periodSamples: walkedPeriod.periodSamples,
        hz: walkedPeriod.hz,
        correlation: walkedPeriod.correlation,
        logCorrelation: walkedPeriod.logCorrelation,
        comparedRegionMaxAmplitude: walkedPeriod.comparedRegionMaxAmplitude,
        hzFeature,
        correlationFeature,
      });
    }
  }

  if (candidateFamilies.length === 0) {
    return {
      candidateFamilies,
      winningCandidate: null,
    };
  }

  const normalize = (value, min, max) => (max > min ? (value - min) / (max - min) : 0);
  let winningCandidate = null;
  for (const candidate of candidateFamilies) {
    const normalizedHzFeature = settings.normalizeHz
      ? normalize(candidate.hzFeature, hzMin, hzMax)
      : candidate.hzFeature;
    const normalizedCorrelationFeature = settings.normalizeCorrelation
      ? normalize(candidate.correlationFeature, correlationMin, correlationMax)
      : candidate.correlationFeature;
    candidate.normalizedHzFeature = normalizedHzFeature;
    candidate.normalizedCorrelationFeature = normalizedCorrelationFeature;
    candidate.weightedScore =
      settings.hzWeight * normalizedHzFeature +
      settings.correlationWeight * normalizedCorrelationFeature;
    if (!winningCandidate || candidate.weightedScore > winningCandidate.weightedScore) {
      winningCandidate = candidate;
    }
  }
  return {
    candidateFamilies,
    winningCandidate,
  };
}

function getPicaPitchResultFromAnalysis(analysis, settings) {
  if (analysis.maxAmplitude < PICA_MIN_WINDOW_MAX_AMPLITUDE) {
    return {
      hz: Number.NaN,
      rejectionReason: "low_amplitude",
    };
  }

  if (analysis.zeroCrossingCount === 0) {
    return {
      hz: Number.NaN,
      rejectionReason: "no_zero_crossings",
    };
  }

  if (!analysis.winningCandidate) {
    return {
      hz: Number.NaN,
      rejectionReason: "no_candidates",
    };
  }

  if (analysis.winningCandidate.logCorrelation < settings.picaGlobalLogCorrelationCutoff) {
    return {
      hz: Number.NaN,
      rejectionReason: "low_log_correlation",
    };
  }

  if (
    analysis.winningCandidate.comparedRegionMaxAmplitude !== undefined &&
    analysis.winningCandidate.comparedRegionMaxAmplitude < PICA_MIN_WINDOW_MAX_AMPLITUDE
  ) {
    return {
      hz: Number.NaN,
      rejectionReason: "low_candidate_amplitude",
    };
  }

  return {
    hz: analysis.winningCandidate.hz,
    rejectionReason: null,
  };
}

function getCarryForwardCandidate(samples, sampleRate, settings, priorStep, cache = null) {
  const threshold = settings.carryForwardLogCorrelationThreshold;
  if (
    !Number.isFinite(priorStep?.hz) ||
    !Number.isFinite(priorStep?.logCorrelation) ||
    priorStep.logCorrelation <= threshold
  ) {
    return null;
  }

  const sourcePeriodSamples = Math.round(sampleRate / priorStep.hz);
  const walkedPeriod = getWalkedPeriod(samples, sourcePeriodSamples, settings, sampleRate, cache);
  if (!walkedPeriod || walkedPeriod.logCorrelation <= threshold) {
    return null;
  }
  return {
    type: "carryForward",
    sourcePeriodSamples,
    periodSamples: walkedPeriod.periodSamples,
    hz: walkedPeriod.hz,
    correlation: walkedPeriod.correlation,
    logCorrelation: walkedPeriod.logCorrelation,
    comparedRegionMaxAmplitude: walkedPeriod.comparedRegionMaxAmplitude,
  };
}

export function getPicaPitchAnalysisFromWaveform(
  samples,
  sampleRate,
  settings = PICA_SETTINGS_DEFAULTS,
  priorStep = null,
) {
  const picaSettings = getPicaSettings(settings);
  const cache = createWindowAnalysisCache();
  const { zeroCrossingCount, maxAmplitude } = getWindowStats(samples);
  const analysis = {
    zeroCrossingCount,
    maxAmplitude,
    foldExtrema: [],
    candidateFamilies: [],
    winningCandidate: null,
  };

  if (maxAmplitude < PICA_MIN_WINDOW_MAX_AMPLITUDE || zeroCrossingCount === 0) {
    return {
      ...analysis,
      ...getPicaPitchResultFromAnalysis(analysis, picaSettings),
    };
  }

  const carryForwardCandidate = getCarryForwardCandidate(
    samples,
    sampleRate,
    picaSettings,
    priorStep,
    cache,
  );
  const foldExtrema = getFoldExtremaFromWaveform(samples, picaSettings);
  const { candidateFamilies, winningCandidate } = carryForwardCandidate
    ? {
        candidateFamilies: [],
        winningCandidate: carryForwardCandidate,
      }
    : getCandidateFamiliesFromExtrema(samples, sampleRate, foldExtrema, picaSettings, cache);
  const completedAnalysis = {
    ...analysis,
    foldExtrema,
    candidateFamilies,
    winningCandidate,
  };
  const picaPitchResult = getPicaPitchResultFromAnalysis(completedAnalysis, picaSettings);

  return {
    ...completedAnalysis,
    ...picaPitchResult,
  };
}

export function buildPicaCorrelationHistogram(
  samples,
  sampleRate,
  settings = PICA_SETTINGS_DEFAULTS,
) {
  const picaSettings = getPicaSettings(settings);
  const cache = createWindowAnalysisCache();
  const hz = [];
  const correlation = [];
  const logCorrelation = [];
  const { minPeriodSamples, maxPeriodSamples } = getPeriodSampleBounds(sampleRate);
  for (
    let periodSamples = maxPeriodSamples;
    periodSamples >= minPeriodSamples;
    periodSamples -= 1
  ) {
    const candidateHz = sampleRate / periodSamples;
    const candidateCorrelation = getCachedCorrelation(samples, periodSamples, picaSettings, cache);
    hz.push(candidateHz);
    correlation.push(candidateCorrelation);
    logCorrelation.push(getLogCorrelation(candidateCorrelation));
  }
  return {
    minHz: PICA_MIN_HZ,
    maxHz: PICA_MAX_HZ,
    hz,
    correlation,
    logCorrelation,
  };
}

export function evaluatePicaWindow(samples, sampleRate, settings = PICA_SETTINGS_DEFAULTS) {
  const analysis = getPicaPitchAnalysisFromWaveform(samples, sampleRate, settings);
  const histogram = buildPicaCorrelationHistogram(samples, sampleRate, settings);
  let bestHistogramIndex = 0;
  for (let index = 1; index < histogram.logCorrelation.length; index += 1) {
    if (histogram.logCorrelation[index] > histogram.logCorrelation[bestHistogramIndex]) {
      bestHistogramIndex = index;
    }
  }
  return {
    analysis,
    histogram,
    histogramPeakHz: histogram.hz[bestHistogramIndex],
    histogramPeakLogCorrelation: histogram.logCorrelation[bestHistogramIndex],
  };
}
