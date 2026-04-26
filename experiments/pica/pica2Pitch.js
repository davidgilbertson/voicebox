import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { getFoldExtremaFromWaveform } from "./pizaPitch.js";

function getScaledSamples(samples) {
  const scaledSamples = new Float32Array(samples.length);
  let maxAbsSample = 0;
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const absSample = Math.abs(sample);
    if (absSample > maxAbsSample) {
      maxAbsSample = absSample;
    }
    scaledSamples[sampleIndex] = sample;
  }

  if (!(maxAbsSample > 0)) {
    return scaledSamples;
  }

  for (let sampleIndex = 0; sampleIndex < scaledSamples.length; sampleIndex += 1) {
    scaledSamples[sampleIndex] /= maxAbsSample;
  }

  return scaledSamples;
}

function getPitchFromLanes(
  lanes,
  globalModeSpacing,
  fallbackModeSpacing,
  fallbackMeanSpacing,
  sampleRate,
) {
  const periodSize = Number.isFinite(globalModeSpacing)
    ? globalModeSpacing
    : Number.isFinite(fallbackModeSpacing)
      ? fallbackModeSpacing
      : Number.isFinite(fallbackMeanSpacing)
        ? fallbackMeanSpacing
        : Number.NaN;

  let selectedLane = null;
  let selectedLaneMatchingSpacingCount = -1;

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (lane.features.length < 2) continue;

    let matchingSpacingCount = 0;
    for (let spacingIndex = 0; spacingIndex < lane.spacings.length; spacingIndex += 1) {
      if (lane.spacings[spacingIndex] === periodSize) {
        matchingSpacingCount += 1;
      }
    }

    if (matchingSpacingCount > selectedLaneMatchingSpacingCount) {
      selectedLane = lane;
      selectedLaneMatchingSpacingCount = matchingSpacingCount;
      continue;
    }
    if (matchingSpacingCount < selectedLaneMatchingSpacingCount) continue;
    if (selectedLane === null || lane.spacingVariance < selectedLane.spacingVariance) {
      selectedLane = lane;
      continue;
    }
    if (lane.spacingVariance > selectedLane.spacingVariance) continue;
    if (lane.features.length > selectedLane.features.length) {
      selectedLane = lane;
      continue;
    }
    if (lane.features.length < selectedLane.features.length) continue;
    if (lane.meanSpacing < selectedLane.meanSpacing) {
      selectedLane = lane;
    }
  }

  let selectedRange = null;
  if (selectedLane?.features.length >= 2) {
    for (
      let featureIndex = selectedLane.features.length - 1;
      featureIndex >= 1;
      featureIndex -= 1
    ) {
      const spacing =
        selectedLane.features[featureIndex].rightIndex -
        selectedLane.features[featureIndex - 1].rightIndex;
      if (spacing === periodSize) {
        selectedRange = {
          startIndex: selectedLane.features[featureIndex - 1].rightIndex,
          endIndex: selectedLane.features[featureIndex].rightIndex,
        };
        break;
      }
    }

    if (selectedRange === null) {
      selectedRange = {
        startIndex: selectedLane.features[selectedLane.features.length - 2].rightIndex,
        endIndex: selectedLane.features[selectedLane.features.length - 1].rightIndex,
      };
    }
  }

  return {
    bestLaneIndex: selectedLane?.laneIndex ?? -1,
    selectedRange,
    periodSize,
    hz: Number.isFinite(periodSize) && periodSize > 0 ? sampleRate / periodSize : Number.NaN,
  };
}

