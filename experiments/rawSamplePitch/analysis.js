import {
  RAW_ACCURACY_CENTS,
  RAW_MAX_HZ,
  RAW_MIN_HZ,
  RAW_MIN_WINDOW_MAX_AMPLITUDE,
  RAW_SETTINGS_DEFAULTS,
} from "./config.js";
import { getRawSampleWindowSize } from "./windowing.js";
import {
  getCandidateWeightedScore,
  getCentsDifference,
  getLogCorrelation,
  hasZeroCrossing,
} from "./utils.js";

const PEAKINESS_NEIGHBOR_OFFSET = 2;
const TIMESTEPS_PER_SECOND = 80;
const VOCAL_SAMPLER_FILE_NAME = "vocal_sampler.wav";
const VOCAL_SAMPLER_ACTUAL_FILE_NAME = "vocal_sampler_actual.json";

function getRawSettings(settings = {}) {
  return {
    ...RAW_SETTINGS_DEFAULTS,
    ...settings,
    maxExtremaPerFold:
      settings.maxExtremaPerFold ?? settings.peakCount ?? RAW_SETTINGS_DEFAULTS.maxExtremaPerFold,
    rawGlobalLogCorrelationCutoff:
      settings.rawGlobalLogCorrelationCutoff ??
      settings.logCorrelationCutoff ??
      RAW_SETTINGS_DEFAULTS.rawGlobalLogCorrelationCutoff,
  };
}

function getCorrelationFromPeriodV1(samples, periodSamples, maxComparisonPatches) {
  if (periodSamples < 1) return -1;
  const patchCount = Math.min(maxComparisonPatches, Math.floor(samples.length / periodSamples));
  if (patchCount < 2) return -1;

  let totalCorrelation = 0;
  let comparisonCount = 0;
  for (let patchIndex = 0; patchIndex < patchCount - 1; patchIndex += 1) {
    const rightEnd = samples.length - patchIndex * periodSamples;
    const rightStart = rightEnd - periodSamples;
    const leftStart = rightStart - periodSamples;
    if (leftStart < 0) break;

    let dot = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let sampleIndex = 0; sampleIndex < periodSamples; sampleIndex += 1) {
      const left = samples[leftStart + sampleIndex];
      const right = samples[rightStart + sampleIndex];
      dot += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }
    if (leftPower <= 0 || rightPower <= 0) continue;
    totalCorrelation += dot / Math.sqrt(leftPower * rightPower);
    comparisonCount += 1;
  }

  return comparisonCount > 0 ? totalCorrelation / comparisonCount : -1;
}

function getCorrelationFromPeriod(samples, periodSamples, maxComparisonPatches) {
  if (periodSamples < 1) return -1;
  const patchCount = Math.min(maxComparisonPatches, Math.floor(samples.length / periodSamples));
  if (patchCount < 2) return -1;
  const corrSamplePoints = 30;
  const stride = Math.max(1, Math.floor(periodSamples / corrSamplePoints));

  let totalCorrelation = 0;
  let comparisonCount = 0;
  for (let patchIndex = 0; patchIndex < patchCount - 1; patchIndex += 1) {
    const rightEnd = samples.length - patchIndex * periodSamples;
    const rightStart = rightEnd - periodSamples;
    const leftStart = rightStart - periodSamples;
    if (leftStart < 0) break;

    let dot = 0;
    let leftPower = 0;
    let rightPower = 0;
    for (let sampleIndex = 0; sampleIndex < periodSamples; sampleIndex += stride) {
      const left = samples[leftStart + sampleIndex];
      const right = samples[rightStart + sampleIndex];
      dot += left * right;
      leftPower += left * left;
      rightPower += right * right;
    }
    if (leftPower <= 0 || rightPower <= 0) continue;
    totalCorrelation += dot / Math.sqrt(leftPower * rightPower);
    comparisonCount += 1;
  }

  return comparisonCount > 0 ? totalCorrelation / comparisonCount : -1;
}

function createWindowAnalysisCache() {
  return {
    correlationByPeriodSamples: new Map(),
    walkedPeriodByPeriodSamples: new Map(),
  };
}

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

