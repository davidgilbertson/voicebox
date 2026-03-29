import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";

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
    maxAmplitude, // TODO (@davidgilbertson): might be unused
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
  const directionProbeStride = 2;
  const walkStride = 4;
  let bestPeriodSize = seedPeriodSize;
  let bestCorrelation = getCorrelation(samples, seedPeriodSize, settings, cache);
  let currentPeriodSize = bestPeriodSize;
  let currentCorrelation = bestCorrelation;
  let phase = "getDirection";
  let direction = 0;

  let step = 0;
  while (step < settings.maxWalkSteps) {
    if (phase === "getDirection") {
      // First find the local uphill direction, then snap onto the nearest stride lane.
      const lowerPeriodSize = bestPeriodSize - directionProbeStride;
      const higherPeriodSize = bestPeriodSize + directionProbeStride;
      const lowerCorrelation = getCorrelation(samples, lowerPeriodSize, settings, cache);
      const higherCorrelation = getCorrelation(samples, higherPeriodSize, settings, cache);

      if (higherCorrelation <= bestCorrelation && lowerCorrelation <= bestCorrelation) {
        break;
      }

      direction = higherCorrelation > lowerCorrelation ? 1 : -1;
      currentPeriodSize =
        direction > 0
          ? bestPeriodSize % walkStride === 0
            ? bestPeriodSize + walkStride
            : Math.ceil(bestPeriodSize / walkStride) * walkStride
          : bestPeriodSize % walkStride === 0
            ? bestPeriodSize - walkStride
            : Math.floor(bestPeriodSize / walkStride) * walkStride;
      currentCorrelation = getCorrelation(samples, currentPeriodSize, settings, cache);

      if (currentCorrelation > bestCorrelation) {
        bestPeriodSize = currentPeriodSize;
        bestCorrelation = currentCorrelation;
      }

      phase = "walk";
      step += 1;
      continue;
    }

    if (phase === "walk") {
      // Once we're on the lane, keep walking in stride steps while correlation improves.
      const nextPeriodSize = currentPeriodSize + direction * walkStride;
      const nextCorrelation = getCorrelation(samples, nextPeriodSize, settings, cache);
      if (nextCorrelation > currentCorrelation) {
        currentPeriodSize = nextPeriodSize;
        currentCorrelation = nextCorrelation;
        bestPeriodSize = nextPeriodSize;
        bestCorrelation = nextCorrelation;
        step += 1;
        continue;
      }

      currentPeriodSize = nextPeriodSize;
      currentCorrelation = nextCorrelation;
      phase = "walkBack";
      step += 1;
      continue;
    }

    // When the stride walk overshoots, walk back one-by-one to find the exact peak.
    const nextPeriodSize = currentPeriodSize - direction;
    const nextCorrelation = getCorrelation(samples, nextPeriodSize, settings, cache);
    if (nextCorrelation > currentCorrelation) {
      currentPeriodSize = nextPeriodSize;
      currentCorrelation = nextCorrelation;
      if (nextCorrelation > bestCorrelation) {
        bestPeriodSize = nextPeriodSize;
        bestCorrelation = nextCorrelation;
      }
      step += 1;
      continue;
    }

    break;
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
  // In this function we have a special treatment for the last (right-most) fold.
  // This fold is usually incomplete, and may or may not contain a 'feature' that matches the same
  //  feature on an earlier fold. So we check that final fold and don't add it if the extreme is right at the end.
  // Note: we tried keeping multiple extrema per fold, but one worked just as well and was ~30% faster.
  const maxFoldCount = settings.maxCrossingsPerPeriod * 2;
  const maxExtremaPerType = Math.ceil(maxFoldCount / 2);
  const allPeaks = [];
  const allFolds = [];
  const allTroughs = [];
  let coveredStartIndex = samples.length;
  let includedFoldCount = 0;
  let zeroCrossingCount = 0;
  let sawFirstCrossing = false;
  let foldStartIndex = -1;
  let bestIndex = -1;
  let bestValue = 0;
  let lastSample = samples[0];
  let lastType = samples[0] < 0 ? "trough" : "peak";

  // Note, we do wasted work by looping right from the start then only taking the latter folds later
  // But empirically it barely makes a difference.
  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const type = sample < 0 ? "trough" : "peak";

    // If we just cross a fold
    if (lastSample < 0 !== sample < 0) {
      if (!sawFirstCrossing) {
        sawFirstCrossing = true;
        coveredStartIndex = sampleIndex;
        foldStartIndex = sampleIndex;
        lastSample = sample;
        lastType = type;
        bestIndex = sampleIndex;
        bestValue = sample;
        continue;
      }

      const extremum = {
        index: bestIndex,
        value: bestValue,
        type: lastType,
        foldIndex: includedFoldCount,
      };
      allFolds.push({
        width: sampleIndex - foldStartIndex,
        extremaAmplitude: bestValue,
        extremaPosition: bestIndex - foldStartIndex,
        extremaIndex: bestIndex,
        type: lastType,
        foldIndex: includedFoldCount,
      });
      if (lastType === "peak") {
        allPeaks.push(extremum);
      } else {
        allTroughs.push(extremum);
      }
      includedFoldCount += 1;
      zeroCrossingCount += 1;
      foldStartIndex = sampleIndex;
      lastType = type;
      bestIndex = sampleIndex;
      bestValue = sample;
    } else if (
      sawFirstCrossing &&
      (lastType === "peak" ? sample >= bestValue : sample <= bestValue)
    ) {
      // else we're continuing in a fold, and have a more extreme value
      bestIndex = sampleIndex;
      bestValue = sample;
    }
    lastSample = sample;
  }

  const isLastFoldUseful = sawFirstCrossing && bestIndex !== samples.length - 1;

  if (isLastFoldUseful) {
    const extremum = {
      index: bestIndex,
      value: bestValue,
      type: lastType,
      foldIndex: includedFoldCount,
    };
    allFolds.push({
      width: samples.length - foldStartIndex,
      extremaAmplitude: bestValue,
      extremaPosition: bestIndex - foldStartIndex,
      extremaIndex: bestIndex,
      type: lastType,
      foldIndex: includedFoldCount,
    });
    if (lastType === "peak") {
      allPeaks.push(extremum);
    } else {
      allTroughs.push(extremum);
    }
  }

  const coveredSampleCount = sawFirstCrossing ? samples.length - coveredStartIndex : 0;
  const zeroCrossingDensity = coveredSampleCount > 0 ? zeroCrossingCount / coveredSampleCount : 0;
  if (window.picaDebug.recordFoldDebug) {
    const debugFullFolds = (isLastFoldUseful ? allFolds.slice(0, -1) : allFolds).slice(
      -maxFoldCount,
    );
    window.picaDebug.foldAnalyses[window.picaDebug.activeWindowIndex] = {
      fullFolds: debugFullFolds,
    };
  }

  return {
    peaks: allPeaks.slice(-maxExtremaPerType),
    troughs: allTroughs.slice(-maxExtremaPerType),
    coveredSampleCount,
    zeroCrossingDensity,
  };
}

