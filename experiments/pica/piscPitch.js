import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";

const USE_PICA_CANDIDATES = false;

export function getFeatures(samples, reversalSignal) {
  const features = [];
  let maxAbsAmp = 0;

  for (const amp of samples) {
    const absAmp = Math.abs(amp);
    if (absAmp > maxAbsAmp) {
      maxAbsAmp = absAmp;
    }
  }

  const scaledSamples =
    maxAbsAmp > 0 ? samples.map((amp) => amp / maxAbsAmp) : Array.from(samples, () => 0);

  // TODO: limit this to a trailing subset once we've seen whether the full-window features are useful.
  let mode =
    scaledSamples[scaledSamples.length - 2] >= scaledSamples[scaledSamples.length - 1]
      ? "peak"
      : "trough";
  let bestIndex = scaledSamples.length - 1;
  let bestAmp = scaledSamples[bestIndex];

  for (let index = scaledSamples.length - 2; index >= 0; index -= 1) {
    const scaledAmp = scaledSamples[index];
    if (mode === "peak") {
      if (scaledAmp >= bestAmp) {
        bestAmp = scaledAmp;
        bestIndex = index;
        continue;
      }
      if (scaledAmp <= bestAmp - reversalSignal) {
        features.push({
          index: bestIndex,
          amp: samples[bestIndex],
          type: "peak",
        });
        mode = "trough";
        bestAmp = scaledAmp;
        bestIndex = index;
      }
      continue;
    }

    if (scaledAmp <= bestAmp) {
      bestAmp = scaledAmp;
      bestIndex = index;
      continue;
    }
    if (scaledAmp >= bestAmp + reversalSignal) {
      features.push({
        index: bestIndex,
        amp: samples[bestIndex],
        type: "trough",
      });
      mode = "peak";
      bestAmp = scaledAmp;
      bestIndex = index;
    }
  }
  return features;
}

function getPeriodCandidates(samples, minPeriodSize, maxPeriodSize) {
  const candidatePadding = 0;
  const periodCandidates = new Set();
  let sawFirstCrossing = false;
  let anchorCrossingIndex = -1;
  let crossingsSinceAnchor = 0;
  let lastAmp = samples[samples.length - 1];

  for (let sampleIndex = samples.length - 2; sampleIndex >= 0; sampleIndex -= 1) {
    const amp = samples[sampleIndex];
    if (amp < 0 !== lastAmp < 0) {
      if (!sawFirstCrossing) {
        sawFirstCrossing = true;
        anchorCrossingIndex = sampleIndex;
        lastAmp = amp;
        continue;
      }

      crossingsSinceAnchor += 1;
      if (crossingsSinceAnchor % 2 !== 0) {
        lastAmp = amp;
        continue;
      }

      const periodCenter = anchorCrossingIndex - sampleIndex;
      if (periodCenter - candidatePadding > maxPeriodSize) {
        break;
      }
      for (
        let candidatePeriod = periodCenter - candidatePadding;
        candidatePeriod <= periodCenter + candidatePadding;
        candidatePeriod += 1
      ) {
        if (candidatePeriod >= minPeriodSize && candidatePeriod <= maxPeriodSize) {
          periodCandidates.add(candidatePeriod);
        }
      }
    }
    lastAmp = amp;
  }

  return [...periodCandidates].sort((a, b) => b - a);
}