function getCachedCorrelation(samples, periodSamples, settings, cache) {
  const cachedCorrelation = cache?.correlationByPeriodSamples.get(periodSamples);
  if (cachedCorrelation !== undefined) {
    return cachedCorrelation;
  }

  const correlation = getCorrelationFromPeriod(
    samples,
    periodSamples,
    settings.maxComparisonPatches,
  );
  cache?.correlationByPeriodSamples.set(periodSamples, correlation);
  return correlation;
}

function getRefinedPitchHz(samples, periodSamples, sampleRate, settings, cache = null) {
  const centerCorrelation = getCachedCorrelation(samples, periodSamples, settings, cache);
  const lowerCorrelation = getCachedCorrelation(samples, periodSamples - 1, settings, cache);
  const higherCorrelation = getCachedCorrelation(samples, periodSamples + 1, settings, cache);
  const curvature = lowerCorrelation - 2 * centerCorrelation + higherCorrelation;
  if (curvature === 0) {
    return sampleRate / periodSamples;
  }

  const offset = (lowerCorrelation - higherCorrelation) / (2 * curvature);
  if (offset < -1 || offset > 1) {
    return sampleRate / periodSamples;
  }

  return sampleRate / (periodSamples + offset);
}

function getPeriodSampleBounds(sampleRate) {
  const minPeriodSamples = Math.max(1, Math.ceil(sampleRate / RAW_MAX_HZ));
  const maxPeriodSamples = Math.max(minPeriodSamples, Math.floor(sampleRate / RAW_MIN_HZ));
  return {
    minPeriodSamples,
    maxPeriodSamples,
  };
}

function getWalkedPeriod(samples, seedPeriodSamples, settings, sampleRate, cache = null) {
  const cachedWalkedPeriod = cache?.walkedPeriodByPeriodSamples.get(seedPeriodSamples);
  if (cachedWalkedPeriod !== undefined) {
    return cachedWalkedPeriod;
  }

  let bestPeriodSamples = seedPeriodSamples;
  let bestCorrelation = getCachedCorrelation(samples, seedPeriodSamples, settings, cache);
  const visitedPeriodSamples = [seedPeriodSamples];

  let step = 0;
  while (step < settings.maxWalkSteps) {
    const walkStepSize = bestPeriodSamples % 2 === 0 ? 2 : 1;
    let lowerPeriodSamples = bestPeriodSamples - walkStepSize;
    let higherPeriodSamples = bestPeriodSamples + walkStepSize;
    let lowerCorrelation =
      lowerPeriodSamples > 0
        ? getCachedCorrelation(samples, lowerPeriodSamples, settings, cache)
        : -1;
    let higherCorrelation = getCachedCorrelation(samples, higherPeriodSamples, settings, cache);

    if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
      lowerPeriodSamples = bestPeriodSamples - 1;
      higherPeriodSamples = bestPeriodSamples + 1;
      lowerCorrelation =
        lowerPeriodSamples > 0
          ? getCachedCorrelation(samples, lowerPeriodSamples, settings, cache)
          : -1;
      higherCorrelation = getCachedCorrelation(samples, higherPeriodSamples, settings, cache);
      if (lowerCorrelation <= bestCorrelation && higherCorrelation <= bestCorrelation) {
        break;
      }
    }

    if (higherCorrelation > lowerCorrelation) {
      bestPeriodSamples = higherPeriodSamples;
      bestCorrelation = higherCorrelation;
      visitedPeriodSamples.push(bestPeriodSamples);
      step += 1;
      continue;
    }

    bestPeriodSamples = lowerPeriodSamples;
    bestCorrelation = lowerCorrelation;
    visitedPeriodSamples.push(bestPeriodSamples);
    step += 1;
  }

  const refinedHz = getRefinedPitchHz(samples, bestPeriodSamples, sampleRate, settings, cache);
  const walkedPeriod =
    refinedHz < RAW_MIN_HZ || refinedHz > RAW_MAX_HZ
      ? null
      : {
          periodSamples: bestPeriodSamples,
          correlation: bestCorrelation,
          logCorrelation: getLogCorrelation(bestCorrelation),
          hz: refinedHz,
        };

  for (const periodSamples of visitedPeriodSamples) {
    cache?.walkedPeriodByPeriodSamples.set(periodSamples, walkedPeriod);
  }

  return walkedPeriod;
}

