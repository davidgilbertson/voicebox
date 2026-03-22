import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { hasZeroCrossing } from "./utils.js";

const CARRY_FORWARD_WARMUP_FULL_PREDICTIONS = 5;

/*
Terminology:
- periodSize: one candidate pitch period measured in samples
- patch: one contiguous period-sized slice of the trailing compared region
- compared region: the trailing samples covered by all compared patches for a candidate period
- candidate: one candidate produced from an anchor extremum paired with an earlier extremum,
  then refined by the period walk
*/

export function getCorrelation(samples, periodSize, settings, cache = null) {
  const cachedCorrelation = cache?.correlationByPeriodSize.get(periodSize);
  if (cachedCorrelation !== undefined) {
    return cachedCorrelation;
  }

  if (periodSize < 1) return 0;
  const sampleCount = samples.length;
  const patchCount = Math.min(settings.maxComparisonPatches, Math.floor(sampleCount / periodSize));
  if (patchCount < 2) return 0;

  const stride = Math.ceil(periodSize / settings.corrSamplePoints);
  let totalCorrelation = 0;
  let comparisonCount = 0;

  let rightStart = sampleCount - periodSize;
  let leftStart = rightStart - periodSize;
  if (leftStart < 0) return 0;

  let dot = 0;
  let leftPower = 0;
  let rightPower = 0;
  let hasZeroCrossing = false;
  let lastRightSample = samples[rightStart];
  for (let leftIndex = leftStart, rightIndex = rightStart; rightIndex < rightStart + periodSize; ) {
    const left = samples[leftIndex];
    const right = samples[rightIndex];
    if (!hasZeroCrossing && rightIndex > rightStart && lastRightSample < 0 !== right < 0) {
      hasZeroCrossing = true;
    }
    lastRightSample = right;
    dot += left * right;
    leftPower += left * left;
    rightPower += right * right;
    leftIndex += stride;
    rightIndex += stride;
  }

  if (!hasZeroCrossing) return 0;
  if (leftPower > 0 && rightPower > 0) {
    totalCorrelation += dot / Math.sqrt(leftPower * rightPower);
    comparisonCount += 1;
  }

  rightStart -= periodSize;
  leftStart -= periodSize;
  for (let patchIndex = 1; patchIndex < patchCount - 1; patchIndex += 1) {
    if (leftStart < 0) break;

    dot = 0;
    leftPower = 0;
    rightPower = 0;
    for (
      let leftIndex = leftStart, rightIndex = rightStart;
      rightIndex < rightStart + periodSize;
    ) {
      const left = samples[leftIndex];
      const right = samples[rightIndex];
      dot += left * right;
      leftPower += left * left;
      rightPower += right * right;
      leftIndex += stride;
      rightIndex += stride;
    }

    if (leftPower > 0 && rightPower > 0) {
      totalCorrelation += dot / Math.sqrt(leftPower * rightPower);
      comparisonCount += 1;
    }

    rightStart -= periodSize;
    leftStart -= periodSize;
  }

  const correlation = comparisonCount > 0 ? totalCorrelation / comparisonCount : 0;
  cache?.correlationByPeriodSize.set(periodSize, correlation);
  return correlation;
}

