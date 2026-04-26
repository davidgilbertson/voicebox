import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { getFoldExtremaFromWaveform as getFoldPointsFromWaveform } from "./pizaPitch.js";

/*   == Terminology ==
Point: A feature of the wave, either a peak or a trough.
Peak: A point above the center line.
Trough: A point below the center line.
Span: The line between two points.
Fold: A section of the waveform entirely above or below the center line.
Index: The x position in samples.
Match: A point's possible pairing with another point.
Pair: Two points that represent the same feature repeated.
Lane: A series of points in a narrow band of amplitude. The points in a lane *should* represent the same feature repeating once per period
*/
const AMP_PER_MILLI = 1;
const SPREAD_THRESHOLD = 9;
const PERIOD_BUCKET_VARIATION_THRESHOLD = 0.1;
const LANE_AMP_GAP_THRESHOLD = 0.1;
const EDGE_DEAD_ZONE_SAMPLES = 150;

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

  return { scaledSamples, maxAbsSample };
}

function getPointSpans(points) {
  const pointsByIndex = points.toSorted((left, right) => left.index - right.index);
  const spans = [];

  for (let index = 1; index < pointsByIndex.length; index += 1) {
    spans.push({
      leftPoint: pointsByIndex[index - 1],
      rightPoint: pointsByIndex[index],
      width: pointsByIndex[index].index - pointsByIndex[index - 1].index,
    });
  }

  return spans;
}

function getPairSpans(points) {
  const spans = [];
  for (const point of points) {
    if (!point.rightPair) continue;
    spans.push({
      width: point.rightPair.point.index - point.index,
      point,
    });
  }
  return spans;
}

function spread(points) {
  if (points.length < 3) {
    throw new Error("spread expects at least 3 points");
  }
  const spans = getPointSpans(points);

  let maxSpread = 0;

  for (let index = 1; index < spans.length; index += 1) {
    const leftWidth = spans[index - 1].width;
    const rightWidth = spans[index].width;
    const meanWidth = (leftWidth + rightWidth) / 2;
    const localSpread = Math.abs(rightWidth - leftWidth) / meanWidth;
    if (localSpread > maxSpread) {
      maxSpread = localSpread;
    }
  }

  return maxSpread * 100;
}

function getPairedPoints(point) {
  const pairedPoints = [];
  if (point.leftPair) pairedPoints.push(point.leftPair.point);
  if (point.rightPair) pairedPoints.push(point.rightPair.point);
  return pairedPoints;
}

function removeMatch(pointA, pointB) {
  const [leftPoint, rightPoint] = pointB.index < pointA.index ? [pointB, pointA] : [pointA, pointB];
  const capturePoint = 326;
  const captureOthers = [2547, 2654];

  // if (leftPoint.index === capturePoint) {
  //   console.log("removeMatch", leftPoint, rightPoint);
  // }
  // if (
  //   (leftPoint.index === capturePoint && captureOthers.includes(rightPoint.index)) ||
  //   (rightPoint.index === capturePoint && captureOthers.includes(leftPoint.index))
  // ) {
  //   console.log("removeMatch", leftPoint, rightPoint);
  // }

  rightPoint.leftMatches = rightPoint.leftMatches.filter((candidate) => candidate !== leftPoint);
  leftPoint.rightMatches = leftPoint.rightMatches.filter((candidate) => candidate !== rightPoint);
}

function createPair(pointA, pointB, phase) {
  const [leftPoint, rightPoint] = pointA.index < pointB.index ? [pointA, pointB] : [pointB, pointA];

  for (const match of [...leftPoint.rightMatches]) {
    removeMatch(leftPoint, match);
  }
  for (const match of [...rightPoint.leftMatches]) {
    removeMatch(rightPoint, match);
  }

  leftPoint.rightPair = { point: rightPoint, phase };
  rightPoint.leftPair = { point: leftPoint, phase };
}