export function getWalkedPitchHz(samples, sampleRate, seedHz, settings = RAW_SETTINGS_DEFAULTS) {
  const rawSettings = getRawSettings(settings);
  const seedPeriodSamples = Math.round(sampleRate / seedHz);
  const walkedPeriod = getWalkedPeriod(samples, seedPeriodSamples, rawSettings, sampleRate);
  return walkedPeriod ? walkedPeriod.hz : Number.NaN;
}

function getLocalExtremaFromFold(samples, fold, type) {
  const matches = [];
  for (let sampleIndex = fold.startSample + 1; sampleIndex < fold.endSample - 1; sampleIndex += 1) {
    const previous = samples[sampleIndex - 1];
    const current = samples[sampleIndex];
    const next = samples[sampleIndex + 1];
    const isPeak = previous < current && current > next;
    const isTrough = previous > current && current < next;
    if (type === "peak" && isPeak) {
      matches.push({ index: sampleIndex, value: current });
    }
    if (type === "trough" && isTrough) {
      matches.push({ index: sampleIndex, value: current });
    }
  }
  return matches;
}

function getExtremaFromFold(samples, fold, maxExtremaPerFold, requireStrictLocalExtrema) {
  const type = fold.type;
  if (!type) return [];

  const localExtrema = getLocalExtremaFromFold(samples, fold, type);
  if (localExtrema.length === 0 && requireStrictLocalExtrema) {
    return [];
  }

  const extrema = localExtrema.length
    ? localExtrema
    : (() => {
        let strongestIndex = fold.startSample;
        for (
          let sampleIndex = fold.startSample + 1;
          sampleIndex < fold.endSample;
          sampleIndex += 1
        ) {
          if (Math.abs(samples[sampleIndex]) > Math.abs(samples[strongestIndex])) {
            strongestIndex = sampleIndex;
          }
        }
        return [
          {
            index: strongestIndex,
            value: samples[strongestIndex],
          },
        ];
      })();

  if (extrema.length <= maxExtremaPerFold) {
    return [...extrema]
      .sort((left, right) => right.index - left.index)
      .map((extremum) => ({
        ...extremum,
        type,
        foldIndex: fold.foldIndex,
      }));
  }

  return extrema
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, maxExtremaPerFold)
    .sort((left, right) => right.index - left.index)
    .map((extremum) => ({
      ...extremum,
      type,
      foldIndex: fold.foldIndex,
    }));
}

function getRecentFoldsFromWaveform(samples, maxCrossingsPerPeriod) {
  const folds = [];
  let foldEndSample = samples.length;
  let foldStartSample = samples.length - 1;

  while (foldStartSample > 0 && folds.length < maxCrossingsPerPeriod * 2) {
    let type = null;
    while (
      foldStartSample > 0 &&
      !hasZeroCrossing(samples[foldStartSample - 1], samples[foldStartSample])
    ) {
      if (type === null) {
        const sample = samples[foldStartSample];
        if (sample > 0) type = "peak";
        if (sample < 0) type = "trough";
      }
      foldStartSample -= 1;
    }

    if (type === null) {
      const sample = samples[foldStartSample];
      if (sample > 0) type = "peak";
      if (sample < 0) type = "trough";
    }

    folds.push({
      foldIndex: folds.length,
      startSample: foldStartSample,
      endSample: foldEndSample,
      type,
    });

    if (foldStartSample === 0) break;
    foldEndSample = foldStartSample;
    foldStartSample -= 1;
  }

  return folds;
}

