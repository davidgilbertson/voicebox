import {createWindowSpectrumComputer} from "./browserSpectrum.js";

export const FFT_HARMONIC_COMB_METHOD = "fftHarmonicComb";
export const AUDIO_PATH = "./assets/david_vocals.wav";
export const FFT_BIN_COUNT = 4096;
export const WINDOW_SIZE = 2048;
export const SAMPLES_PER_SECOND = 200;
export const MIN_HZ = 65.406; // C2
export const MAX_HZ = 2093.005; // C7
export const RMS_MIN = 0.01;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hzToBinIndex(freqHz, binSizeHz) {
  return freqHz / binSizeHz;
}

function computeRms(samples) {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples.length);
}

function computeFreqCandidateScores(magnitudes, minBin, maxBin) {
  const nyquistBin = magnitudes.length - 1;
  let totalMagnitude = 0;
  for (let bin = 0; bin <= nyquistBin; bin += 1) {
    totalMagnitude += magnitudes[bin];
  }
  const globalMean = totalMagnitude / (nyquistBin + 1);

  const candidateScores = new Float64Array(nyquistBin + 1);
  for (let candidateBin = minBin; candidateBin <= maxBin; candidateBin += 1) {
    let multiplesMagnitude = 0;
    let multiplesCount = 0;
    for (let harmonicBin = candidateBin; harmonicBin <= nyquistBin; harmonicBin += candidateBin) {
      multiplesMagnitude += magnitudes[harmonicBin];
      multiplesCount += 1;
    }
    candidateScores[candidateBin] = multiplesMagnitude - (multiplesCount * globalMean);
  }
  return candidateScores;
}

function packFreqCandidateScores(candidateScores, minBin, maxBin) {
  return {
    freqCandidateStartBin: minBin,
    freqCandidateScores: Array.from(candidateScores.subarray(minBin, maxBin + 1)),
  };
}

export async function loadWavSamples(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load WAV: ${url} (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(bytes.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    return {
      sampleRate: audioBuffer.sampleRate,
      samples: new Float32Array(channelData),
    };
  } finally {
    await audioContext.close();
  }
}

export async function analyzePitchTrackBrowserFft(samples, sampleRate) {
  const hopSamples = Math.max(1, Math.round(sampleRate / SAMPLES_PER_SECOND));
  const windowCount = Math.max(0, Math.floor((samples.length - WINDOW_SIZE) / hopSamples) + 1);

  const windowIndex = new Array(windowCount);
  const hz = new Array(windowCount);
  const freqCandidateStartBins = new Array(windowCount);
  const freqCandidateScores = new Array(windowCount);
  const windowSpectrumMagnitudes = new Array(windowCount);

  const startedAt = performance.now();
  const getWindowSpectrum = await createWindowSpectrumComputer({
    samples,
    sampleRate,
    binCount: FFT_BIN_COUNT,
    windowSize: WINDOW_SIZE,
    hopSamples,
    windowCount,
  });

  const maxAnalyzableHz = sampleRate / 2;
  const binSizeHz = maxAnalyzableHz / FFT_BIN_COUNT;
  const nyquistBinIndex = FFT_BIN_COUNT - 1;
  const minBinIndex = clamp(Math.ceil(hzToBinIndex(MIN_HZ, binSizeHz)), 2, nyquistBinIndex);
  const maxBinIndex = clamp(
      Math.floor(hzToBinIndex(MAX_HZ, binSizeHz)),
      minBinIndex,
      nyquistBinIndex
  );

  let voicedCount = 0;

  // For each window... This simulated time steps, roughly
  for (let index = 0; index < windowCount; index += 1) {
    const startSample = index * hopSamples;
    const analysisWindow = samples.subarray(startSample, startSample + WINDOW_SIZE);
    const windowRms = computeRms(analysisWindow);

    windowIndex[index] = index;

    const magnitudes = getWindowSpectrum(index);
    windowSpectrumMagnitudes[index] = magnitudes;

    if (windowRms < RMS_MIN) {
      hz[index] = Number.NaN;
      freqCandidateStartBins[index] = null;
      freqCandidateScores[index] = null;
      continue;
    }

    const candidateScores = computeFreqCandidateScores(
        magnitudes,
        minBinIndex,
        maxBinIndex
    );
    let bestBinIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let candidateBinIndex = minBinIndex; candidateBinIndex <= maxBinIndex; candidateBinIndex += 1) {
      const score = candidateScores[candidateBinIndex];
      if (score > bestScore) {
        bestScore = score;
        bestBinIndex = candidateBinIndex;
      }
    }

    if (
        !Number.isFinite(bestScore)
        || bestScore <= 0
        || bestBinIndex < minBinIndex
        || bestBinIndex > maxBinIndex
    ) {
      hz[index] = Number.NaN;
    } else {
      const detectedHz = bestBinIndex * binSizeHz;
      hz[index] = detectedHz;
      if (detectedHz >= MIN_HZ && detectedHz <= MAX_HZ) {
        voicedCount += 1;
      }
    }

    const packedScores = packFreqCandidateScores(candidateScores, minBinIndex, maxBinIndex);
    freqCandidateStartBins[index] = packedScores.freqCandidateStartBin;
    freqCandidateScores[index] = packedScores.freqCandidateScores;
  }
  const elapsedMs = performance.now() - startedAt;

  return {
    frequencyBinCount: FFT_BIN_COUNT,
    hopSamples,
    windowCount,
    voicedCount,
    elapsedMs,
    msPerWindow: windowCount > 0 ? elapsedMs / windowCount : 0,
    windowIndex,
    hz,
    freqCandidateStartBins,
    freqCandidateScores,
    windowSpectrumMagnitudes,
  };
}
