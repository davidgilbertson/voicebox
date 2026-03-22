import { hzToCents } from "../pitchScale.js";

// Smallest peak level that counts as worth analyzing.
const PICA_MIN_AMP = 0.01;
// Number of lowest-note periods to keep in each analysis window.
const PICA_WINDOW_PERIODS = 2;
// Maximum recent zero-crossing folds to inspect for candidates.
const PICA_MAX_CROSSINGS_PER_PERIOD = 23;
// Maximum period-sized patches to compare when scoring correlation.
const PICA_MAX_COMPARISON_PATCHES = 3;
// Approximate samples per patch used when estimating correlation.
const PICA_CORR_SAMPLE_POINTS = 18;
// Maximum one-sample hill-climb steps when refining a period.
const PICA_MAX_WALK_STEPS = 60;
// Weight of correlation relative to octave position when ranking candidates.
const PICA_CORRELATION_TO_HZ_WEIGHT_RATIO = 250;
// Minimum correlation required for a fresh non-carry PICA candidate.
const PICA_MIN_CORR = 0.83;
// Minimum correlation required for carry-forward to continue.
const PICA_MIN_CARRY_CORR = 0.5;
// Maximum consecutive carry-forward hops before forcing a fresh search.
const PICA_MAX_CARRY_RUN = 10;
// Fresh predictions required after a gap before carry-forward can start.
const CARRY_FORWARD_WARMUP_STEPS = 5;

export function getPicaWindowSampleCount(sampleRate, minHz) {
  return Math.max(1, Math.ceil((PICA_WINDOW_PERIODS * sampleRate) / minHz));
}

export function fillPicaWindowSamples(ring, samples) {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = ring.at(index - samples.length);
  }
}

