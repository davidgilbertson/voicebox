import {
  PICA_MAX_HZ,
  PICA_MIN_HZ,
  PICA_MIN_WINDOW_MAX_AMPLITUDE,
  PICA_SETTINGS_DEFAULTS,
} from "./config.js";
import { hasZeroCrossing } from "./utils.js";

/*
Terminology:
- periodSize: one candidate pitch period measured in samples
- patch: one contiguous period-sized slice of the trailing compared region
- compared region: the trailing samples covered by all compared patches for a candidate period
- candidate: one candidate produced from an anchor extremum paired with an earlier extremum,
  then refined by the period walk
*/

export function getPicaSettings(settings = {}) {
  return {
    ...PICA_SETTINGS_DEFAULTS,
    ...settings,
    maxExtremaPerFold: settings.maxExtremaPerFold ?? PICA_SETTINGS_DEFAULTS.maxExtremaPerFold,
    carryForwardCorrelationThreshold:
      settings.carryForwardCorrelationThreshold ??
      PICA_SETTINGS_DEFAULTS.carryForwardCorrelationThreshold,
    correlationToHzWeightRatio:
      settings.correlationToHzWeightRatio ?? PICA_SETTINGS_DEFAULTS.correlationToHzWeightRatio,
  };
}

function getCorrelation(samples, periodSize, settings, cache = null) {
  const cachedCorrelation = cache?.correlationByPeriodSize.get(periodSize);
  if (cachedCorrelation !== undefined) {
    return cachedCorrelation;
  }

  const comparedRegionMaxAmplitude = getComparedRegionMaxAmplitude(
    samples,
    periodSize,
    settings,
    cache,
  );
  if (comparedRegionMaxAmplitude <= 0) return -1;

  if (periodSize < 1) return -1;
  const patchCount = Math.min(
    settings.maxComparisonPatches,
    Math.floor(samples.length / periodSize),
  );
  if (patchCount < 2) return -1;
  const corrSamplePoints = 30;
  const stride = Math.max(1, Math.floor(periodSize / corrSamplePoints));

  let totalCorrelation = 0;
  let comparisonCount = 0;
  for (let patchIndex = 0; patchIndex < patchCount - 1; patchIndex += 1) {
    const rightEnd = samples.length - patchIndex * periodSize;
    const rightStart = rightEnd - periodSize;
    const leftStart = rightStart - periodSize;
    if (leftStart < 0) break;

    let dot = 0;
    for (let sampleIndex = 0; sampleIndex < periodSize; sampleIndex += stride) {
      const left = samples[leftStart + sampleIndex] / comparedRegionMaxAmplitude;
      const right = samples[rightStart + sampleIndex] / comparedRegionMaxAmplitude;
      dot += left * right;
      comparisonCount += 1;
    }
    totalCorrelation += dot;
  }
  totalCorrelation *= 100;
  const correlation = comparisonCount > 0 ? totalCorrelation / comparisonCount : -1;
  cache?.correlationByPeriodSize.set(periodSize, correlation);
  return correlation;
}

// Quick window-level checks let us bail out before the slower candidate search.
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

function getComparedRegionMaxAmplitude(samples, periodSize, settings, cache = null) {
  if (periodSize < 1) return 0;
  const patchCount = Math.min(
    settings.maxComparisonPatches,
    Math.floor(samples.length / periodSize),
  );
  if (patchCount < 2) return 0;

  const startSample = Math.max(0, samples.length - patchCount * periodSize);
  return getMaxAmplitudeFromRight(samples, cache)[startSample];
}

function getRefinedPitchHz(samples, periodSize, sampleRate, settings, cache = null) {
  const centerCorrelation = getCorrelation(samples, periodSize, settings, cache);
  const lowerCorrelation = getCorrelation(samples, periodSize - 1, settings, cache);
  const higherCorrelation = getCorrelation(samples, periodSize + 1, settings, cache);
  const curvature = lowerCorrelation - 2 * centerCorrelation + higherCorrelation;
  if (curvature === 0) {
    return sampleRate / periodSize;
  }

  const offset = (lowerCorrelation - higherCorrelation) / (2 * curvature);
  if (offset < -1 || offset > 1) {
    return sampleRate / periodSize;
  }

  return sampleRate / (periodSize + offset);
}

