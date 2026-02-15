import {createWindowSpectrumComputer} from "./browserSpectrum.js";
import {analyzeAudioWindowSpectrumV5, createAudioState, setupAudioState} from "./audioSeriesV5.local.js";

export const FFT_HARMONIC_COMB_METHOD = "fftHarmonicComb";
// export const AUDIO_PATH = "./assets/david_vocals.wav";
// export const AUDIO_PATH = "./assets/david_vocals2.wav";
export const AUDIO_PATH = "./assets/david_subharmonics.wav";
// export const AUDIO_PATH = "./assets/david_vocals_vibrato.wav";
// export const AUDIO_PATH = "./assets/opera-vocals_129bpm_F_minor.wav";
// export const AUDIO_PATH = "./assets/opera-female-vocals_140bpm_A_major.wav";
export const FFT_BIN_COUNT = 4096;
export const WINDOW_SIZE = 2048;
export const SAMPLES_PER_SECOND = 200;
// export const MIN_HZ = 65.406; // C2
export const MIN_HZ = 40; // D1-ish
export const MAX_HZ = 2093.005; // C7
export const RMS_MIN = 0.01;

export const V5_SETTINGS_DEFAULT = {
  maxP: 12,
  pCount: 12,
  pRefineCount: 4,
  searchRadiusBins: 2,
  offWeight: 0.5,
  expectedP0MinRatio: 0.18,
  expectedP0PenaltyWeight: 2.0,
  downwardBiasPerP: 0.02,
  minRms: 0.01,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeV5Settings(source = {}) {
  return {
    maxP: clamp(Math.round(Number(source.maxP ?? V5_SETTINGS_DEFAULT.maxP)), 2, 12),
    pCount: clamp(Math.round(Number(source.pCount ?? V5_SETTINGS_DEFAULT.pCount)), 4, 24),
    pRefineCount: clamp(Math.round(Number(source.pRefineCount ?? V5_SETTINGS_DEFAULT.pRefineCount)), 1, 8),
    searchRadiusBins: clamp(Math.round(Number(source.searchRadiusBins ?? V5_SETTINGS_DEFAULT.searchRadiusBins)), 0, 6),
    offWeight: clamp(Number(source.offWeight ?? V5_SETTINGS_DEFAULT.offWeight), 0, 2),
    expectedP0MinRatio: clamp(Number(source.expectedP0MinRatio ?? V5_SETTINGS_DEFAULT.expectedP0MinRatio), 0, 1),
    expectedP0PenaltyWeight: clamp(Number(source.expectedP0PenaltyWeight ?? V5_SETTINGS_DEFAULT.expectedP0PenaltyWeight), 0, 5),
    downwardBiasPerP: clamp(Number(source.downwardBiasPerP ?? V5_SETTINGS_DEFAULT.downwardBiasPerP), 0, 0.2),
    minRms: clamp(Number(source.minRms ?? V5_SETTINGS_DEFAULT.minRms), 0, 0.1),
  };
}

// Kept for the Node test harness in this directory.
export function predictF0(values, {
  tol = 1.5,
  maxDivisor = 8,
  minInliers = 2,
  minValue = 0,
} = {}) {
  const xs = [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))]
      .sort((a, b) => a - b);
  if (xs.length < 2) return Number.NaN;

  const candidates = new Set();
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const diff = xs[j] - xs[i];
      if (diff <= tol) continue;
      for (let divisor = 1; divisor <= maxDivisor; divisor += 1) {
        const candidate = diff / divisor;
        if (candidate > tol) candidates.add(candidate);
      }
    }
  }

  function distanceToNearestMultiple(value, gcdCandidate) {
    const multiple = Math.max(1, Math.round(value / gcdCandidate));
    return Math.abs(value - (multiple * gcdCandidate));
  }

  let bestGcd = Number.NaN;
  let bestInliers = -1;
  let bestError = Number.POSITIVE_INFINITY;
  for (const gcdCandidate of candidates) {
    if (gcdCandidate < minValue) continue;
    let inliers = 0;
    let error = 0;
    for (const value of xs) {
      const distance = distanceToNearestMultiple(value, gcdCandidate);
      if (distance <= tol) inliers += 1;
      error += Math.min(distance, tol);
    }
    if (
        inliers > bestInliers ||
        (inliers === bestInliers && gcdCandidate > bestGcd) ||
        (inliers === bestInliers && gcdCandidate === bestGcd && error < bestError)
    ) {
      bestGcd = gcdCandidate;
      bestInliers = inliers;
      bestError = error;
    }
  }
  if (bestInliers >= minInliers) {
    return bestGcd;
  }

  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const gap = xs[i + 1] - xs[i];
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  const smallestValue = xs[0];
  return Math.min(minGap, smallestValue);
}

