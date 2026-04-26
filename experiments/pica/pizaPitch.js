export function getFoldExtremaFromWaveform(samples, settings) {
  const maxFoldCount = settings.maxCrossingsPerPeriod * 2;
  const maxExtremaPerType = Math.ceil(maxFoldCount / 2);
  const allPeaks = [];
  const allFolds = [];
  const allTroughs = [];
  let sawFirstCrossing = false;
  let foldStartIndex = -1;
  let bestIndex = -1;
  let bestValue = 0;
  let lastSample = samples[0];
  let lastType = samples[0] < 0 ? "trough" : "peak";

  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const type = sample < 0 ? "trough" : "peak";

    if (lastSample < 0 !== sample < 0) {
      if (!sawFirstCrossing) {
        sawFirstCrossing = true;
        foldStartIndex = sampleIndex;
        lastType = type;
        bestIndex = sampleIndex;
        bestValue = sample;
        lastSample = sample;
        continue;
      }

      const foldIndex = allFolds.length;
      const extremum = {
        index: bestIndex,
        value: bestValue,
        type: lastType,
        foldIndex,
      };
      allFolds.push({
        startIndex: foldStartIndex,
        endIndex: sampleIndex,
        width: sampleIndex - foldStartIndex,
        extremaAmplitude: bestValue,
        extremaPosition: bestIndex - foldStartIndex,
        extremaIndex: bestIndex,
        type: lastType,
        foldIndex,
      });
      if (lastType === "peak") {
        allPeaks.push(extremum);
      } else {
        allTroughs.push(extremum);
      }

      foldStartIndex = sampleIndex;
      lastType = type;
      bestIndex = sampleIndex;
      bestValue = sample;
    } else if (
      sawFirstCrossing &&
      (lastType === "peak" ? sample >= bestValue : sample <= bestValue)
    ) {
      bestIndex = sampleIndex;
      bestValue = sample;
    }

    lastSample = sample;
  }

  const folds = allFolds.slice(-maxFoldCount);
  if (window.pizaDebug.recordFoldDebug) {
    window.pizaDebug.foldAnalyses[window.pizaDebug.activeWindowIndex] = {
      fullFolds: folds,
    };
  }

  return {
    folds,
    peaks: allPeaks.slice(-maxExtremaPerType),
    troughs: allTroughs.slice(-maxExtremaPerType),
  };
}