function getPitchFromLanesV2(lanes, sampleRate, settings) {
  const binWidth = settings.binWidth ?? 10;
  const magWeight = settings.magWeight ?? 1;
  const minPeriodSize = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSize = Math.max(minPeriodSize, Math.floor(sampleRate / PICA_MIN_HZ));
  const binCount = Math.floor((maxPeriodSize - minPeriodSize) / binWidth) + 1;
  const bins = new Array(binCount).fill(0);

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    for (let spacingIndex = 0; spacingIndex < lane.spacings.length; spacingIndex += 1) {
      const spacing = Math.round(lane.spacings[spacingIndex]);
      if (spacing < minPeriodSize || spacing > maxPeriodSize) continue;
      const binIndex = Math.round((spacing - minPeriodSize) / binWidth);
      bins[binIndex] += 1 + lane.features[spacingIndex + 1].magnitude * magWeight;
    }
  }

  let bestBinIndex = -1;
  let bestBinValue = 0;
  for (let binIndex = 0; binIndex < bins.length; binIndex += 1) {
    if (bins[binIndex] > bestBinValue) {
      bestBinValue = bins[binIndex];
      bestBinIndex = binIndex;
    }
  }

  globalThis.pica2Debug.bins = bins;
  globalThis.pica2Debug.hzBins = Object.fromEntries(
    bins
      .map((value, binIndex) => [minPeriodSize + binIndex * binWidth, value])
      .filter(([, value]) => value !== 0)
      .map(([periodSize, value]) => [(sampleRate / periodSize).toFixed(2), value]),
  );

  const periodSize = bestBinIndex >= 0 ? minPeriodSize + bestBinIndex * binWidth : Number.NaN;
  let selectedLane = null;
  let selectedLaneMatchingSpacingCount = -1;

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (lane.features.length < 2) continue;

    let matchingSpacingCount = 0;
    for (let spacingIndex = 0; spacingIndex < lane.spacings.length; spacingIndex += 1) {
      if (Math.abs(lane.spacings[spacingIndex] - periodSize) <= binWidth / 2) {
        matchingSpacingCount += 1;
      }
    }

    if (matchingSpacingCount > selectedLaneMatchingSpacingCount) {
      selectedLane = lane;
      selectedLaneMatchingSpacingCount = matchingSpacingCount;
      continue;
    }
    if (matchingSpacingCount < selectedLaneMatchingSpacingCount) continue;
    if (selectedLane === null || lane.spacingVariance < selectedLane.spacingVariance) {
      selectedLane = lane;
      continue;
    }
    if (lane.spacingVariance > selectedLane.spacingVariance) continue;
    if (lane.features.length > selectedLane.features.length) {
      selectedLane = lane;
      continue;
    }
    if (lane.features.length < selectedLane.features.length) continue;
    if (lane.meanSpacing < selectedLane.meanSpacing) {
      selectedLane = lane;
    }
  }

  let selectedRange = null;
  if (selectedLane?.features.length >= 2) {
    for (
      let featureIndex = selectedLane.features.length - 1;
      featureIndex >= 1;
      featureIndex -= 1
    ) {
      const spacing =
        selectedLane.features[featureIndex].rightIndex -
        selectedLane.features[featureIndex - 1].rightIndex;
      if (Math.abs(spacing - periodSize) <= binWidth / 2) {
        selectedRange = {
          startIndex: selectedLane.features[featureIndex - 1].rightIndex,
          endIndex: selectedLane.features[featureIndex].rightIndex,
        };
        break;
      }
    }

    if (selectedRange === null) {
      selectedRange = {
        startIndex: selectedLane.features[selectedLane.features.length - 2].rightIndex,
        endIndex: selectedLane.features[selectedLane.features.length - 1].rightIndex,
      };
    }
  }

  return {
    bestLaneIndex: selectedLane?.laneIndex ?? -1,
    selectedRange,
    periodSize,
    hz: Number.isFinite(periodSize) && periodSize > 0 ? sampleRate / periodSize : Number.NaN,
  };
}