function getPoints(rawPoints, rawSamples) {
  const points = [];
  for (let index = 0; index < rawPoints.length; index += 1) {
    const rawPoint = rawPoints[index];
    points.push({
      name: `${rawPoint.type === "trough" ? "T" : "P"}${index + 1}`,
      type: rawPoint.type,
      index: rawPoint.index,
      scaledAmp: rawPoint.value,
      rawAmp: rawSamples[rawPoint.index],
      leftMatches: [],
      rightMatches: [],
      leftPair: null,
      rightPair: null,
    });
  }
  return points;
}

function checkIsolatedLane(pointsByAmp, minPeriodSamples, maxPeriodSamples) {
  const debug = window.piraDebug;
  let lanePoints = [pointsByAmp[0]];

  for (let index = 1; index < pointsByAmp.length; index += 1) {
    const point = pointsByAmp[index];
    const prevPoint = pointsByAmp[index - 1];
    if (Math.abs(point.scaledAmp - prevPoint.scaledAmp) > LANE_AMP_GAP_THRESHOLD) {
      if (lanePoints.length >= 3) {
        const laneSpread = spread(lanePoints);
        if (laneSpread <= SPREAD_THRESHOLD) {
          const predictionSpans = getPointSpans(lanePoints);
          const periodSamples = predictionSpans.at(-1).width;
          if (periodSamples < minPeriodSamples || periodSamples > maxPeriodSamples) {
            return null;
          }
          debug.predictionSpans = predictionSpans;
          debug.spread = laneSpread;
          return periodSamples;
        }
      }
      lanePoints = [point];
      continue;
    }
    lanePoints.push(point);
  }

  if (lanePoints.length < 3) return null;

  const laneSpread = spread(lanePoints);
  if (laneSpread > SPREAD_THRESHOLD) return null;

  debug.predictionSpans = getPointSpans(lanePoints);
  const periodSamples = debug.predictionSpans.at(-1).width;
  if (periodSamples < minPeriodSamples || periodSamples > maxPeriodSamples) return null;
  debug.spread = laneSpread;
  return periodSamples;
}

function checkIsolatedSet(pointsByAmp, samplesLength, maxPeriodSamples) {
  const debug = window.piraDebug;
  const setPoints = [];

  for (const point of pointsByAmp) {
    setPoints.push(point);

    if (setPoints.length >= 3) {
      const setSpread = spread(setPoints);
      if (setSpread > SPREAD_THRESHOLD) {
        continue;
        // return null;
      }
    }

    if (setPoints.length < 2) continue;

    const predictionSpans = getPointSpans(setPoints);
    const periodSamples = predictionSpans.at(-1).width;
    if (periodSamples > maxPeriodSamples) continue;
    const pointsByIndex = setPoints.toSorted((left, right) => left.index - right.index);
    const leftGap = pointsByIndex[0].index;
    const rightGap = samplesLength - 1 - pointsByIndex.at(-1).index;

    if (
      leftGap <= periodSamples + EDGE_DEAD_ZONE_SAMPLES &&
      rightGap <= periodSamples + EDGE_DEAD_ZONE_SAMPLES
    ) {
      debug.predictionSpans = predictionSpans;
      debug.spread = setPoints.length >= 3 ? spread(setPoints) : 0;
      return periodSamples;
    }
  }

  return null;
}

function quickChecks(pointsByAmp, samplesLength, minPeriodSamples, maxPeriodSamples, pointType) {
  const debug = window.piraDebug;
  const isolatedSetPeriodSamples = checkIsolatedSet(pointsByAmp, samplesLength, maxPeriodSamples);
  if (isolatedSetPeriodSamples !== null) {
    debug.predictionReason = `isolatedSet:${pointType}`;
    return isolatedSetPeriodSamples;
  }
  const isolatedLanePeriodSamples = checkIsolatedLane(
    pointsByAmp,
    minPeriodSamples,
    maxPeriodSamples,
  );
  if (isolatedLanePeriodSamples !== null) {
    debug.predictionReason = `isolatedLane:${pointType}`;
    return isolatedLanePeriodSamples;
  }

  return null;
}

