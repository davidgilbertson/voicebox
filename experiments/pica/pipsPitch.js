import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { getFoldExtremaFromWaveform as getFoldPointsFromWaveform } from "./pizaPitch.js";

const MAX_POINT_TO_POINT_AMP_DISPLACEMENT = 2;

function getScaledSamples(samples) {
  const scaledSamples = new Float32Array(samples.length);
  let maxAbsSample = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const rawAmp = samples[index];
    const absSample = Math.abs(rawAmp);
    if (absSample > maxAbsSample) {
      maxAbsSample = absSample;
    }
    scaledSamples[index] = rawAmp;
  }

  if (maxAbsSample > 0) {
    for (let index = 0; index < scaledSamples.length; index += 1) {
      scaledSamples[index] /= maxAbsSample;
    }
  }

  return scaledSamples;
}

function getPoints(rawPoints, rawSamples) {
  const points = [];
  let minRawAmp = Number.POSITIVE_INFINITY;
  let maxRawAmp = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < rawPoints.length; index += 1) {
    const rawPoint = rawPoints[index];
    const rawAmp = rawSamples[rawPoint.index];
    if (rawAmp < minRawAmp) minRawAmp = rawAmp;
    if (rawAmp > maxRawAmp) maxRawAmp = rawAmp;
    points.push({
      type: rawPoint.type,
      index: rawPoint.index,
      scaledAmp: rawPoint.value,
      rawAmp,
    });
  }

  return {
    points,
    minRawAmp,
    maxRawAmp,
  };
}

function mergeSortedPoints(leftPoints, rightPoints) {
  const mergedPoints = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftPoints.length && rightIndex < rightPoints.length) {
    if (leftPoints[leftIndex].index <= rightPoints[rightIndex].index) {
      mergedPoints.push(leftPoints[leftIndex]);
      leftIndex += 1;
      continue;
    }
    mergedPoints.push(rightPoints[rightIndex]);
    rightIndex += 1;
  }

  while (leftIndex < leftPoints.length) {
    mergedPoints.push(leftPoints[leftIndex]);
    leftIndex += 1;
  }

  while (rightIndex < rightPoints.length) {
    mergedPoints.push(rightPoints[rightIndex]);
    rightIndex += 1;
  }

  return mergedPoints;
}

function getPipsPointDataFromWaveform(samples, settings) {
  const scaledSamples = getScaledSamples(samples);
  const foldPoints = getFoldPointsFromWaveform(scaledSamples, settings);
  const peakData = getPoints(foldPoints.peaks, samples);
  const troughData = getPoints(foldPoints.troughs, samples);
  const points = mergeSortedPoints(peakData.points, troughData.points);

  return {
    points,
    minRawAmp: Math.min(peakData.minRawAmp, troughData.minRawAmp),
    maxRawAmp: Math.max(peakData.maxRawAmp, troughData.maxRawAmp),
  };
}

export function getPipsPointsFromWaveform(samples, settings) {
  return getPipsPointDataFromWaveform(samples, settings).points;
}

function getCandidateSpans(points, minPeriodSamples, maxPeriodSamples) {
  const spans = new Set();

  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
    const point = points[pointIndex];
    for (let candidateIndex = pointIndex + 1; candidateIndex < points.length; candidateIndex += 1) {
      const span = points[candidateIndex].index - point.index;
      if (span > maxPeriodSamples) break;
      if (span < minPeriodSamples) continue;
      spans.add(span);
    }
  }

  return [...spans].toSorted((left, right) => left - right);
}