function getPitchFromLanesV3(lanes, folds, sampleRate) {
  let bestLane = null;
  let bestLaneScore = Number.NEGATIVE_INFINITY;
  let bestLaneNewestSpan = Number.NaN;
  let fallbackLane = null;

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (lane.features.length < 1) continue;
    if (
      fallbackLane === null ||
      lane.features[lane.features.length - 1].rightIndex >
        fallbackLane.features[fallbackLane.features.length - 1].rightIndex
    ) {
      fallbackLane = lane;
    }
    if (lane.features.length < 2) continue;
    const foldSpans = new Array(lane.features.length - 1);
    for (let featureIndex = 1; featureIndex < lane.features.length; featureIndex += 1) {
      foldSpans[featureIndex - 1] =
        lane.features[featureIndex].rightFoldIndex - lane.features[featureIndex - 1].rightFoldIndex;
    }

    let runCount = 1;
    let directionChanges = 0;
    let lastDirection = 0;
    let previousSpan = foldSpans[0];

    for (let spanIndex = 1; spanIndex < foldSpans.length; spanIndex += 1) {
      const foldSpan = foldSpans[spanIndex];
      if (foldSpan === previousSpan) continue;
      runCount += 1;
      const direction = Math.sign(foldSpan - previousSpan);
      if (direction !== 0 && lastDirection !== 0 && direction !== lastDirection) {
        directionChanges += 1;
      }
      if (direction !== 0) {
        lastDirection = direction;
      }
      previousSpan = foldSpan;
    }

    const laneScore =
      foldSpans.length * 3 -
      (runCount - 1) * 2 -
      directionChanges * 6 -
      Math.abs(foldSpans[foldSpans.length - 1] - foldSpans[0]) * 0.25;

    if (laneScore > bestLaneScore) {
      bestLane = lane;
      bestLaneScore = laneScore;
      bestLaneNewestSpan = foldSpans[foldSpans.length - 1];
      continue;
    }
    if (laneScore < bestLaneScore) continue;
    if (lane.features.length > bestLane.features.length) {
      bestLane = lane;
      bestLaneNewestSpan = foldSpans[foldSpans.length - 1];
      continue;
    }
    if (lane.features.length < bestLane.features.length) continue;
    if (
      lane.features[lane.features.length - 1].rightIndex >
      bestLane.features[bestLane.features.length - 1].rightIndex
    ) {
      bestLane = lane;
      bestLaneNewestSpan = foldSpans[foldSpans.length - 1];
    }
  }

  let rootLane = null;
  if (Number.isFinite(bestLaneNewestSpan) && bestLaneNewestSpan > 0) {
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex];
      if (lane.features.length < 2) continue;
      const newestFeature = lane.features[lane.features.length - 1];
      if (newestFeature.rightFoldIndex < folds.length - bestLaneNewestSpan) continue;
      if (
        rootLane === null ||
        newestFeature.rightIndex > rootLane.features[rootLane.features.length - 1].rightIndex
      ) {
        rootLane = lane;
      }
    }
  }

  if (rootLane === null || rootLane.features.length < 2) {
    if (fallbackLane !== null && folds.length >= 2) {
      let periodSize = 0;
      for (let foldIndex = folds.length - 2; foldIndex < folds.length; foldIndex += 1) {
        periodSize += folds[foldIndex].width;
      }

      return {
        bestLaneIndex: fallbackLane.laneIndex,
        selectedRange: {
          startIndex: folds[folds.length - 2].startIndex,
          endIndex: folds[folds.length - 1].endIndex,
        },
        periodSize,
        hz: periodSize > 0 ? sampleRate / periodSize : Number.NaN,
      };
    }

    return {
      bestLaneIndex: -1,
      selectedRange: null,
      periodSize: Number.NaN,
      hz: Number.NaN,
    };
  }

  const newestFeatureIndex = rootLane.features.length - 1;
  const winningFoldSpan =
    rootLane.features[newestFeatureIndex].rightFoldIndex -
    rootLane.features[newestFeatureIndex - 1].rightFoldIndex;
  let periodSize =
    rootLane.features[newestFeatureIndex].rightIndex -
    rootLane.features[newestFeatureIndex - 1].rightIndex;
  if (
    Number.isFinite(winningFoldSpan) &&
    winningFoldSpan > 0 &&
    rootLane.features[newestFeatureIndex].rightFoldIndex <= folds.length
  ) {
    periodSize = 0;
    for (let foldIndex = folds.length - winningFoldSpan; foldIndex < folds.length; foldIndex += 1) {
      periodSize += folds[foldIndex].width;
    }
  }

  return {
    bestLaneIndex: rootLane.laneIndex,
    selectedRange: {
      startIndex: rootLane.features[newestFeatureIndex - 1].rightIndex,
      endIndex: rootLane.features[newestFeatureIndex].rightIndex,
    },
    periodSize,
    hz: Number.isFinite(periodSize) && periodSize > 0 ? sampleRate / periodSize : Number.NaN,
  };
}