function getFoldExtremaFromWaveform(samples, settings) {
  const recentFolds = getRecentFoldsFromWaveform(samples, settings.maxCrossingsPerPeriod);
  return recentFolds.flatMap((fold) =>
    getExtremaFromFold(samples, fold, settings.maxExtremaPerFold, fold.foldIndex === 0),
  );
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

function getCandidatePeakiness(
  samples,
  periodSamples,
  sampleRate,
  settings,
  centerLogCorrelation,
  cache = null,
) {
  const { minPeriodSamples, maxPeriodSamples } = getPeriodSampleBounds(sampleRate);
  const lowerPeriodSamples = periodSamples - PEAKINESS_NEIGHBOR_OFFSET;
  const higherPeriodSamples = periodSamples + PEAKINESS_NEIGHBOR_OFFSET;
  if (lowerPeriodSamples < minPeriodSamples || higherPeriodSamples > maxPeriodSamples) {
    return 0;
  }

  const lowerCorrelation = getCachedCorrelation(samples, lowerPeriodSamples, settings, cache);
  const higherCorrelation = getCachedCorrelation(samples, higherPeriodSamples, settings, cache);
  if (lowerCorrelation < 0 || higherCorrelation < 0) {
    return 0;
  }

  return (
    centerLogCorrelation -
    (getLogCorrelation(lowerCorrelation) + getLogCorrelation(higherCorrelation)) / 2
  );
}

function getCandidateFamiliesFromExtrema(samples, sampleRate, foldExtrema, settings, cache = null) {
  const candidateFamilies = [];
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

      const sourcePeriodSamples = anchor.index - earlierExtremum.index;
      if (sourcePeriodSamples < 1) continue;
      const sourceHz = sampleRate / sourcePeriodSamples;
      if (sourceHz < RAW_MIN_HZ || sourceHz > RAW_MAX_HZ) continue;

      const walkedPeriod = getWalkedPeriod(
        samples,
        sourcePeriodSamples,
        settings,
        sampleRate,
        cache,
      );
      if (!walkedPeriod) continue;
      const peakiness = getCandidatePeakiness(
        samples,
        walkedPeriod.periodSamples,
        sampleRate,
        settings,
        walkedPeriod.logCorrelation,
        cache,
      );

      candidateFamilies.push({
        type,
        pointPair: [anchor.index, earlierExtremum.index],
        sourcePeriodSamples,
        periodSamples: walkedPeriod.periodSamples,
        hz: walkedPeriod.hz,
        correlation: walkedPeriod.correlation,
        logCorrelation: walkedPeriod.logCorrelation,
        peakiness,
        weightedScore: getCandidateWeightedScore(
          walkedPeriod.hz,
          walkedPeriod.correlation,
          settings.octaveBias,
          peakiness,
          settings.peakinessBias,
        ),
      });
    }
  }

  return candidateFamilies;
}

function getWinningCandidate(candidateFamilies) {
  let bestCandidate = null;
  for (const candidate of candidateFamilies) {
    if (!bestCandidate || candidate.weightedScore > bestCandidate.weightedScore) {
      bestCandidate = candidate;
    }
  }
  return bestCandidate;
}

function getRawPitchResultFromAnalysis(analysis, settings) {
  if (analysis.maxAmplitude < RAW_MIN_WINDOW_MAX_AMPLITUDE) {
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

  if (analysis.winningCandidate.logCorrelation < settings.rawGlobalLogCorrelationCutoff) {
    return {
      hz: Number.NaN,
      rejectionReason: "low_log_correlation",
    };
  }

  return {
    hz: analysis.winningCandidate.hz,
    rejectionReason: null,
  };
}

function getRawWindowSamples(samples, sampleRate, endTimeSec) {
  const rawWindowSamples = getRawSampleWindowSize(sampleRate);
  const endSample = Math.min(samples.length, Math.max(0, Math.round(endTimeSec * sampleRate)));
  const startSample = Math.max(0, endSample - rawWindowSamples);
  return samples.subarray(startSample, endSample);
}

async function loadWavSamples(url) {
  const response = await fetch(url);
  const bytes = await response.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(bytes.slice(0));
    return {
      sampleRate: audioBuffer.sampleRate,
      samples: new Float32Array(audioBuffer.getChannelData(0)),
    };
  } finally {
    await audioContext.close();
  }
}

function getActualPitchUrl(audioInput) {
  if (typeof audioInput !== "string" || !audioInput.endsWith(VOCAL_SAMPLER_FILE_NAME)) {
    return null;
  }
  return audioInput.slice(0, -VOCAL_SAMPLER_FILE_NAME.length) + VOCAL_SAMPLER_ACTUAL_FILE_NAME;
}

async function loadActualPitchHz(audioInput) {
  const actualPitchUrl = getActualPitchUrl(audioInput);
  if (!actualPitchUrl) return null;

  const response = await fetch(actualPitchUrl);
  return await response.json();
}

export async function loadPitchSample(audioInput) {
  const { analyzeDecodedPitchSample, loadAudioSample } =
    await import("../pitchDetection/analysis.js");
  const loaded = await loadAudioSample(audioInput);
  const actualPitchHz = await loadActualPitchHz(audioInput);
  const fftAnalysis = await analyzeDecodedPitchSample(loaded);
  return {
    sampleRate: loaded.sampleRate,
    samples: loaded.samples,
    actualPitchHz,
    fftAnalysis,
  };
}