export function getRunMetrics(points, span, settings) {
  const runs = [];
  const spanStretch = settings.spanStretch ?? 0.05;
  const minSpan = Math.floor(span * (1 - spanStretch));
  const maxSpan = Math.ceil(span * (1 + spanStretch));
  const pointsInRun = new Set();
  let totalSpanCount = 0;
  let totalAmpDisplacement = 0;

  for (let startIndex = 0; startIndex < points.length - 1; startIndex += 1) {
    const startPoint = points[startIndex];
    if (pointsInRun.has(startPoint.index)) continue;

    const runPoints = [startPoint];
    let minScaledAmp = startPoint.scaledAmp;
    let maxScaledAmp = startPoint.scaledAmp;
    let point = startPoint;
    let searchIndex = startIndex + 1;

    while (searchIndex < points.length) {
      let nextPoint = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let candidateIndex = searchIndex; candidateIndex < points.length; candidateIndex += 1) {
        const candidate = points[candidateIndex];
        const candidateSpan = candidate.index - point.index;
        if (candidateSpan < minSpan) continue;
        if (candidateSpan > maxSpan) break;

        const distance = Math.abs(candidateSpan - span);
        if (distance < bestDistance) {
          bestDistance = distance;
          nextPoint = candidate;
          searchIndex = candidateIndex + 1;
        }
      }

      if (nextPoint === null) break;
      runPoints.push(nextPoint);
      if (nextPoint.scaledAmp < minScaledAmp) minScaledAmp = nextPoint.scaledAmp;
      if (nextPoint.scaledAmp > maxScaledAmp) maxScaledAmp = nextPoint.scaledAmp;
      point = nextPoint;
    }

    if (runPoints.length < 2) continue;
    for (const runPoint of runPoints) {
      pointsInRun.add(runPoint.index);
    }

    let ampDisplacement = 0;
    for (let index = 1; index < runPoints.length; index += 1) {
      ampDisplacement += Math.abs(runPoints[index].scaledAmp - runPoints[index - 1].scaledAmp);
    }
    ampDisplacement /= runPoints.length;
    totalSpanCount += runPoints.length - 1;
    totalAmpDisplacement += ampDisplacement;

    runs.push({
      spanCount: runPoints.length - 1,
      ampDisplacement,
      minScaledAmp,
      maxScaledAmp,
      points: runPoints,
    });
  }

  const totalRunLength = totalSpanCount * span;
  const coveredPointCount = pointsInRun.size;

  return {
    span,
    runCount: runs.length,
    totalSpanCount,
    totalRunLength,
    totalAmpDisplacement,
    coverage: points.length === 0 ? 0 : (coveredPointCount / points.length) * 100,
    runs,
    avgAmpDisplacementPerRun: runs.length === 0 ? Number.NaN : totalAmpDisplacement / runs.length,
  };
}

function analyzeSpanMetrics(points, minPeriodSamples, maxPeriodSamples, settings) {
  const candidateSpans = getCandidateSpans(points, minPeriodSamples, maxPeriodSamples);
  return candidateSpans.map((span) => getRunMetrics(points, span, settings));
}

function getBoundsOverlap(leftBounds, rightBounds) {
  const overlap =
    Math.min(leftBounds.maxScaledAmp, rightBounds.maxScaledAmp) -
    Math.max(leftBounds.minScaledAmp, rightBounds.minScaledAmp);
  if (overlap <= 0) return 0;

  const union =
    Math.max(leftBounds.maxScaledAmp, rightBounds.maxScaledAmp) -
    Math.min(leftBounds.minScaledAmp, rightBounds.minScaledAmp);
  return union > 0 ? overlap / union : 0;
}

function addSeparationScores(spanMetricsList) {
  return spanMetricsList.map((spanMetrics) => {
    if (spanMetrics.runs.length < 2) {
      return {
        ...spanMetrics,
        meanRunOverlap: 0,
        separation: 1,
      };
    }

    let overlapSum = 0;
    let overlapCount = 0;

    for (let leftIndex = 0; leftIndex < spanMetrics.runs.length - 1; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < spanMetrics.runs.length; rightIndex += 1) {
        overlapSum += getBoundsOverlap(spanMetrics.runs[leftIndex], spanMetrics.runs[rightIndex]);
        overlapCount += 1;
      }
    }

    const meanRunOverlap = overlapCount > 0 ? overlapSum / overlapCount : 0;
    return {
      ...spanMetrics,
      meanRunOverlap,
      separation: 1 - meanRunOverlap,
    };
  });
}