export function getPica2PitchAnalysisFromWaveform(samples, sampleRate, settings) {
  const scaledSamples = getScaledSamples(samples);
  const foldExtrema = getFoldExtremaFromWaveform(scaledSamples, settings);
  const minAmp = settings.minAmp ?? 0;
  const cone = settings.cone ?? 0.005;
  const features = [];
  const lanes = [];
  let lastFeatureIndex = scaledSamples.length - 1;

  let pairStartIndex = foldExtrema.folds.length - 2;
  if (pairStartIndex % 2 !== 0) {
    pairStartIndex -= 1;
  }

  for (let foldIndex = pairStartIndex; foldIndex >= 0; foldIndex -= 2) {
    const leftFold = foldExtrema.folds[foldIndex];
    const rightFold = foldExtrema.folds[foldIndex + 1];
    const stepDelta = Math.max(0, lastFeatureIndex - rightFold.extremaIndex);
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      lanes[laneIndex].stepsSinceMatch += stepDelta;
    }
    lastFeatureIndex = rightFold.extremaIndex;

    const leftValue = leftFold.extremaAmplitude;
    const rightValue = rightFold.extremaAmplitude;
    const magnitude = Math.max(Math.abs(leftValue), Math.abs(rightValue));
    if (magnitude < minAmp) continue;

    const feature = {
      featureIndex: features.length,
      leftFoldIndex: foldIndex,
      rightFoldIndex: foldIndex + 1,
      leftIndex: leftFold.extremaIndex,
      leftValue,
      rightIndex: rightFold.extremaIndex,
      rightValue,
      magnitude,
      laneIndex: -1,
      matchedExistingLane: false,
    };
    features.push(feature);

    let matchingLane = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestFeatureCount = -1;

    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex];
      const coneWidth = cone * lane.stepsSinceMatch;
      const leftDistance = Math.abs(leftValue - lane.leftAnchorValue);
      const rightDistance = Math.abs(rightValue - lane.rightAnchorValue);
      if (leftDistance > coneWidth || rightDistance > coneWidth) continue;
      const distance = leftDistance + rightDistance;
      if (distance < bestDistance) {
        matchingLane = lane;
        bestDistance = distance;
        bestFeatureCount = lane.features.length;
        continue;
      }
      if (distance === bestDistance && lane.features.length > bestFeatureCount) {
        matchingLane = lane;
        bestFeatureCount = lane.features.length;
      }
    }

    if (matchingLane) {
      feature.laneIndex = matchingLane.laneIndex;
      feature.matchedExistingLane = true;
      matchingLane.features.push(feature);
      matchingLane.leftAnchorValue = feature.leftValue;
      matchingLane.rightAnchorValue = feature.rightValue;
      matchingLane.stepsSinceMatch = 0;
      continue;
    }

    const laneIndex = lanes.length;
    feature.laneIndex = laneIndex;
    lanes.push({
      laneIndex,
      leftAnchorValue: feature.leftValue,
      rightAnchorValue: feature.rightValue,
      stepsSinceMatch: 0,
      features: [feature],
    });
  }

  const resolvedLanes = new Array(lanes.length);

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    const sortedFeatures = new Array(lane.features.length);
    for (let featureIndex = 0; featureIndex < lane.features.length; featureIndex += 1) {
      sortedFeatures[featureIndex] = lane.features[lane.features.length - 1 - featureIndex];
    }

    let spacings = [];
    let meanSpacing = Number.NaN;
    let spacingVariance = Number.POSITIVE_INFINITY;

    if (sortedFeatures.length >= 2) {
      spacings = new Array(sortedFeatures.length - 1);
      let spacingSum = 0;

      for (let spacingIndex = 0; spacingIndex < sortedFeatures.length - 1; spacingIndex += 1) {
        const spacing =
          sortedFeatures[spacingIndex + 1].rightIndex - sortedFeatures[spacingIndex].rightIndex;
        spacings[spacingIndex] = spacing;
        spacingSum += spacing;
      }

      meanSpacing = spacingSum / spacings.length;

      let varianceSum = 0;
      for (let spacingIndex = 0; spacingIndex < spacings.length; spacingIndex += 1) {
        varianceSum += (spacings[spacingIndex] - meanSpacing) ** 2;
      }
      spacingVariance = varianceSum / spacings.length;
    }

    resolvedLanes[laneIndex] = {
      laneIndex: lane.laneIndex,
      leftAnchorValue: lane.leftAnchorValue,
      rightAnchorValue: lane.rightAnchorValue,
      stepsSinceMatch: lane.stepsSinceMatch,
      leftSearchMin: lane.leftAnchorValue - cone * lane.stepsSinceMatch,
      leftSearchMax: lane.leftAnchorValue + cone * lane.stepsSinceMatch,
      rightSearchMin: lane.rightAnchorValue - cone * lane.stepsSinceMatch,
      rightSearchMax: lane.rightAnchorValue + cone * lane.stepsSinceMatch,
      features: sortedFeatures,
      spacings,
      meanSpacing,
      spacingVariance,
    };
  }

  resolvedLanes.sort((left, right) => {
    if (right.features.length !== left.features.length) {
      return right.features.length - left.features.length;
    }
    return left.spacingVariance - right.spacingVariance;
  });
  const pitch = getPitchFromLanesV3(resolvedLanes, foldExtrema.folds, sampleRate);

  const orderedFeatures = new Array(features.length);
  for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
    orderedFeatures[featureIndex] = features[features.length - 1 - featureIndex];
  }

  return {
    features: orderedFeatures,
    lanes: resolvedLanes,
    ...pitch,
  };
}