function getPeriodCandidatesPica(samples, minPeriodSize, maxPeriodSize, settings) {
  const candidatePadding = 2;
  const periodCandidates = new Set();
  const maxFoldCount = settings.maxCrossingsPerPeriod * 2;
  const maxExtremaPerType = Math.ceil(maxFoldCount / 2);
  const peaks = [];
  const troughs = [];
  let includedFoldCount = 0;
  let sawFirstCrossing = false;
  let bestIndex = -1;
  let bestValue = 0;
  let lastAmp = samples[0];
  let lastType = samples[0] < 0 ? "trough" : "peak";

  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const amp = samples[sampleIndex];
    const type = amp < 0 ? "trough" : "peak";

    if (lastAmp < 0 !== amp < 0) {
      if (!sawFirstCrossing) {
        sawFirstCrossing = true;
        lastAmp = amp;
        lastType = type;
        bestIndex = sampleIndex;
        bestValue = amp;
        continue;
      }

      const extremum = {
        index: bestIndex,
        foldIndex: includedFoldCount,
      };
      if (lastType === "peak") {
        peaks.push(extremum);
      } else {
        troughs.push(extremum);
      }
      includedFoldCount += 1;
      lastType = type;
      bestIndex = sampleIndex;
      bestValue = amp;
    } else if (sawFirstCrossing && (lastType === "peak" ? amp >= bestValue : amp <= bestValue)) {
      bestIndex = sampleIndex;
      bestValue = amp;
    }
    lastAmp = amp;
  }

  if (sawFirstCrossing && bestIndex !== samples.length - 1) {
    const extremum = {
      index: bestIndex,
      foldIndex: includedFoldCount,
    };
    if (lastType === "peak") {
      peaks.push(extremum);
    } else {
      troughs.push(extremum);
    }
  }

  for (const typedExtrema of [peaks.slice(-maxExtremaPerType), troughs.slice(-maxExtremaPerType)]) {
    const anchor = typedExtrema[typedExtrema.length - 1];
    if (!anchor) continue;

    for (let extremumIndex = 0; extremumIndex < typedExtrema.length; extremumIndex += 1) {
      const earlierExtremum = typedExtrema[extremumIndex];
      if (earlierExtremum.index === anchor.index) continue;
      if (earlierExtremum.foldIndex === anchor.foldIndex) continue;

      const periodCenter = anchor.index - earlierExtremum.index;
      if (periodCenter < 1) continue;
      if (periodCenter - candidatePadding > maxPeriodSize) continue;

      for (
        let candidatePeriod = periodCenter - candidatePadding;
        candidatePeriod <= periodCenter + candidatePadding;
        candidatePeriod += 1
      ) {
        if (candidatePeriod >= minPeriodSize && candidatePeriod <= maxPeriodSize) {
          periodCandidates.add(candidatePeriod);
        }
      }
    }
  }

  return [...periodCandidates].sort((a, b) => b - a);
}

function getActivePeriodCandidates(samples, minPeriodSize, maxPeriodSize, settings) {
  return USE_PICA_CANDIDATES
    ? getPeriodCandidatesPica(samples, minPeriodSize, maxPeriodSize, settings)
    : getPeriodCandidates(samples, minPeriodSize, maxPeriodSize);
}

function getCorrelationAtPeriod(samples, periodSize, features, settings) {
  let diffSum = 0;
  let ampSum = 0;
  const comparedSampleCount = Math.min(samples.length, settings.maxComparisonPatches * periodSize);
  const comparedStart = Math.max(periodSize, samples.length - comparedSampleCount);

  for (const feature of features) {
    if (feature.index < comparedStart) {
      break;
    }
    const right = feature.amp * 1000;
    const left = samples[feature.index - periodSize] * 1000;
    diffSum += Math.abs(right - left);
    ampSum += Math.abs(left) + Math.abs(right);
  }

  return ampSum > 0 ? 1 - diffSum / ampSum : 0;
}

function getWalkedPeriodSize(
  samples,
  seedPeriodSize,
  minPeriodSize,
  maxPeriodSize,
  features,
  settings,
  correlationByPeriodSize = null,
) {
  const getCorrelation = (periodSize) =>
    correlationByPeriodSize?.get(periodSize) ??
    getCorrelationAtPeriod(samples, periodSize, features, settings);
  let bestPeriodSize = seedPeriodSize;
  let bestCorrelation = getCorrelation(seedPeriodSize);

  // TODO: this could be much faster using the same kind of direction probe / larger strides / cache as PICA.
  for (let step = 0; step < settings.maxWalkSteps; step += 1) {
    const lowerPeriodSize = bestPeriodSize - 1;
    const higherPeriodSize = bestPeriodSize + 1;
    const lowerCorrelation =
      lowerPeriodSize >= minPeriodSize ? getCorrelation(lowerPeriodSize) : Number.NEGATIVE_INFINITY;
    const higherCorrelation =
      higherPeriodSize <= maxPeriodSize
        ? getCorrelation(higherPeriodSize)
        : Number.NEGATIVE_INFINITY;

    if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
      break;
    }

    if (higherCorrelation > lowerCorrelation) {
      bestPeriodSize = higherPeriodSize;
      bestCorrelation = higherCorrelation;
    } else {
      bestPeriodSize = lowerPeriodSize;
      bestCorrelation = lowerCorrelation;
    }
  }

  return {
    periodSize: bestPeriodSize,
    correlation: bestCorrelation,
  };
}