export function findBestSpan(points, sampleRate, settings) {
  const peakPoints = [];
  const troughPoints = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.type === "peak") {
      peakPoints.push(point);
    } else {
      troughPoints.push(point);
    }
  }
  const minPeriodSamples = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSamples = Math.max(minPeriodSamples, Math.floor(sampleRate / PICA_MIN_HZ));
  const candidateSpans = new Set([
    ...getCandidateSpans(peakPoints, minPeriodSamples, maxPeriodSamples),
    ...getCandidateSpans(troughPoints, minPeriodSamples, maxPeriodSamples),
  ]);
  const rawPeakSpans = analyzeSpanMetrics(peakPoints, minPeriodSamples, maxPeriodSamples, settings);
  const rawTroughSpans = analyzeSpanMetrics(
    troughPoints,
    minPeriodSamples,
    maxPeriodSamples,
    settings,
  );
  const peakSpanByValue = new Map(
    rawPeakSpans.map((spanMetrics) => [spanMetrics.span, spanMetrics]),
  );
  const troughSpanByValue = new Map(
    rawTroughSpans.map((spanMetrics) => [spanMetrics.span, spanMetrics]),
  );
  const sortedCandidateSpans = [...candidateSpans].toSorted((left, right) => left - right);
  const rawCombinedSpans = [];

  for (let spanIndex = 0; spanIndex < sortedCandidateSpans.length; spanIndex += 1) {
    const span = sortedCandidateSpans[spanIndex];
    const peakSpanMetrics = peakSpanByValue.get(span) ?? getRunMetrics(peakPoints, span, settings);
    const troughSpanMetrics =
      troughSpanByValue.get(span) ?? getRunMetrics(troughPoints, span, settings);
    const coveredPointIndices = new Set();

    for (let runIndex = 0; runIndex < peakSpanMetrics.runs.length; runIndex += 1) {
      const run = peakSpanMetrics.runs[runIndex];
      for (let pointIndex = 0; pointIndex < run.points.length; pointIndex += 1) {
        coveredPointIndices.add(run.points[pointIndex].index);
      }
    }

    for (let runIndex = 0; runIndex < troughSpanMetrics.runs.length; runIndex += 1) {
      const run = troughSpanMetrics.runs[runIndex];
      for (let pointIndex = 0; pointIndex < run.points.length; pointIndex += 1) {
        coveredPointIndices.add(run.points[pointIndex].index);
      }
    }

    const totalAmpDisplacement =
      peakSpanMetrics.totalAmpDisplacement + troughSpanMetrics.totalAmpDisplacement;
    const runs = peakSpanMetrics.runs.concat(troughSpanMetrics.runs);

    rawCombinedSpans.push({
      span,
      runCount: peakSpanMetrics.runCount + troughSpanMetrics.runCount,
      totalSpanCount: peakSpanMetrics.totalSpanCount + troughSpanMetrics.totalSpanCount,
      totalRunLength: peakSpanMetrics.totalRunLength + troughSpanMetrics.totalRunLength,
      totalAmpDisplacement,
      coverage: points.length === 0 ? 0 : (coveredPointIndices.size / points.length) * 100,
      coverageRatio: points.length === 0 ? 0 : coveredPointIndices.size / points.length,
      runs,
      peakSpanMetrics,
      troughSpanMetrics,
      avgAmpDisplacementPerRun:
        peakSpanMetrics.runCount + troughSpanMetrics.runCount === 0
          ? Number.NaN
          : totalAmpDisplacement / (peakSpanMetrics.runCount + troughSpanMetrics.runCount),
    });
  }
  const addScore = (spanMetrics) => {
    const flatnessWeight = settings.flatnessWeight ?? 1;
    const separationWeight = settings.separationWeight ?? 1;
    const coverageWeight = settings.coverageWeight ?? 1;
    const scaledAmpDisplacement = Number.isFinite(spanMetrics.avgAmpDisplacementPerRun)
      ? Math.min(
          1,
          Math.max(0, spanMetrics.avgAmpDisplacementPerRun / MAX_POINT_TO_POINT_AMP_DISPLACEMENT),
        )
      : 1;
    const flatness = 1 - scaledAmpDisplacement;
    const baseScore =
      flatnessWeight * flatness +
      separationWeight * spanMetrics.separation +
      coverageWeight * spanMetrics.coverageRatio;
    return {
      ...spanMetrics,
      scaledAmpDisplacement,
      flatness,
      baseScore,
      score: baseScore,
    };
  };
  const applySubharmonicDelta = (spanMetricsList) => {
    const sortedSpanMetrics = spanMetricsList.toSorted((left, right) => left.span - right.span);
    const minSpan = sortedSpanMetrics[0]?.span ?? Number.POSITIVE_INFINITY;
    const spanMetricsBySpan = new Map(
      sortedSpanMetrics.map((spanMetrics) => [spanMetrics.span, spanMetrics]),
    );
    const getProjectedReferenceScore = (targetSpan) => {
      const exactSpanMetrics = spanMetricsBySpan.get(targetSpan);
      if (exactSpanMetrics) return exactSpanMetrics.baseScore;

      let lowerIndex = -1;
      let upperIndex = sortedSpanMetrics.length;
      while (upperIndex - lowerIndex > 1) {
        const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
        if (sortedSpanMetrics[middleIndex].span < targetSpan) {
          lowerIndex = middleIndex;
        } else {
          upperIndex = middleIndex;
        }
      }

      const lowerSpanMetrics = lowerIndex >= 0 ? sortedSpanMetrics[lowerIndex] : null;
      const upperSpanMetrics =
        upperIndex < sortedSpanMetrics.length ? sortedSpanMetrics[upperIndex] : null;

      if (lowerSpanMetrics === null || upperSpanMetrics === null) return 0;

      const position =
        (targetSpan - lowerSpanMetrics.span) / (upperSpanMetrics.span - lowerSpanMetrics.span);
      return (
        lowerSpanMetrics.baseScore +
        (upperSpanMetrics.baseScore - lowerSpanMetrics.baseScore) * position
      );
    };

    return sortedSpanMetrics.map((spanMetrics) => {
      let projectedReferenceScore = 0;
      for (let divisor = 2; spanMetrics.span / divisor >= minSpan; divisor += 1) {
        projectedReferenceScore = Math.max(
          projectedReferenceScore,
          getProjectedReferenceScore(spanMetrics.span / divisor),
        );
      }
      return {
        ...spanMetrics,
        projectedReferenceScore,
        score: spanMetrics.baseScore - projectedReferenceScore,
      };
    });
  };
  const combinedSpansWithSeparation = addSeparationScores(rawCombinedSpans);
  const scoredCombinedSpans = [];
  for (let index = 0; index < combinedSpansWithSeparation.length; index += 1) {
    scoredCombinedSpans.push(addScore(combinedSpansWithSeparation[index]));
  }
  // const combinedSpans = applySubharmonicDelta(scoredCombinedSpans);
  const combinedSpans = scoredCombinedSpans;

  function preferSpanMetrics(currentBest, candidate) {
    if (candidate.score > currentBest.score) return candidate;
    if (
      candidate.score === currentBest.score &&
      candidate.totalRunLength > currentBest.totalRunLength
    )
      return candidate;
    if (
      candidate.score === currentBest.score &&
      candidate.totalRunLength === currentBest.totalRunLength &&
      candidate.runCount > currentBest.runCount
    ) {
      return candidate;
    }
    if (
      candidate.score === currentBest.score &&
      candidate.totalRunLength === currentBest.totalRunLength &&
      candidate.runCount === currentBest.runCount &&
      candidate.totalAmpDisplacement < currentBest.totalAmpDisplacement
    ) {
      return candidate;
    }
    return currentBest;
  }

  if (combinedSpans.length === 0) {
    return {
      peakSpans: rawPeakSpans,
      troughSpans: rawTroughSpans,
      combinedSpans,
      bestSpan: null,
    };
  }
  const bestSpan = combinedSpans.reduce(
    (best, spanMetrics) => preferSpanMetrics(best, spanMetrics),
    {
      span: Number.NaN,
      runCount: 0,
      totalSpanCount: 0,
      totalRunLength: 0,
      totalAmpDisplacement: Number.POSITIVE_INFINITY,
      coverage: 0,
      scaledAmpDisplacement: 1,
      baseScore: 0,
      projectedReferenceScore: 0,
      score: 0,
      avgAmpDisplacementPerRun: Number.POSITIVE_INFINITY,
    },
  );

  return {
    peakSpans: rawPeakSpans,
    troughSpans: rawTroughSpans,
    combinedSpans,
    bestSpan,
  };
}

