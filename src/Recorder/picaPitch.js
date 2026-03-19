import { hzToCents } from "../pitchScale.js";

const PICA_MIN_AMP = 0.01;
const PICA_WINDOW_CYCLES = 2;
const PICA_MAX_EXTREMA_PER_FOLD = 6;
const PICA_MAX_CROSSINGS_PER_PERIOD = 20;
const PICA_MAX_COMPARISON_PATCHES = 8;
const PICA_CORR_SAMPLE_POINTS = 30;
const PICA_MAX_WALK_STEPS = 10;
const PICA_CARRY_FORWARD_CORRELATION_THRESHOLD = 0.7;
const PICA_CORRELATION_TO_HZ_WEIGHT_RATIO = 27;

function hasZeroCrossing(a, b) {
  return a === 0 || b === 0 || (a < 0 && b > 0) || (a > 0 && b < 0);
}

export function getPicaWindowSampleCount(sampleRate, minHz) {
  return Math.max(1, Math.ceil((PICA_WINDOW_CYCLES * sampleRate) / minHz));
}

export function fillPicaWindowSamples(ring, samples) {
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = ring.at(index - samples.length);
  }
}

function getWindowStats(samples) {
  let zeroCrossingCount = 0;
  let maxAmplitude = 0;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const absolute = Math.abs(samples[sampleIndex]);
    if (absolute > maxAmplitude) {
      maxAmplitude = absolute;
    }
    if (sampleIndex > 0 && hasZeroCrossing(samples[sampleIndex - 1], samples[sampleIndex])) {
      zeroCrossingCount += 1;
    }
  }

  return {
    zeroCrossingCount,
    maxAmplitude
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
  const patchCount = Math.min(PICA_MAX_COMPARISON_PATCHES, Math.floor(samples.length / periodSize));
  if (patchCount < 2) return -1;

  const stride = Math.max(1, Math.floor(periodSize / PICA_CORR_SAMPLE_POINTS));
  let totalCorrelation = 0;
  let comparisonCount = 0;

  for (let patchIndex = 0; patchIndex < patchCount - 1; patchIndex += 1) {
    const rightEnd = samples.length - patchIndex * periodSize;
    const rightStart = rightEnd - periodSize;
    const leftStart = rightStart - periodSize;
    if (leftStart < 0) break;

    let dot = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let sampleIndex = 0; sampleIndex < periodSize; sampleIndex += stride) {
      const left = samples[leftStart + sampleIndex];
      const right = samples[rightStart + sampleIndex];
      dot += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }

    if (leftPower <= 0 || rightPower <= 0) {
      continue;
    }

    totalCorrelation += dot / Math.sqrt(leftPower * rightPower);
    comparisonCount += 1;
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

function getWalkedPeriod(samples, seedPeriodSize, sampleRate, minHz, maxHz, cache) {
  const cachedWalkedPeriod = cache.walkedPeriodByPeriodSize.get(seedPeriodSize);
  if (cachedWalkedPeriod !== undefined) {
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
    let lowerCorrelation = lowerPeriodSize > 0 ? getCorrelation(samples, lowerPeriodSize, cache) : -1;
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
      : {
        periodSize: bestPeriodSize,
        hz: refinedHz,
        correlation: bestCorrelation,
        comparedRegionMaxAmplitude: getComparedRegionMaxAmplitude(samples, bestPeriodSize, cache)
      };

  for (const periodSize of visitedPeriodSizes) {
    cache.walkedPeriodByPeriodSize.set(periodSize, walkedPeriod);
  }

  return walkedPeriod;
}

function pushStrongestExtremum(extrema, extremum) {
  let insertIndex = extrema.length;
  while (insertIndex > 0 && Math.abs(extremum.value) > Math.abs(extrema[insertIndex - 1].value)) {
    insertIndex -= 1;
  }
  if (insertIndex >= PICA_MAX_EXTREMA_PER_FOLD) {
    return;
  }

  extrema.splice(insertIndex, 0, extremum);
  if (extrema.length > PICA_MAX_EXTREMA_PER_FOLD) {
    extrema.length = PICA_MAX_EXTREMA_PER_FOLD;
  }
}

function getFoldExtremaFromWaveform(samples) {
  const foldExtrema = [];
  let foldIndex = 0;
  let foldStartSample = samples.length - 1;

  while (foldStartSample > 0 && foldIndex < PICA_MAX_CROSSINGS_PER_PERIOD * 2) {
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
        if (type === "peak" && previous < sample && sample > next) {
          pushStrongestExtremum(localExtrema, {
            index: foldStartSample,
            value: sample
          });
        }
        if (type === "trough" && previous > sample && sample < next) {
          pushStrongestExtremum(localExtrema, {
            index: foldStartSample,
            value: sample
          });
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
              value: samples[strongestIndex]
            }
          ];

      extrema
        .sort((left, right) => right.index - left.index)
        .forEach((extremum) => {
          foldExtrema.push({
            ...extremum,
            type,
            foldIndex
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

function getCandidatesFromExtrema(samples, sampleRate, minHz, maxHz, foldExtrema, cache) {
  const peakExtrema = [];
  const troughExtrema = [];

  for (const extremum of foldExtrema) {
    if (extremum.type === "peak") {
      peakExtrema.push(extremum);
    } else {
      troughExtrema.push(extremum);
    }
  }

  let winningCandidate = null;
  for (const [type, typedExtrema] of [
    ["peak", peakExtrema],
    ["trough", troughExtrema]
  ]) {
    const anchor = getAnchorFromTypedExtrema(typedExtrema, type);
    if (!anchor) continue;

    for (let extremumIndex = 0; extremumIndex < typedExtrema.length; extremumIndex += 1) {
      const earlierExtremum = typedExtrema[extremumIndex];
      if (earlierExtremum.index === anchor.index || earlierExtremum.foldIndex === anchor.foldIndex) {
        continue;
      }

      const sourcePeriodSize = anchor.index - earlierExtremum.index;
      if (sourcePeriodSize < 1) continue;
      const sourceHz = sampleRate / sourcePeriodSize;
      if (sourceHz < minHz || sourceHz > maxHz) continue;

      const walkedPeriod = getWalkedPeriod(samples, sourcePeriodSize, sampleRate, minHz, maxHz, cache);
      if (!walkedPeriod || walkedPeriod.comparedRegionMaxAmplitude < PICA_MIN_AMP) {
        continue;
      }

      const weightedScore =
        Math.log2(walkedPeriod.hz / minHz) +
        PICA_CORRELATION_TO_HZ_WEIGHT_RATIO * walkedPeriod.correlation;
      if (!winningCandidate || weightedScore > winningCandidate.weightedScore) {
        winningCandidate = {
          hz: walkedPeriod.hz,
          correlation: walkedPeriod.correlation,
          weightedScore
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
    priorStep.correlation <= PICA_CARRY_FORWARD_CORRELATION_THRESHOLD
  ) {
    return null;
  }

  const sourcePeriodSize = Math.round(sampleRate / priorStep.hz);
  const walkedPeriod = getWalkedPeriod(samples, sourcePeriodSize, sampleRate, minHz, maxHz, cache);
  if (
    !walkedPeriod ||
    walkedPeriod.correlation <= PICA_CARRY_FORWARD_CORRELATION_THRESHOLD ||
    walkedPeriod.comparedRegionMaxAmplitude < PICA_MIN_AMP
  ) {
    return null;
  }

  return {
    hz: walkedPeriod.hz,
    correlation: walkedPeriod.correlation
  };
}

function getPriorStep(result) {
  if (!Number.isFinite(result?.hz) || !Number.isFinite(result?.correlation)) {
    return null;
  }
  return {
    hz: result.hz,
    correlation: result.correlation
  };
}

function getPicaPitchResultFromSamples(samples, sampleRate, minHz, maxHz, priorStep) {
  const { zeroCrossingCount, maxAmplitude } = getWindowStats(samples);
  if (maxAmplitude < PICA_MIN_AMP || zeroCrossingCount === 0) {
    return {
      cents: Number.NaN,
      priorStep: null
    };
  }

  const cache = {
    correlationByPeriodSize: new Map(),
    maxAmplitudeFromRight: null,
    walkedPeriodByPeriodSize: new Map()
  };
  const carryForwardCandidate = getCarryForwardCandidate(
    samples,
    sampleRate,
    minHz,
    maxHz,
    priorStep,
    cache
  );
  const winningCandidate =
    carryForwardCandidate ??
    getCandidatesFromExtrema(
      samples,
      sampleRate,
      minHz,
      maxHz,
      getFoldExtremaFromWaveform(samples),
      cache
    );

  return {
    cents: winningCandidate ? hzToCents(winningCandidate.hz) : Number.NaN,
    priorStep: getPriorStep(winningCandidate)
  };
}

export function getPicaPitchResult(samples, sampleRate, minHz, maxHz, priorStep = null) {
  if (samples.length < 2) {
    return {
      cents: Number.NaN,
      priorStep: null
    };
  }
  return getPicaPitchResultFromSamples(samples, sampleRate, minHz, maxHz, priorStep);
}