function getMatches(pointsByAmp, minPeriodSamples, maxPeriodSamples) {
  // For each point, what other points are with x-value range and a y-value cone.
  const maxAmpDelta = (AMP_PER_MILLI * maxPeriodSamples) / 1000;

  for (let ampSortIndex = 0; ampSortIndex < pointsByAmp.length; ampSortIndex += 1) {
    pointsByAmp[ampSortIndex].ampSortIndex = ampSortIndex;
  }

  for (const point of pointsByAmp) {
    point.leftMatches = [];
    point.rightMatches = [];
  }

  for (const point of pointsByAmp) {
    for (
      let dist = 1;
      point.ampSortIndex - dist >= 0 || point.ampSortIndex + dist < pointsByAmp.length;
      dist += 1
    ) {
      for (const ampIndex of [point.ampSortIndex - dist, point.ampSortIndex + dist]) {
        if (ampIndex < 0 || ampIndex >= pointsByAmp.length) continue;

        const candidate = pointsByAmp[ampIndex];
        const ampDelta = Math.abs(candidate.scaledAmp - point.scaledAmp);
        if (ampDelta > maxAmpDelta) continue;

        const indexDelta = Math.abs(candidate.index - point.index);
        if (indexDelta < minPeriodSamples || indexDelta > maxPeriodSamples) {
          continue;
        }
        if (ampDelta <= (AMP_PER_MILLI * indexDelta) / 1000) {
          if (candidate.index < point.index) {
            if (!point.leftMatches.includes(candidate)) {
              point.leftMatches.push(candidate);
            }
            if (!candidate.rightMatches.includes(point)) {
              candidate.rightMatches.push(point);
            }
          } else {
            if (!point.rightMatches.includes(candidate)) {
              point.rightMatches.push(candidate);
            }
            if (!candidate.leftMatches.includes(point)) {
              candidate.leftMatches.push(point);
            }
          }
        }
      }
    }
  }

  for (const point of pointsByAmp) {
    point.leftMatches.sort((left, right) => left.index - right.index);
    point.rightMatches.sort((left, right) => left.index - right.index);
  }

  return null;
}

function checkOneTruePair(point, phase, leftCompleteIndex, rightCompleteIndex) {
  const leftMatches = point.leftMatches;
  const rightMatches = point.rightMatches;

  // A side only becomes conclusive once the full max-period span is visible in that direction.
  if (point.index >= leftCompleteIndex && leftMatches.length === 1 && !point.leftPair) {
    createPair(leftMatches[0], point, phase);
    // console.log(
    //   `i=${window.windowIndex}: got a 'one true pair' match. ${leftMatches[0].name} -> ${point.name}`,
    // );
    return true;
  }

  if (point.index <= rightCompleteIndex && rightMatches.length === 1 && !point.rightPair) {
    createPair(point, rightMatches[0], phase);
    // console.log(
    //   `i=${window.windowIndex}: got a 'one true pair' match. ${point.name} -> ${rightMatches[0].name}`,
    // );
    return true;
  }

  return false;
}

function checkMonotonic(point) {
  const changedPoints = [];

  for (const match of [...point.leftMatches, ...point.rightMatches]) {
    for (const pairedPoint of getPairedPoints(match)) {
      // Once a match is already paired, crossing back over that span would create a zig-zag.
      if (point.index < match.index !== match.index < pairedPoint.index) {
        console.log(
          `i=${window.windowIndex}: removing non-monotonic match. ${point.name} -> ${match.name}`,
        );
        removeMatch(point, match);
        changedPoints.push(point, match, pairedPoint);
        break;
      }
    }
  }

  return changedPoints;
}