export function getPipsPitchHzFromWaveform(samples, sampleRate, settings) {
  const debug = window.pipsDebug;
  const { points, minRawAmp, maxRawAmp } = getPipsPointDataFromWaveform(samples, settings);
  debug.points = points;
  debug.minRawAmp = minRawAmp;
  debug.maxRawAmp = maxRawAmp;
  debug.peakSpans = [];
  debug.troughSpans = [];
  debug.combinedSpans = [];
  debug.bestSpan = null;
  debug.rejectionReason = null;

  if (points.length === 0) {
    debug.rejectionReason = "noPoints";
    return Number.NaN;
  }
  if (maxRawAmp - minRawAmp < (settings.minAmp ?? 0)) {
    debug.rejectionReason = "minAmp";
    return Number.NaN;
  }

  const spanAnalysis = findBestSpan(points, sampleRate, settings);
  debug.peakSpans = spanAnalysis.peakSpans;
  debug.troughSpans = spanAnalysis.troughSpans;
  debug.combinedSpans = spanAnalysis.combinedSpans;
  debug.bestSpan = spanAnalysis.bestSpan;

  if (!spanAnalysis.bestSpan) {
    debug.rejectionReason = "noBestSpan";
    return Number.NaN;
  }
  // if (spanAnalysis.bestSpan.peakSpanMetrics.runCount !== spanAnalysis.bestSpan.troughSpanMetrics.runCount) {
  //   debug.rejectionReason = "peakTroughRunMismatch";
  //   return Number.NaN;
  // }
  // if (spanAnalysis.bestSpan.runCount > 8) {
  //   debug.rejectionReason = "tooManyRuns";
  //   return Number.NaN;
  // }
  // if (spanAnalysis.bestSpan.coverageRatio !== 1) {
  //   debug.rejectionReason = "partialCoverage";
  //   return Number.NaN;
  // }

  const periodSamples = spanAnalysis.bestSpan?.span ?? Number.NaN;
  return Number.isFinite(periodSamples) ? sampleRate / periodSamples : Number.NaN;
}