export const SCORE_PROCESSORS = {
  "V5: app detector": "V5: app detector",
};

export async function analyzePitchTrackBrowserFft(samples, sampleRate, options = {}) {
  const hopSamples = Math.max(1, Math.round(sampleRate / SAMPLES_PER_SECOND));
  const windowCount = Math.max(0, Math.floor((samples.length - WINDOW_SIZE) / hopSamples) + 1);

  const getWindowSpectrum = await createWindowSpectrumComputer({
    samples,
    sampleRate,
    binCount: FFT_BIN_COUNT,
    windowSize: WINDOW_SIZE,
    hopSamples,
    windowCount,
  });

  const trackState = setupAudioState(createAudioState(SAMPLES_PER_SECOND), {
    context: null,
    source: null,
    stream: null,
    captureNode: null,
    analyser: null,
    sinkGain: null,
    analysisFps: SAMPLES_PER_SECOND,
    centerSeconds: 1,
    sampleRate,
  });

  const v5Settings = normalizeV5Settings(options.v5Settings ?? {});
  const windowIndex = new Array(windowCount);
  const hz = new Array(windowCount);
  const freqCandidateStartBins = new Array(windowCount);
  const freqCandidateScores = new Array(windowCount);
  const windowSpectrumMagnitudes = new Array(windowCount);
  const processorDebug = new Array(windowCount);

  const maxAnalyzableHz = sampleRate / 2;
  const binSizeHz = maxAnalyzableHz / FFT_BIN_COUNT;
  const nyquistBinIndex = FFT_BIN_COUNT - 1;
  const minBinIndex = clamp(Math.floor(MIN_HZ / binSizeHz), 1, nyquistBinIndex);
  const maxBinIndex = clamp(Math.floor(MAX_HZ / binSizeHz), minBinIndex, nyquistBinIndex);

  const startedAt = performance.now();
  for (let index = 0; index < windowCount; index += 1) {
    const startSample = index * hopSamples;
    const analysisWindow = samples.subarray(startSample, startSample + WINDOW_SIZE);
    const magnitudes = getWindowSpectrum(index);

    windowIndex[index] = index;
    windowSpectrumMagnitudes[index] = magnitudes;

    const result = analyzeAudioWindowSpectrumV5(
        trackState,
        analysisWindow,
        magnitudes,
        MIN_HZ,
        MAX_HZ,
        {
          ...v5Settings,
          adaptiveRange: false,
          minRms: v5Settings.minRms,
        }
    );

    hz[index] = result && result.hasVoice && Number.isFinite(result.hz) ? result.hz : Number.NaN;
    freqCandidateStartBins[index] = minBinIndex;
    freqCandidateScores[index] = null;
    processorDebug[index] = {
      confidence: result?.confidence ?? 0,
      hasVoice: result?.hasVoice ?? false,
      v5Settings,
      ...(result?.debug ?? {}),
    };
  }
  const elapsedMs = performance.now() - startedAt;

  return {
    frequencyBinCount: FFT_BIN_COUNT,
    windowCount,
    elapsedMs,
    msPerWindow: windowCount > 0 ? elapsedMs / windowCount : 0,
    windowIndex,
    hz,
    freqCandidateStartBins,
    freqCandidateScores,
    windowSpectrumMagnitudes,
    processorDebug,
    method: `${FFT_HARMONIC_COMB_METHOD}:V5 app detector`,
    v5Settings,
  };
}