export function getPitchFromFolds(folds, sampleRate, settings) {
  const MIN_FOLDS_IN_CLUSTER = 2;
  const clusters = [];
  const debugAnalysis = window.pizaDebug.recordFoldDebug
    ? window.pizaDebug.foldAnalyses[window.pizaDebug.activeWindowIndex]
    : null;

  if (debugAnalysis) {
    debugAnalysis.visitedFoldIndices = [];
    debugAnalysis.clusterIndexByFoldIndex = new Array(folds.length).fill(-1);
    debugAnalysis.clusterBoxes = [];
    debugAnalysis.selectedClusterIndex = -1;
    debugAnalysis.selectedFoldIndices = [];
    debugAnalysis.selectedRange = null;
  }

  for (let foldIndex = folds.length - 1; foldIndex >= 0; foldIndex -= 1) {
    const fold = folds[foldIndex];
    const matchingClusterIndices = clusters
      .map((cluster, clusterIndex) =>
        cluster.type === fold.type &&
        fold.width >= cluster.minWidth - settings.widthWindow &&
        fold.width <= cluster.maxWidth + settings.widthWindow &&
        fold.extremaAmplitude >= cluster.minExtremaAmplitude - settings.ampWindow &&
        fold.extremaAmplitude <= cluster.maxExtremaAmplitude + settings.ampWindow
          ? clusterIndex
          : -1,
      )
      .filter((clusterIndex) => clusterIndex !== -1);

    if (debugAnalysis) {
      debugAnalysis.visitedFoldIndices.push(foldIndex);
    }

    if (matchingClusterIndices.length > 0) {
      const cluster = clusters[matchingClusterIndices[0]];
      cluster.foldIndices.push(foldIndex);
      cluster.minWidth = Math.min(cluster.minWidth, fold.width);
      cluster.maxWidth = Math.max(cluster.maxWidth, fold.width);
      cluster.minExtremaAmplitude = Math.min(cluster.minExtremaAmplitude, fold.extremaAmplitude);
      cluster.maxExtremaAmplitude = Math.max(cluster.maxExtremaAmplitude, fold.extremaAmplitude);

      for (
        let matchingClusterOffset = matchingClusterIndices.length - 1;
        matchingClusterOffset >= 1;
        matchingClusterOffset -= 1
      ) {
        const mergedCluster = clusters[matchingClusterIndices[matchingClusterOffset]];
        cluster.foldIndices.push(...mergedCluster.foldIndices);
        cluster.minWidth = Math.min(cluster.minWidth, mergedCluster.minWidth);
        cluster.maxWidth = Math.max(cluster.maxWidth, mergedCluster.maxWidth);
        cluster.minExtremaAmplitude = Math.min(
          cluster.minExtremaAmplitude,
          mergedCluster.minExtremaAmplitude,
        );
        cluster.maxExtremaAmplitude = Math.max(
          cluster.maxExtremaAmplitude,
          mergedCluster.maxExtremaAmplitude,
        );
        clusters.splice(matchingClusterIndices[matchingClusterOffset], 1);
      }
      continue;
    }

    clusters.push({
      type: fold.type,
      minWidth: fold.width,
      maxWidth: fold.width,
      minExtremaAmplitude: fold.extremaAmplitude,
      maxExtremaAmplitude: fold.extremaAmplitude,
      foldIndices: [foldIndex],
    });
  }

  for (let didMerge = true; didMerge; ) {
    didMerge = false;
    for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      const leftCluster = clusters[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const rightCluster = clusters[rightIndex];
        const overlaps =
          leftCluster.type === rightCluster.type &&
          leftCluster.minWidth - settings.widthWindow <=
            rightCluster.maxWidth + settings.widthWindow &&
          leftCluster.maxWidth + settings.widthWindow >=
            rightCluster.minWidth - settings.widthWindow &&
          leftCluster.minExtremaAmplitude - settings.ampWindow <=
            rightCluster.maxExtremaAmplitude + settings.ampWindow &&
          leftCluster.maxExtremaAmplitude + settings.ampWindow >=
            rightCluster.minExtremaAmplitude - settings.ampWindow;
        if (!overlaps) continue;

        leftCluster.foldIndices.push(...rightCluster.foldIndices);
        leftCluster.minWidth = Math.min(leftCluster.minWidth, rightCluster.minWidth);
        leftCluster.maxWidth = Math.max(leftCluster.maxWidth, rightCluster.maxWidth);
        leftCluster.minExtremaAmplitude = Math.min(
          leftCluster.minExtremaAmplitude,
          rightCluster.minExtremaAmplitude,
        );
        leftCluster.maxExtremaAmplitude = Math.max(
          leftCluster.maxExtremaAmplitude,
          rightCluster.maxExtremaAmplitude,
        );
        clusters.splice(rightIndex, 1);
        didMerge = true;
        rightIndex -= 1;
      }
      leftCluster.foldIndices.sort(
        (leftFoldIndex, rightFoldIndex) => rightFoldIndex - leftFoldIndex,
      );
    }
  }

  if (debugAnalysis) {
    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      for (const foldIndex of clusters[clusterIndex].foldIndices) {
        debugAnalysis.clusterIndexByFoldIndex[foldIndex] = clusterIndex;
      }
    }
  }

  if (debugAnalysis) {
    debugAnalysis.clusterBoxes = clusters.map((cluster) => ({
      minWidth: cluster.minWidth - settings.widthWindow,
      maxWidth: cluster.maxWidth + settings.widthWindow,
      minExtremaAmplitude: cluster.minExtremaAmplitude - settings.ampWindow,
      maxExtremaAmplitude: cluster.maxExtremaAmplitude + settings.ampWindow,
    }));
  }

  const bestCluster = [...clusters]
    .sort((left, right) => right.maxWidth - left.maxWidth)
    .find((cluster) => cluster.foldIndices.length >= MIN_FOLDS_IN_CLUSTER);

  if (bestCluster) {
    const newestFoldIndex = bestCluster.foldIndices[0];
    const priorMatchingFoldIndex = bestCluster.foldIndices[1];
    let periodWidth = 0;
    for (
      let periodFoldIndex = priorMatchingFoldIndex + 1;
      periodFoldIndex <= newestFoldIndex;
      periodFoldIndex += 1
    ) {
      periodWidth += folds[periodFoldIndex].width;
    }

    if (debugAnalysis) {
      debugAnalysis.selectedClusterIndex = clusters.indexOf(bestCluster);
      debugAnalysis.selectedFoldIndices = [];
      for (
        let periodFoldIndex = priorMatchingFoldIndex + 1;
        periodFoldIndex <= newestFoldIndex;
        periodFoldIndex += 1
      ) {
        debugAnalysis.selectedFoldIndices.push(periodFoldIndex);
      }
      debugAnalysis.selectedRange = {
        startIndex: folds[priorMatchingFoldIndex + 1].startIndex,
        endIndex: folds[newestFoldIndex].endIndex,
      };
    }

    return sampleRate / periodWidth;
  }

  return Number.NaN;
}

export function getPizaPitchAnalysisFromWaveform(samples, sampleRate, settings) {
  const foldExtrema = getFoldExtremaFromWaveform(samples, settings);
  return {
    foldExtrema,
    hz: getPitchFromFolds(foldExtrema.folds, sampleRate, settings),
  };
}