// Starting from one seed period, walk uphill on correlation until a local best is found.
function getWalkedPeriod(samples, seedPeriodSize, settings, sampleRate, cache = null) {
  const cachedWalkedPeriod = cache?.walkedPeriodByPeriodSize.get(seedPeriodSize);
  if (cachedWalkedPeriod !== undefined) {
    return cachedWalkedPeriod;
  }

  let bestPeriodSize = seedPeriodSize;
  let bestCorrelation = getCorrelation(samples, seedPeriodSize, settings, cache);
  const visitedPeriodSizes = [seedPeriodSize];

  let step = 0;
  while (step < settings.maxWalkSteps) {
    const walkStepSize = bestPeriodSize % 2 === 0 ? 2 : 1;
    let lowerPeriodSize = bestPeriodSize - walkStepSize;
    let higherPeriodSize = bestPeriodSize + walkStepSize;
    let lowerCorrelation =
      lowerPeriodSize > 0 ? getCorrelation(samples, lowerPeriodSize, settings, cache) : -1;
    let higherCorrelation = getCorrelation(samples, higherPeriodSize, settings, cache);

    if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
      lowerPeriodSize = bestPeriodSize - 1;
      higherPeriodSize = bestPeriodSize + 1;
      lowerCorrelation =
        lowerPeriodSize > 0 ? getCorrelation(samples, lowerPeriodSize, settings, cache) : -1;
      higherCorrelation = getCorrelation(samples, higherPeriodSize, settings, cache);
      if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
        break;
      }
    }

    if (higherCorrelation > lowerCorrelation) {
      bestPeriodSize = higherPeriodSize;
      bestCorrelation = higherCorrelation;
      visitedPeriodSizes.push(bestPeriodSize);
      step += 1;
      continue;
    }

    bestPeriodSize = lowerPeriodSize;
    bestCorrelation = lowerCorrelation;
    visitedPeriodSizes.push(bestPeriodSize);
    step += 1;
  }

  const refinedHz = getRefinedPitchHz(samples, bestPeriodSize, sampleRate, settings, cache);
  const walkedPeriod =
    refinedHz < PICA_MIN_HZ || refinedHz > PICA_MAX_HZ
      ? null
      : {
          periodSize: bestPeriodSize,
          correlation: bestCorrelation,
          comparedRegionMaxAmplitude: getComparedRegionMaxAmplitude(
            samples,
            bestPeriodSize,
            settings,
            cache,
          ),
          hz: refinedHz,
        };

  for (const periodSize of visitedPeriodSizes) {
    cache?.walkedPeriodByPeriodSize.set(periodSize, walkedPeriod);
  }

  return walkedPeriod;
}

export function getWalkedPitchHz(samples, sampleRate, seedHz, settings = PICA_SETTINGS_DEFAULTS) {
  const picaSettings = getPicaSettings(settings);
  const seedPeriodSize = Math.round(sampleRate / seedHz);
  const walkedPeriod = getWalkedPeriod(samples, seedPeriodSize, picaSettings, sampleRate);
  return walkedPeriod ? walkedPeriod.hz : Number.NaN;
}

function pushStrongestExtremum(extrema, extremum, maxExtremaPerFold) {
  if (maxExtremaPerFold < 1) {
    return;
  }

  let insertIndex = extrema.length;
  while (insertIndex > 0 && Math.abs(extremum.value) > Math.abs(extrema[insertIndex - 1].value)) {
    insertIndex -= 1;
  }
  if (insertIndex >= maxExtremaPerFold) {
    return;
  }

  extrema.splice(insertIndex, 0, extremum);
  if (extrema.length > maxExtremaPerFold) {
    extrema.length = maxExtremaPerFold;
  }
}

// This stays separate from fold/extrema scanning because the carry-forward fast path needs
// rolling max amplitude for correlation but intentionally skips fold/extrema work.
function getMaxAmplitudeFromRight(samples, cache = null) {
  if (cache?.maxAmplitudeFromRight !== undefined) {
    return cache.maxAmplitudeFromRight;
  }

  const maxAmplitudeFromRight = new Float32Array(samples.length);
  let maxAmplitude = 0;
  for (let sampleIndex = samples.length - 1; sampleIndex >= 0; sampleIndex -= 1) {
    const amplitude = Math.abs(samples[sampleIndex]);
    if (amplitude > maxAmplitude) {
      maxAmplitude = amplitude;
    }
    maxAmplitudeFromRight[sampleIndex] = maxAmplitude;
  }
  if (cache) {
    cache.maxAmplitudeFromRight = maxAmplitudeFromRight;
  }
  return maxAmplitudeFromRight;
}