function checkRepeatMatches(point) {
  const changedPoints = [];

  for (const side of ["left", "right"]) {
    const allMatches = side === "left" ? point.leftMatches : point.rightMatches;
    const sampleMatches = side === "left" ? allMatches.slice(-3) : allMatches.slice(0, 3);
    if (sampleMatches.length < 2) continue;

    const pointSequence = side === "left" ? [...sampleMatches, point] : [point, ...sampleMatches];
    if (spread(pointSequence) > SPREAD_THRESHOLD) continue;

    // If the gaps look like a low-variance repeat, keep the nearest copy and drop the rest.
    const closestMatch = side === "left" ? allMatches.at(-1) : allMatches[0];
    const otherMatches = side === "left" ? allMatches.slice(0, -1) : allMatches.slice(1);

    createPair(point, closestMatch, 3);

    for (const match of otherMatches) {
      removeMatch(point, match);
      changedPoints.push(match);
    }

    changedPoints.push(point, closestMatch);
  }

  return changedPoints;
}

function enqueuePoint(pendingPoints, scheduledPoints, point) {
  if (scheduledPoints.has(point)) return;
  scheduledPoints.add(point);
  pendingPoints.push(point);
}

function enqueueConsequences(pendingPoints, scheduledPoints, point) {
  for (const match of [...point.leftMatches, ...point.rightMatches]) {
    enqueuePoint(pendingPoints, scheduledPoints, match);
  }
  for (const pairedPoint of getPairedPoints(point)) {
    enqueuePoint(pendingPoints, scheduledPoints, pairedPoint);
  }
}

function addFirstPassPairs(points, leftCompleteIndex, rightCompleteIndex) {
  for (const point of points) {
    checkOneTruePair(point, 1, leftCompleteIndex, rightCompleteIndex);
  }
}

function addSecondPassPairs(points, leftCompleteIndex, rightCompleteIndex) {
  // `pendingPoints` is the worklist; `scheduledPoints` prevents duplicates while a point is waiting.
  const pendingPoints = [];
  const scheduledPoints = new Set();

  for (const point of points) {
    enqueuePoint(pendingPoints, scheduledPoints, point);
  }

  while (pendingPoints.length > 0) {
    const point = pendingPoints.shift();
    scheduledPoints.delete(point);

    // Pruning one point can make nearby points newly conclusive, so re-check the local neighborhood.
    const changedPoints = checkMonotonic(point);
    for (const changedPoint of changedPoints) {
      const pairWasAdded = checkOneTruePair(changedPoint, 2, leftCompleteIndex, rightCompleteIndex);
      enqueueConsequences(pendingPoints, scheduledPoints, changedPoint);
      if (!pairWasAdded) continue;
      for (const pairedPoint of getPairedPoints(changedPoint)) {
        enqueueConsequences(pendingPoints, scheduledPoints, pairedPoint);
      }
    }
  }
}

function addThirdPassPairs(points, leftCompleteIndex, rightCompleteIndex) {
  // `pendingPoints` is the worklist; `scheduledPoints` prevents duplicates while a point is waiting.
  const pendingPoints = [];
  const scheduledPoints = new Set();

  for (const point of points) {
    enqueuePoint(pendingPoints, scheduledPoints, point);
  }

  while (pendingPoints.length > 0) {
    const point = pendingPoints.shift();
    scheduledPoints.delete(point);

    // This pass uses the same worklist pattern as pass 2, but with repeat-spacing pruning.
    const changedPoints = checkRepeatMatches(point);
    for (const changedPoint of changedPoints) {
      const pairWasAdded = checkOneTruePair(changedPoint, 3, leftCompleteIndex, rightCompleteIndex);
      enqueueConsequences(pendingPoints, scheduledPoints, changedPoint);
      if (!pairWasAdded) continue;
      for (const pairedPoint of getPairedPoints(changedPoint)) {
        enqueueConsequences(pendingPoints, scheduledPoints, pairedPoint);
      }
    }
  }
}