export function getPiscCorrelationSeriesFromWaveform(samples, sampleRate, settings) {
  const minPeriodSize = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSize = Math.max(minPeriodSize, Math.floor(sampleRate / PICA_MIN_HZ));
  const features = getFeatures(samples, settings.reversalSignal);
  const checkedPeriodSizes = getActivePeriodCandidates(
    samples,
    minPeriodSize,
    maxPeriodSize,
    settings,
  );
  const checkedPeriodSizeSet = new Set(checkedPeriodSizes);
  const hz = [];
  const correlation = [];
  const checkedHz = [];
  const checkedCorrelation = [];
  const periodSizes = [];
  const slopes = [];
  const walkedPeakDistances = [];
  const walkedPeakPeriodSizes = [];
  const correlationByPeriodSize = new Map();

  for (let periodSize = maxPeriodSize; periodSize >= minPeriodSize; periodSize -= 1) {
    const score = getCorrelationAtPeriod(samples, periodSize, features, settings);
    const periodHz = sampleRate / periodSize;
    correlationByPeriodSize.set(periodSize, score);
    periodSizes.push(periodSize);
    hz.push(periodHz);
    correlation.push(score);
    if (checkedPeriodSizeSet.has(periodSize)) {
      checkedHz.push(periodHz);
      checkedCorrelation.push(score);
    }
  }

  for (let periodSize = maxPeriodSize; periodSize >= minPeriodSize; periodSize -= 1) {
    const lowerCorrelation =
      correlationByPeriodSize.get(Math.max(minPeriodSize, periodSize - 1)) ?? Number.NaN;
    const higherCorrelation =
      correlationByPeriodSize.get(Math.min(maxPeriodSize, periodSize + 1)) ?? Number.NaN;
    slopes.push(
      Math.abs(
        periodSize === minPeriodSize || periodSize === maxPeriodSize
          ? higherCorrelation - lowerCorrelation
          : (higherCorrelation - lowerCorrelation) / 2,
      ),
    );

    const walkedPeriod = getWalkedPeriodSize(
      samples,
      periodSize,
      minPeriodSize,
      maxPeriodSize,
      features,
      settings,
      correlationByPeriodSize,
    );
    walkedPeakPeriodSizes.push(walkedPeriod.periodSize);
    walkedPeakDistances.push(Math.abs(walkedPeriod.periodSize - periodSize));
  }

  return {
    minHz: PICA_MIN_HZ,
    maxHz: PICA_MAX_HZ,
    minPeriodSize,
    maxPeriodSize,
    periodSizes,
    hz,
    correlation,
    checkedHz,
    checkedCorrelation,
    checkedPeriodSizes,
    slopes,
    walkedPeakDistances,
    walkedPeakPeriodSizes,
  };
}

export function getPiscPitchHzFromWaveform(samples, sampleRate, settings) {
  const debug = window.piscDebug;
  const minPeriodSize = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSize = Math.max(minPeriodSize, Math.floor(sampleRate / PICA_MIN_HZ));
  const periodCandidates = getActivePeriodCandidates(
    samples,
    minPeriodSize,
    maxPeriodSize,
    settings,
  );
  const features = getFeatures(samples, settings.reversalSignal);

  debug.periodSizes = [];
  debug.hz = [];
  debug.correlations = [];
  debug.winningPeriodSize = Number.NaN;
  debug.winningCorrelation = Number.NaN;

  let bestPeriodSize = Number.NaN;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  let bestWeightedScore = Number.NEGATIVE_INFINITY;

  for (const seedPeriodSize of periodCandidates) {
    const walkedPeriod = getWalkedPeriodSize(
      samples,
      seedPeriodSize,
      minPeriodSize,
      maxPeriodSize,
      features,
      settings,
    );
    const periodSize = walkedPeriod.periodSize;
    const correlation = walkedPeriod.correlation;
    const hz = sampleRate / periodSize;
    const hzFeature = Math.log2(hz / PICA_MIN_HZ);
    const weightedScore = settings.corrHzRatio * correlation + hzFeature;
    debug.periodSizes.push(seedPeriodSize);
    debug.hz.push(hz);
    debug.correlations.push(correlation);

    if (weightedScore > bestWeightedScore) {
      bestWeightedScore = weightedScore;
      bestCorrelation = correlation;
      bestPeriodSize = periodSize;
    }
  }

  debug.winningPeriodSize = bestPeriodSize;
  debug.winningCorrelation = bestCorrelation;
  return Number.isFinite(bestPeriodSize) ? sampleRate / bestPeriodSize : Number.NaN;
}