function getFoldExtremaFromWaveform(samples, settings, cache = null) {
  const foldExtrema = [];
  let foldIndex = 0;
  let foldStartSample = samples.length - 1;

  while (foldStartSample > 0 && foldIndex < settings.maxCrossingsPerPeriod * 2) {
    let type = null;
    let strongestIndex = foldStartSample;
    const localExtrema = [];

    while (true) {
      const sample = samples[foldStartSample];
      if (type === null) {
        if (sample > 0) type = "peak";
        if (sample < 0) type = "trough";
      }

      if (Math.abs(sample) > Math.abs(samples[strongestIndex])) {
        strongestIndex = foldStartSample;
      }

      if (foldStartSample > 0 && foldStartSample < samples.length - 1) {
        const previous = samples[foldStartSample - 1];
        const next = samples[foldStartSample + 1];
        const isPeak = previous < sample && sample > next;
        const isTrough = previous > sample && sample < next;
        if (type === "peak" && isPeak) {
          pushStrongestExtremum(
            localExtrema,
            {
              index: foldStartSample,
              value: sample,
            },
            settings.maxExtremaPerFold,
          );
        }
        if (type === "trough" && isTrough) {
          pushStrongestExtremum(
            localExtrema,
            {
              index: foldStartSample,
              value: sample,
            },
            settings.maxExtremaPerFold,
          );
        }
      }

      if (foldStartSample === 0 || hasZeroCrossing(samples[foldStartSample - 1], sample)) {
        break;
      }
      foldStartSample -= 1;
    }

    if (type) {
      const extrema = localExtrema.length
        ? localExtrema
        : foldIndex === 0
          ? []
          : [
              {
                index: strongestIndex,
                value: samples[strongestIndex],
              },
            ];

      extrema
        .sort((left, right) => right.index - left.index)
        .forEach((extremum) => {
          foldExtrema.push({
            ...extremum,
            type,
            foldIndex,
          });
        });
    }

    if (foldStartSample === 0) break;
    foldStartSample -= 1;
    foldIndex += 1;
  }

  return foldExtrema;
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

function getCandidatesFromExtrema(samples, sampleRate, foldExtrema, settings, cache = null) {
  const candidates = [];
  const peakExtrema = [];
  const troughExtrema = [];

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

      const sourcePeriodSize = anchor.index - earlierExtremum.index;
      if (sourcePeriodSize < 1) continue;
      const sourceHz = sampleRate / sourcePeriodSize;
      if (sourceHz < PICA_MIN_HZ || sourceHz > PICA_MAX_HZ) continue;

      const walkedPeriod = getWalkedPeriod(samples, sourcePeriodSize, settings, sampleRate, cache);
      if (!walkedPeriod) continue;
      const hzFeature = Math.log2(walkedPeriod.hz / PICA_MIN_HZ);
      const correlationFeature = walkedPeriod.correlation;

      candidates.push({
        type,
        pointPair: [anchor.index, earlierExtremum.index],
        sourcePeriodSize,
        periodSize: walkedPeriod.periodSize,
        hz: walkedPeriod.hz,
        correlation: walkedPeriod.correlation,
        comparedRegionMaxAmplitude: walkedPeriod.comparedRegionMaxAmplitude,
        hzFeature,
        correlationFeature,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      candidates,
      winningCandidate: null,
    };
  }

  let winningCandidate = null;
  for (const candidate of candidates) {
    candidate.weightedScore =
      candidate.hzFeature + settings.correlationToHzWeightRatio * candidate.correlationFeature;
    if (!winningCandidate || candidate.weightedScore > winningCandidate.weightedScore) {
      winningCandidate = candidate;
    }
  }
  return {
    candidates,
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
  const threshold = settings.carryForwardCorrelationThreshold;
  if (
    !Number.isFinite(priorStep?.hz) ||
    !Number.isFinite(priorStep?.correlation) ||
    priorStep.correlation <= threshold
  ) {
    return null;
  }

  const sourcePeriodSize = Math.round(sampleRate / priorStep.hz);
  const walkedPeriod = getWalkedPeriod(samples, sourcePeriodSize, settings, sampleRate, cache);
  if (!walkedPeriod || walkedPeriod.correlation <= threshold) {
    return null;
  }
  return {
    type: "carryForward",
    sourcePeriodSize,
    periodSize: walkedPeriod.periodSize,
    hz: walkedPeriod.hz,
    correlation: walkedPeriod.correlation,
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
  const cache = {
    correlationByPeriodSize: new Map(),
    maxAmplitudeFromRight: undefined,
    walkedPeriodByPeriodSize: new Map(),
  };
  const { zeroCrossingCount, maxAmplitude } = getWindowStats(samples);
  const analysis = {
    zeroCrossingCount,
    maxAmplitude,
    foldExtrema: [],
    candidates: [],
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
  const foldExtrema = carryForwardCandidate
    ? []
    : getFoldExtremaFromWaveform(samples, picaSettings, cache);
  const { candidates, winningCandidate } = carryForwardCandidate
    ? {
        candidates: [],
        winningCandidate: carryForwardCandidate,
      }
    : getCandidatesFromExtrema(samples, sampleRate, foldExtrema, picaSettings, cache);
  const completedAnalysis = {
    ...analysis,
    foldExtrema,
    candidates,
    winningCandidate,
  };
  const picaPitchResult = getPicaPitchResultFromAnalysis(completedAnalysis, picaSettings);

  return {
    ...completedAnalysis,
    ...picaPitchResult,
  };
}