function getPeriodFromPairs(points) {
  const spans = getPairSpans(points);
  if (spans.length === 0) return Number.NaN;

  const spansByWidth = spans.toSorted((left, right) => left.width - right.width);
  let bestStart = 0;
  let bestEnd = 0;
  let windowStart = 0;

  for (let windowEnd = 0; windowEnd < spansByWidth.length; windowEnd += 1) {
    while (windowStart < windowEnd) {
      const minWidth = spansByWidth[windowStart].width;
      const maxWidth = spansByWidth[windowEnd].width;
      const midWidth = (minWidth + maxWidth) / 2;
      if ((maxWidth - minWidth) / midWidth <= PERIOD_BUCKET_VARIATION_THRESHOLD) {
        break;
      }
      windowStart += 1;
    }

    const bestCount = bestEnd - bestStart + 1;
    const currentCount = windowEnd - windowStart + 1;
    const bestRightMostIndex = spansByWidth
      .slice(bestStart, bestEnd + 1)
      .reduce((rightMostIndex, span) => Math.max(rightMostIndex, span.point.index), -1);
    const currentRightMostIndex = spansByWidth
      .slice(windowStart, windowEnd + 1)
      .reduce((rightMostIndex, span) => Math.max(rightMostIndex, span.point.index), -1);

    if (
      currentCount > bestCount ||
      (currentCount === bestCount && currentRightMostIndex > bestRightMostIndex)
    ) {
      bestStart = windowStart;
      bestEnd = windowEnd;
    }
  }

  const winningSpan = spansByWidth.slice(bestStart, bestEnd + 1).reduce((rightMostSpan, span) => {
    return span.point.index > rightMostSpan.point.index ? span : rightMostSpan;
  });
  return winningSpan.width;
}

export function getPiraPitchHzFromWaveform(samples, sampleRate, settings) {
  const debug = window.piraDebug;
  const { scaledSamples, maxAbsSample } = getScaledSamples(samples);
  const foldPoints = getFoldPointsFromWaveform(scaledSamples, settings);
  const minPeriodSamples = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSamples = Math.max(minPeriodSamples, Math.floor(sampleRate / PICA_MIN_HZ));

  const peakPoints = getPoints(foldPoints.peaks, samples);
  const troughPoints = getPoints(foldPoints.troughs, samples);
  const points = [...peakPoints, ...troughPoints].toSorted(
    (left, right) => left.index - right.index,
  );
  debug.points = points;
  debug.predictionSpans = [];
  debug.predictionReason = null;
  debug.maxAbsSample = maxAbsSample;
  debug.ampPerMilli = AMP_PER_MILLI;
  debug.spread = Number.NaN;
  debug.periodSamples = Number.NaN;
  if (foldPoints.folds.length === 0) {
    debug.predictionReason = "noFolds";
    debug.predictionReasons[window.windowIndex] = debug.predictionReason;
    debug.periodSamplesByWindow[window.windowIndex] = Number.NaN;
    debug.spreadsByWindow[window.windowIndex] = Number.NaN;
    return Number.NaN;
  }

  const pointMinAmp = Math.min(...points.map((point) => point.rawAmp));
  const pointMaxAmp = Math.max(...points.map((point) => point.rawAmp));
  if (pointMaxAmp - pointMinAmp < (settings.minAmp ?? 0)) {
    debug.predictionReason = "minAmp";
    debug.predictionReasons[window.windowIndex] = debug.predictionReason;
    debug.periodSamplesByWindow[window.windowIndex] = Number.NaN;
    debug.spreadsByWindow[window.windowIndex] = Number.NaN;
    return Number.NaN;
  }

  const peakPointsByAmp = peakPoints.toSorted((left, right) => right.scaledAmp - left.scaledAmp);
  const peakPeriodSamples = quickChecks(
    peakPointsByAmp,
    samples.length,
    minPeriodSamples,
    maxPeriodSamples,
    "peaks",
  );
  if (peakPeriodSamples !== null) {
    debug.periodSamples = peakPeriodSamples;
    debug.predictionReasons[window.windowIndex] = debug.predictionReason;
    debug.periodSamplesByWindow[window.windowIndex] = peakPeriodSamples;
    debug.spreadsByWindow[window.windowIndex] = debug.spread;
    return Number.isFinite(peakPeriodSamples) ? sampleRate / peakPeriodSamples : Number.NaN;
  }

  const troughPointsByAmp = troughPoints.toSorted(
    (left, right) => left.scaledAmp - right.scaledAmp,
  );
  const troughPeriodSamples = quickChecks(
    troughPointsByAmp,
    samples.length,
    minPeriodSamples,
    maxPeriodSamples,
    "troughs",
  );
  if (troughPeriodSamples !== null) {
    debug.periodSamples = troughPeriodSamples;
    debug.predictionReasons[window.windowIndex] = debug.predictionReason;
    debug.periodSamplesByWindow[window.windowIndex] = troughPeriodSamples;
    debug.spreadsByWindow[window.windowIndex] = debug.spread;
    return Number.isFinite(troughPeriodSamples) ? sampleRate / troughPeriodSamples : Number.NaN;
  }

  getMatches(peakPointsByAmp, minPeriodSamples, maxPeriodSamples);
  getMatches(troughPointsByAmp, minPeriodSamples, maxPeriodSamples);

  const leftCompleteIndex = maxPeriodSamples;
  const rightCompleteIndex = samples.length - maxPeriodSamples;

  addFirstPassPairs(peakPoints, leftCompleteIndex, rightCompleteIndex);
  addFirstPassPairs(troughPoints, leftCompleteIndex, rightCompleteIndex);
  addSecondPassPairs(peakPoints, leftCompleteIndex, rightCompleteIndex);
  addSecondPassPairs(troughPoints, leftCompleteIndex, rightCompleteIndex);
  addThirdPassPairs(peakPoints, leftCompleteIndex, rightCompleteIndex);
  addThirdPassPairs(troughPoints, leftCompleteIndex, rightCompleteIndex);

  const pairedPoints = points.filter((point) => point.leftPair || point.rightPair);
  validateStructure(points);
  const periodSamples = getPeriodFromPairs(points);
  debug.spread = pairedPoints.length < 3 ? Number.NaN : spread(pairedPoints);
  debug.periodSamples = periodSamples;
  debug.predictionReason = "pairs";
  debug.predictionReasons[window.windowIndex] = debug.predictionReason;
  debug.periodSamplesByWindow[window.windowIndex] = periodSamples;
  debug.spreadsByWindow[window.windowIndex] = debug.spread;
  return Number.isFinite(periodSamples) ? sampleRate / periodSamples : Number.NaN;
}