function getWindowStats(samples) {
  let zeroCrossingCount = 0;
  let lastSample = samples[0];
  let maxAmplitude = Math.abs(lastSample);

  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const absolute = Math.abs(sample);
    if (absolute > maxAmplitude) {
      maxAmplitude = absolute;
    }
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

function getMaxAmplitudeFromRight(samples, cache) {
  if (cache.maxAmplitudeFromRight) {
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

  cache.maxAmplitudeFromRight = maxAmplitudeFromRight;
  return maxAmplitudeFromRight;
}

function getComparedRegionMaxAmplitude(samples, periodSize, cache) {
  if (periodSize < 1) return 0;
  const patchCount = Math.min(PICA_MAX_COMPARISON_PATCHES, Math.floor(samples.length / periodSize));
  if (patchCount < 2) return 0;
  const startSample = Math.max(0, samples.length - patchCount * periodSize);
  return getMaxAmplitudeFromRight(samples, cache)[startSample];
}

function getCorrelation(samples, periodSize, cache) {
  const cachedCorrelation = cache.correlationByPeriodSize.get(periodSize);
  if (cachedCorrelation !== undefined) {
    return cachedCorrelation;
  }

  if (periodSize < 1) return -1;
  const sampleCount = samples.length;
  const patchCount = Math.min(PICA_MAX_COMPARISON_PATCHES, Math.floor(sampleCount / periodSize));
  if (patchCount < 2) return -1;

  const stride = Math.ceil(periodSize / PICA_CORR_SAMPLE_POINTS);
  let totalCorrelation = 0;
  let comparisonCount = 0;

  let rightStart = sampleCount - periodSize;
  let leftStart = rightStart - periodSize;
  if (leftStart < 0) return -1;

  let dot = 0;
  let leftPower = 0;
  let rightPower = 0;
  let hasZeroCrossing = false;
  let lastRightSample = samples[rightStart];
  for (let leftIndex = leftStart, rightIndex = rightStart; rightIndex < rightStart + periodSize; ) {
    const left = samples[leftIndex];
    const right = samples[rightIndex];
    if (!hasZeroCrossing && rightIndex > rightStart && (lastRightSample < 0) !== (right < 0)) {
      hasZeroCrossing = true;
    }
    lastRightSample = right;
    dot += left * right;
    leftPower += left * left;
    rightPower += right * right;
    leftIndex += stride;
    rightIndex += stride;
  }

  if (!hasZeroCrossing) return -1;
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
    for (let leftIndex = leftStart, rightIndex = rightStart; rightIndex < rightStart + periodSize; ) {
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

  const correlation = comparisonCount > 0 ? totalCorrelation / comparisonCount : -1;
  cache.correlationByPeriodSize.set(periodSize, correlation);
  return correlation;
}

function getRefinedPitchHz(samples, periodSize, sampleRate, cache) {
  const centerCorrelation = getCorrelation(samples, periodSize, cache);
  const lowerCorrelation = getCorrelation(samples, periodSize - 1, cache);
  const higherCorrelation = getCorrelation(samples, periodSize + 1, cache);
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

function getWalkedPeriod(
  samples,
  seedPeriodSize,
  sampleRate,
  minHz,
  maxHz,
  mode = "candidateSearch",
  cache,
) {
  const cachedWalkedPeriod = cache.walkedPeriodByPeriodSize.get(seedPeriodSize);
  if (cachedWalkedPeriod !== undefined) {
    if (
      mode !== "carryForward" &&
      cachedWalkedPeriod &&
      cachedWalkedPeriod.comparedRegionMaxAmplitude === undefined
    ) {
      cachedWalkedPeriod.comparedRegionMaxAmplitude = getComparedRegionMaxAmplitude(
        samples,
        cachedWalkedPeriod.periodSize,
        cache,
      );
    }
    return cachedWalkedPeriod;
  }

  let bestPeriodSize = seedPeriodSize;
  let bestCorrelation = getCorrelation(samples, seedPeriodSize, cache);
  const visitedPeriodSizes = [seedPeriodSize];

  let step = 0;
  while (step < PICA_MAX_WALK_STEPS) {
    const walkStepSize = bestPeriodSize % 2 === 0 ? 2 : 1;
    let lowerPeriodSize = bestPeriodSize - walkStepSize;
    let higherPeriodSize = bestPeriodSize + walkStepSize;
    let lowerCorrelation =
      lowerPeriodSize > 0 ? getCorrelation(samples, lowerPeriodSize, cache) : -1;
    let higherCorrelation = getCorrelation(samples, higherPeriodSize, cache);

    if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
      lowerPeriodSize = bestPeriodSize - 1;
      higherPeriodSize = bestPeriodSize + 1;
      lowerCorrelation = lowerPeriodSize > 0 ? getCorrelation(samples, lowerPeriodSize, cache) : -1;
      higherCorrelation = getCorrelation(samples, higherPeriodSize, cache);
      if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
        break;
      }
    }

    if (higherCorrelation > lowerCorrelation) {
      bestPeriodSize = higherPeriodSize;
      bestCorrelation = higherCorrelation;
    } else {
      bestPeriodSize = lowerPeriodSize;
      bestCorrelation = lowerCorrelation;
    }
    visitedPeriodSizes.push(bestPeriodSize);
    step += 1;
  }

  const refinedHz = getRefinedPitchHz(samples, bestPeriodSize, sampleRate, cache);
  const walkedPeriod =
    refinedHz < minHz || refinedHz > maxHz
      ? null
      : mode === "carryForward"
        ? {
            periodSize: bestPeriodSize,
            hz: refinedHz,
            correlation: bestCorrelation,
          }
        : {
            periodSize: bestPeriodSize,
            hz: refinedHz,
            correlation: bestCorrelation,
            comparedRegionMaxAmplitude: getComparedRegionMaxAmplitude(
              samples,
              bestPeriodSize,
              cache,
            ),
          };

  for (const periodSize of visitedPeriodSizes) {
    cache.walkedPeriodByPeriodSize.set(periodSize, walkedPeriod);
  }

  return walkedPeriod;
}

function getFoldExtremaFromWaveform(samples) {
  const peaks = [];
  const troughs = [];
  let foldIndex = 0;
  const maxFoldCount = PICA_MAX_CROSSINGS_PER_PERIOD * 2;
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
    if ((currentSample < 0) !== (rightSample < 0)) {
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

function getCandidatesFromExtrema(samples, sampleRate, minHz, maxHz, foldExtrema, cache) {
  let winningCandidate = null;
  for (const [type, typedExtrema] of [
    ["peak", foldExtrema.peaks],
    ["trough", foldExtrema.troughs],
  ]) {
    const anchor = typedExtrema[0];
    if (!anchor) continue;

    for (let extremumIndex = 0; extremumIndex < typedExtrema.length; extremumIndex += 1) {
      const earlierExtremum = typedExtrema[extremumIndex];
      if (
        earlierExtremum.index === anchor.index ||
        earlierExtremum.foldIndex === anchor.foldIndex
      ) {
        continue;
      }

      const sourcePeriodSize = anchor.index - earlierExtremum.index;
      if (sourcePeriodSize < 1) continue;
      const sourceHz = sampleRate / sourcePeriodSize;
      if (sourceHz < minHz || sourceHz > maxHz) continue;

      const walkedPeriod = getWalkedPeriod(
        samples,
        sourcePeriodSize,
        sampleRate,
        minHz,
        maxHz,
        "candidateSearch",
        cache,
      );
      if (
        !walkedPeriod ||
        walkedPeriod.correlation < PICA_MIN_CORR ||
        walkedPeriod.comparedRegionMaxAmplitude < PICA_MIN_AMP
      ) {
        continue;
      }

      const weightedScore =
        Math.log2(walkedPeriod.hz / minHz) +
        PICA_CORRELATION_TO_HZ_WEIGHT_RATIO * walkedPeriod.correlation;
      if (!winningCandidate || weightedScore > winningCandidate.weightedScore) {
        winningCandidate = {
          hz: walkedPeriod.hz,
          correlation: walkedPeriod.correlation,
          weightedScore,
        };
      }
    }
  }

  return winningCandidate;
}

function getCarryForwardCandidate(samples, sampleRate, minHz, maxHz, priorStep, cache) {
  if (
    !Number.isFinite(priorStep?.hz) ||
    !Number.isFinite(priorStep?.correlation) ||
    priorStep.fullPredictionCountSinceLastNaN < CARRY_FORWARD_WARMUP_STEPS ||
    priorStep.carryForwardRunLength >= PICA_MAX_CARRY_RUN ||
    priorStep.correlation <= PICA_MIN_CARRY_CORR
  ) {
    return null;
  }

  const sourcePeriodSize = Math.round(sampleRate / priorStep.hz);
  const walkedPeriod = getWalkedPeriod(
    samples,
    sourcePeriodSize,
    sampleRate,
    minHz,
    maxHz,
    "carryForward",
    cache,
  );
  if (!walkedPeriod || walkedPeriod.correlation <= PICA_MIN_CARRY_CORR) {
    return null;
  }

  return {
    type: "carryForward",
    hz: walkedPeriod.hz,
    correlation: walkedPeriod.correlation,
  };
}

function getPriorStep(result, priorStep) {
  if (!Number.isFinite(result?.hz) || !Number.isFinite(result?.correlation)) {
    return {
      hz: Number.NaN,
      correlation: Number.NaN,
      carryForwardRunLength: 0,
      fullPredictionCountSinceLastNaN: 0,
    };
  }
  return {
    hz: result.hz,
    correlation: result.correlation,
    carryForwardRunLength:
      result.type === "carryForward" ? (priorStep?.carryForwardRunLength ?? 0) + 1 : 0,
    fullPredictionCountSinceLastNaN:
      result.type === "carryForward"
        ? (priorStep?.fullPredictionCountSinceLastNaN ?? 0)
        : (priorStep?.fullPredictionCountSinceLastNaN ?? 0) + 1,
  };
}

function getPicaPitchResultFromSamples(samples, sampleRate, minHz, maxHz, priorStep) {
  const { zeroCrossingCount, maxAmplitude } = getWindowStats(samples);
  if (maxAmplitude < PICA_MIN_AMP || zeroCrossingCount === 0) {
    return {
      cents: Number.NaN,
      priorStep: null,
    };
  }

  const cache = {
    correlationByPeriodSize: new Map(),
    maxAmplitudeFromRight: null,
    walkedPeriodByPeriodSize: new Map(),
  };
  const carryForwardCandidate = getCarryForwardCandidate(
    samples,
    sampleRate,
    minHz,
    maxHz,
    priorStep,
    cache,
  );
  const winningCandidate =
    carryForwardCandidate ??
    getCandidatesFromExtrema(
      samples,
      sampleRate,
      minHz,
      maxHz,
      getFoldExtremaFromWaveform(samples),
      cache,
    );

  return {
    cents: winningCandidate ? hzToCents(winningCandidate.hz) : Number.NaN,
    priorStep: getPriorStep(winningCandidate, priorStep),
  };
}

export function getPicaPitchResult(samples, sampleRate, minHz, maxHz, priorStep = null) {
  if (samples.length < 2) {
    return {
      cents: Number.NaN,
      priorStep: null,
    };
  }
  return getPicaPitchResultFromSamples(samples, sampleRate, minHz, maxHz, priorStep);
}