// Quick window-level checks let us bail out before the slower candidate search.
function getWindowStats(samples) {
  let zeroCrossingCount = 0;
  let lastSample = samples[0];
  let maxAmplitude = Math.abs(lastSample);

  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const absolute = Math.abs(sample);
    if (absolute > maxAmplitude) maxAmplitude = absolute;
    if (lastSample < 0 !== sample < 0) {
      zeroCrossingCount += 1;
    }
    lastSample = sample;
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
function getWalkedPeriod(
  samples,
  seedPeriodSize,
  settings,
  sampleRate,
  mode = "candidateSearch",
  cache = null,
) {
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
      : mode === "carryForward"
        ? {
            periodSize: bestPeriodSize,
            correlation: bestCorrelation,
            hz: refinedHz,
          }
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

export function getWalkedPitchHz(samples, sampleRate, seedHz, settings) {
  const seedPeriodSize = Math.round(sampleRate / seedHz);
  const walkedPeriod = getWalkedPeriod(samples, seedPeriodSize, settings, sampleRate);
  return walkedPeriod ? walkedPeriod.hz : Number.NaN;
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

function getFoldExtremaFromWaveform(samples, settings) {
  const peaks = [];
  const troughs = [];
  let foldIndex = 0;
  const maxFoldCount = settings.maxCrossingsPerPeriod * 2;
  // We tried keeping multiple extrema per fold, but one worked just as well and was ~30% faster.
  let rightSample = samples[samples.length - 1];
  let currentSample = samples[samples.length - 2];
  let type = currentSample > 0 ? "peak" : currentSample < 0 ? "trough" : null;
  let bestIndex = type ? samples.length - 2 : -1;
  let bestValue = currentSample;

  for (
    let sampleIndex = samples.length - 2;
    sampleIndex > 0 && foldIndex < maxFoldCount;
    sampleIndex -= 1
  ) {
    const leftSample = samples[sampleIndex - 1];
    if (currentSample < 0 !== rightSample < 0) {
      if (bestIndex !== -1 && !(foldIndex === 0 && bestIndex === samples.length - 1)) {
        const extremum = {
          index: bestIndex,
          value: bestValue,
          type,
          foldIndex,
        };
        if (type === "peak") {
          peaks.push(extremum);
        } else {
          troughs.push(extremum);
        }
      }
      foldIndex += 1;
      if (foldIndex >= maxFoldCount) {
        break;
      }

      type = currentSample > 0 ? "peak" : currentSample < 0 ? "trough" : null;
      bestIndex = type ? sampleIndex : -1;
      bestValue = currentSample;
    }

    if (
      type !== null &&
      (bestIndex === -1 ||
        (type === "peak" ? currentSample >= bestValue : currentSample <= bestValue))
    ) {
      bestIndex = sampleIndex;
      bestValue = currentSample;
    }

    rightSample = currentSample;
    currentSample = leftSample;
  }

  if (
    foldIndex < maxFoldCount &&
    bestIndex !== -1 &&
    !(foldIndex === 0 && bestIndex === samples.length - 1)
  ) {
    const extremum = {
      index: bestIndex,
      value: bestValue,
      type,
      foldIndex,
    };
    if (type === "peak") {
      peaks.push(extremum);
    } else {
      troughs.push(extremum);
    }
  }

  return {
    peaks,
    troughs,
  };
}

function getCandidatesFromExtrema(samples, sampleRate, foldExtrema, settings, cache = null) {
  const candidates = [];

  for (const [type, typedExtrema] of [
    ["peak", foldExtrema.peaks],
    ["trough", foldExtrema.troughs],
  ]) {
    const anchor = typedExtrema[0];
    if (!anchor) continue;

    for (let extremumIndex = 0; extremumIndex < typedExtrema.length; extremumIndex += 1) {
      const earlierExtremum = typedExtrema[extremumIndex];
      if (earlierExtremum.index === anchor.index) continue;
      if (earlierExtremum.foldIndex === anchor.foldIndex) continue;

      const sourcePeriodSize = anchor.index - earlierExtremum.index;
      if (sourcePeriodSize < 1) continue;
      const sourceHz = sampleRate / sourcePeriodSize;
      if (sourceHz < PICA_MIN_HZ || sourceHz > PICA_MAX_HZ) continue;

      const walkedPeriod = getWalkedPeriod(
        samples,
        sourcePeriodSize,
        settings,
        sampleRate,
        "candidateSearch",
        cache,
      );
      if (!walkedPeriod || walkedPeriod.correlation < settings.minCorr) continue;
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

function getPicaPitchResultFromAnalysis(analysis) {
  if (analysis.maxAmplitude < analysis.settings.minAmp) {
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
    analysis.winningCandidate.type !== "carryForward" &&
    analysis.winningCandidate.comparedRegionMaxAmplitude !== undefined &&
    analysis.winningCandidate.comparedRegionMaxAmplitude < analysis.settings.minAmp
  ) {
    return {
      hz: Number.NaN,
      rejectionReason: "low_candidate_amplitude",
    };
  }

  if (
    analysis.winningCandidate.type !== "carryForward" &&
    analysis.winningCandidate.correlation < analysis.settings.minCorr
  ) {
    return {
      hz: Number.NaN,
      rejectionReason: "low_correlation",
    };
  }

  return {
    hz: analysis.winningCandidate.hz,
    rejectionReason: null,
  };
}

function getCarryForwardCandidate(samples, sampleRate, settings, priorStep, cache = null) {
  const threshold = settings.minCarryCorr;
  if (
    !Number.isFinite(priorStep?.hz) ||
    !Number.isFinite(priorStep?.correlation) ||
    priorStep.fullPredictionCountSinceLastNaN < CARRY_FORWARD_WARMUP_FULL_PREDICTIONS ||
    priorStep.carryForwardRunLength >= settings.maxCarryRun ||
    priorStep.correlation <= threshold
  ) {
    return null;
  }

  const sourcePeriodSize = Math.round(sampleRate / priorStep.hz);
  const walkedPeriod = getWalkedPeriod(
    samples,
    sourcePeriodSize,
    settings,
    sampleRate,
    "carryForward",
    cache,
  );
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

export function getPicaPitchAnalysisFromWaveform(samples, sampleRate, settings, priorStep = null) {
  const cache = {
    correlationByPeriodSize: new Map(),
    maxAmplitudeFromRight: undefined,
    walkedPeriodByPeriodSize: new Map(),
  };
  const { zeroCrossingCount, maxAmplitude } = getWindowStats(samples);
  const analysis = {
    settings,
    zeroCrossingCount,
    maxAmplitude,
    foldExtrema: { peaks: [], troughs: [] },
    candidates: [],
    winningCandidate: null,
  };

  if (maxAmplitude < settings.minAmp || zeroCrossingCount === 0) {
    return {
      ...analysis,
      ...getPicaPitchResultFromAnalysis(analysis),
    };
  }

  const priorSuppressedOctaveJumpCount = priorStep?.suppressedOctaveJumpCount ?? 0;
  const fastPathCarryForwardCandidate =
    priorSuppressedOctaveJumpCount > 0
      ? null
      : getCarryForwardCandidate(samples, sampleRate, settings, priorStep, cache);
  const extrema = fastPathCarryForwardCandidate
    ? { peaks: [], troughs: [] }
    : getFoldExtremaFromWaveform(samples, settings);
  const { candidates, winningCandidate } = fastPathCarryForwardCandidate
    ? {
        candidates: [],
        winningCandidate: fastPathCarryForwardCandidate,
      }
    : getCandidatesFromExtrema(samples, sampleRate, extrema, settings, cache);
  let suppressedOctaveJumpCount = 0;
  let resolvedWinningCandidate = winningCandidate;

  // If the pitch jumps a lot from the previous step with a full search,
  //  we force a carryForward pass instead.
  if (
    !fastPathCarryForwardCandidate &&
    resolvedWinningCandidate?.type !== "carryForward" &&
    Number.isFinite(resolvedWinningCandidate?.hz) &&
    Number.isFinite(priorStep?.hz)
  ) {
    const diff = resolvedWinningCandidate.hz / priorStep.hz;
    // Around 1000 cents is close to an octave jump, so allow some wriggle room around 1:2 and 2:1.
    if (diff < 0.56 || diff > 1.8) {
      const sourcePeriodSize = Math.round(sampleRate / priorStep.hz);
      const walkedPeriod = getWalkedPeriod(
        samples,
        sourcePeriodSize,
        settings,
        sampleRate,
        "carryForward",
        cache,
      );
      if (walkedPeriod && priorSuppressedOctaveJumpCount < 2) {
        suppressedOctaveJumpCount = priorSuppressedOctaveJumpCount + 1;
        resolvedWinningCandidate = {
          type: "carryForward",
          sourcePeriodSize,
          periodSize: walkedPeriod.periodSize,
          hz: walkedPeriod.hz,
          correlation: walkedPeriod.correlation,
          comparedRegionMaxAmplitude: walkedPeriod.comparedRegionMaxAmplitude,
        };
      }
    }
  }
  const completedAnalysis = {
    ...analysis,
    foldExtrema: extrema,
    candidates,
    winningCandidate: resolvedWinningCandidate,
    suppressedOctaveJumpCount,
  };
  const picaPitchResult = getPicaPitchResultFromAnalysis(completedAnalysis);

  return {
    ...completedAnalysis,
    ...picaPitchResult,
  };
}