export async function loadActualPitchSample(audioInput) {
  const loaded = await loadWavSamples(audioInput);
  const actualPitchHz = await loadActualPitchHz(audioInput);
  return {
    sampleRate: loaded.sampleRate,
    samples: loaded.samples,
    actualPitchHz,
  };
}

export function getRawPitchAnalysisFromWaveform(
  samples,
  sampleRate,
  settings = RAW_SETTINGS_DEFAULTS,
) {
  const rawSettings = getRawSettings(settings);
  const cache = createWindowAnalysisCache();
  const { zeroCrossingCount, maxAmplitude } = getWindowStats(samples);
  const analysis = {
    zeroCrossingCount,
    maxAmplitude,
    foldExtrema: [],
    candidateFamilies: [],
    winningCandidate: null,
  };

  if (maxAmplitude < RAW_MIN_WINDOW_MAX_AMPLITUDE || zeroCrossingCount === 0) {
    return {
      ...analysis,
      ...getRawPitchResultFromAnalysis(analysis, rawSettings),
    };
  }

  const foldExtrema = getFoldExtremaFromWaveform(samples, rawSettings);
  const candidateFamilies = getCandidateFamiliesFromExtrema(
    samples,
    sampleRate,
    foldExtrema,
    rawSettings,
    cache,
  );
  const winningCandidate = getWinningCandidate(candidateFamilies);
  const completedAnalysis = {
    ...analysis,
    foldExtrema,
    candidateFamilies,
    winningCandidate,
  };
  const rawPitchResult = getRawPitchResultFromAnalysis(completedAnalysis, rawSettings);

  return {
    ...completedAnalysis,
    ...rawPitchResult,
  };
}

export function buildRawCorrelationHistogram(
  samples,
  sampleRate,
  settings = RAW_SETTINGS_DEFAULTS,
) {
  const rawSettings = getRawSettings(settings);
  const cache = createWindowAnalysisCache();
  const hz = [];
  const correlation = [];
  const logCorrelation = [];
  const { minPeriodSamples, maxPeriodSamples } = getPeriodSampleBounds(sampleRate);
  for (
    let periodSamples = maxPeriodSamples;
    periodSamples >= minPeriodSamples;
    periodSamples -= 1
  ) {
    const candidateHz = sampleRate / periodSamples;
    const candidateCorrelation = getCachedCorrelation(samples, periodSamples, rawSettings, cache);
    hz.push(candidateHz);
    correlation.push(candidateCorrelation);
    logCorrelation.push(getLogCorrelation(candidateCorrelation));
  }
  return {
    minHz: RAW_MIN_HZ,
    maxHz: RAW_MAX_HZ,
    hz,
    correlation,
    logCorrelation,
  };
}

export function evaluateRawWindow(samples, sampleRate, settings = RAW_SETTINGS_DEFAULTS) {
  const analysis = getRawPitchAnalysisFromWaveform(samples, sampleRate, settings);
  const histogram = buildRawCorrelationHistogram(samples, sampleRate, settings);
  let bestHistogramIndex = 0;
  for (let index = 1; index < histogram.logCorrelation.length; index += 1) {
    if (histogram.logCorrelation[index] > histogram.logCorrelation[bestHistogramIndex]) {
      bestHistogramIndex = index;
    }
  }
  return {
    analysis,
    histogram,
    histogramPeakHz: histogram.hz[bestHistogramIndex],
    histogramPeakLogCorrelation: histogram.logCorrelation[bestHistogramIndex],
  };
}