function validateStructure(points) {
  for (const point of points) {
    // Matches are two-way and live on opposite sides.
    for (const leftMatch of point.leftMatches) {
      console.assert(
        leftMatch.index < point.index,
        "left match must be to the left",
        point,
        leftMatch,
      );
      console.assert(
        leftMatch.rightMatches.includes(point),
        "left match must point back",
        point,
        leftMatch,
      );
    }
    for (const rightMatch of point.rightMatches) {
      console.assert(
        rightMatch.index > point.index,
        "right match must be to the right",
        point,
        rightMatch,
      );
      console.assert(
        rightMatch.leftMatches.includes(point),
        "right match must point back",
        point,
        rightMatch,
      );
    }

    // Once a side is paired, that side should no longer have any matches.
    console.assert(
      point.leftPair === null || point.leftMatches.length === 0,
      "left pair and left matches are mutually exclusive",
      point,
    );
    console.assert(
      point.rightPair === null || point.rightMatches.length === 0,
      "right pair and right matches are mutually exclusive",
      point,
    );

    // Pairs are two-way and live on opposite sides.
    if (point.leftPair) {
      console.assert(
        point.leftPair.point.index < point.index,
        "left pair must be to the left",
        point,
      );
      console.assert(
        point.leftPair.point.rightPair.point === point,
        "left pair must point back",
        point,
      );
      console.assert(
        point.leftPair.point.rightPair.phase === point.leftPair.phase,
        "pair phase must agree",
        point,
      );
    }
    if (point.rightPair) {
      console.assert(
        point.rightPair.point.index > point.index,
        "right pair must be to the right",
        point,
      );
      console.assert(
        point.rightPair.point.leftPair.point === point,
        "right pair must point back",
        point,
      );
      console.assert(
        point.rightPair.point.leftPair.phase === point.rightPair.phase,
        "pair phase must agree",
        point,
      );
    }
  }
}