function getCandidatesFromExtrema(samples, sampleRate, foldExtrema, settings, cache = null) {
  const candidates = [];

  for (const [type, typedExtrema] of [
    ["peak", foldExtrema.peaks],
    ["trough", foldExtrema.troughs],
  ]) {
    const anchor = typedExtrema[typedExtrema.length - 1];
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
      // const hzFeature = (walkedPeriod.hz - PICA_MIN_HZ) / PICA_MAX_HZ;
      // const correlationFeature = Math.exp(walkedPeriod.correlation);
      // const correlationFeature = walkedPeriod.correlation ** 2;
      // const correlationFeature = (walkedPeriod.correlation - 0.5) / 0.5;

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
  // TODO (@davidgilbertson): I don't know why we loop a second time here
  for (const candidate of candidates) {
    candidate.weightedScore =
      settings.corrHzRatio * candidate.correlationFeature + candidate.hzFeature;
    if (!winningCandidate || candidate.weightedScore > winningCandidate.weightedScore) {
      winningCandidate = candidate;
    }
  }
  return {
    candidates,
    winningCandidate,
  };
}

function setRejectionReason(analysis) {
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
    foldExtrema: {
      peaks: [],
      troughs: [],
      coveredSampleCount: 0,
      zeroCrossingDensity: 0,
    },
    candidates: [],
    winningCandidate: null,
  };

  if (zeroCrossingCount === 0) {
    return {
      ...analysis,
      ...setRejectionReason(analysis),
    };
  }

  const priorSuppressedOctaveJumpCount = priorStep?.suppressedOctaveJumpCount ?? 0;
  // If two-steps prior was an octave jump, we use carry forward (again)
  const carryForwardCandidate =
    priorSuppressedOctaveJumpCount > 0
      ? null
      : getCarryForwardCandidate(samples, sampleRate, settings, priorStep, cache);

  // If there's no carry forward result, we do a full search
  const extrema = carryForwardCandidate
    ? { peaks: [], troughs: [], coveredSampleCount: 0, zeroCrossingDensity: 0 }
    : getFoldExtremaFromWaveform(samples, settings);
  const { candidates, winningCandidate } = carryForwardCandidate
    ? {
        candidates: [],
        winningCandidate: carryForwardCandidate,
      }
    : getCandidatesFromExtrema(samples, sampleRate, extrema, settings, cache);
  let suppressedOctaveJumpCount = 0;
  let resolvedWinningCandidate = winningCandidate;

  // If the pitch jumps a lot from the previous step with a full search,
  //  we force a carryForward pass instead.
  if (
    !carryForwardCandidate &&
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
  const picaPitchResult = setRejectionReason(completedAnalysis);

  return {
    ...completedAnalysis,
    ...picaPitchResult,
  };
}