function getActualAccuracyMetrics(actualPitchHz, fftPitchHz, rawPitchHz) {
  let fftCorrectCount = 0;
  let rawCorrectCount = 0;
  let actualComparedCount = 0;
  if (!actualPitchHz) {
    return {
      fftAccuracy: Number.NaN,
      fftCorrectCount: 0,
      rawAccuracy: Number.NaN,
      rawCorrectCount: 0,
      actualComparedCount: 0,
      rawComparedCount: 0,
    };
  }

  for (let windowIndex = 0; windowIndex < actualPitchHz.length; windowIndex += 1) {
    const actualHz = actualPitchHz[windowIndex];
    if (!Number.isFinite(actualHz)) continue;

    actualComparedCount += 1;
    const fftHz = fftPitchHz?.[windowIndex];
    const rawHz = rawPitchHz[windowIndex];
    if (Number.isFinite(fftHz) && getCentsDifference(fftHz, actualHz) <= RAW_ACCURACY_CENTS) {
      fftCorrectCount += 1;
    }
    if (Number.isFinite(rawHz) && getCentsDifference(rawHz, actualHz) <= RAW_ACCURACY_CENTS) {
      rawCorrectCount += 1;
    }
  }

  return {
    fftAccuracy: actualComparedCount > 0 ? fftCorrectCount / actualComparedCount : Number.NaN,
    fftCorrectCount,
    rawAccuracy: actualComparedCount > 0 ? rawCorrectCount / actualComparedCount : Number.NaN,
    rawCorrectCount,
    actualComparedCount,
    rawComparedCount: actualComparedCount,
  };
}

export async function analyzePreparedPitchSample(preparedSample, settings = RAW_SETTINGS_DEFAULTS) {
  const rawSettings = getRawSettings(settings);
  const { actualPitchHz, fftAnalysis, sampleRate, samples } = preparedSample;
  const rawPitchHz = new Array(fftAnalysis.timeSec.length);

  const rawStartMs = performance.now();
  for (let windowIndex = 0; windowIndex < fftAnalysis.timeSec.length; windowIndex += 1) {
    if (!Number.isFinite(fftAnalysis.pitchHz[windowIndex])) {
      rawPitchHz[windowIndex] = Number.NaN;
      continue;
    }

    const rawWindow = getRawWindowSamples(samples, sampleRate, fftAnalysis.timeSec[windowIndex]);
    rawPitchHz[windowIndex] = getRawPitchAnalysisFromWaveform(
      rawWindow,
      sampleRate,
      rawSettings,
    ).hz;
  }
  const rawElapsedMs = performance.now() - rawStartMs;

  const metrics = getActualAccuracyMetrics(actualPitchHz, fftAnalysis.pitchHz, rawPitchHz);

  return {
    sampleRate,
    samples,
    timeSec: fftAnalysis.timeSec,
    actualPitchHz,
    pitchHz: fftAnalysis.pitchHz,
    rawPitchHz,
    rawSettings,
    metrics,
    perf: {
      voiceboxPipelineMsPerSecondAudio: fftAnalysis.perf.voiceboxPipelineMsPerSecondAudio,
      rawPipelineMsPerSecondAudio:
        fftAnalysis.timeSec.length > 0
          ? rawElapsedMs / (fftAnalysis.timeSec.length / fftAnalysis.samplesPerSecond)
          : Number.NaN,
    },
  };
}

export async function analyzePreparedActualPitchSample(
  preparedSample,
  settings = RAW_SETTINGS_DEFAULTS,
) {
  const rawSettings = getRawSettings(settings);
  const { actualPitchHz, sampleRate, samples } = preparedSample;
  const timeSec = actualPitchHz.map((_, index) => index / TIMESTEPS_PER_SECOND);
  const rawPitchHz = new Array(timeSec.length);

  const rawStartMs = performance.now();
  for (let windowIndex = 0; windowIndex < timeSec.length; windowIndex += 1) {
    const rawWindow = getRawWindowSamples(samples, sampleRate, timeSec[windowIndex]);
    rawPitchHz[windowIndex] = getRawPitchAnalysisFromWaveform(
      rawWindow,
      sampleRate,
      rawSettings,
    ).hz;
  }
  const rawElapsedMs = performance.now() - rawStartMs;

  return {
    sampleRate,
    samples,
    timeSec,
    actualPitchHz,
    pitchHz: new Array(timeSec.length).fill(Number.NaN),
    rawPitchHz,
    rawSettings,
    metrics: getActualAccuracyMetrics(actualPitchHz, null, rawPitchHz),
    perf: {
      voiceboxPipelineMsPerSecondAudio: Number.NaN,
      rawPipelineMsPerSecondAudio:
        timeSec.length > 0 ? rawElapsedMs / (timeSec.length / TIMESTEPS_PER_SECOND) : Number.NaN,
    },
  };
}
