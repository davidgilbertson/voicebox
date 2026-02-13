import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {fft} from "./fft-core.js";
import {createPitchOverTimeHtml, parseWavMono} from "./fft-playground-utils.js";

const FFT_BIN_COUNT = 4096;
const WINDOW_SIZE = 2048;
const SAMPLES_PER_SECOND = 200;
const MIN_HZ = 65.406; // C2
const MAX_HZ = 2093.005; // C7
const RMS_MIN = 0.01;
const HALF_SCORE_KEEP_RATIO = 0.93;
const HALF_MAGNITUDE_KEEP_RATIO = 0.55;
const DG_FFT_PITCH_METHOD = "dg_fft_pitch_baseline_v0";
const MOCK_FFT_WINDOW_FUNCTION = "blackman";
const MOCK_FFT_INCLUDE_NYQUIST = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeRms(samples) {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples.length);
}

function pickLocalPeak(magnitudes, index, maxIndex) {
  const left = magnitudes[Math.max(0, index - 1)];
  const mid = magnitudes[index];
  const right = magnitudes[Math.min(maxIndex, index + 1)];
  return Math.max(left, mid, right);
}

function refineBinParabolic(scores, bin, minBin, maxBin) {
  if (bin <= minBin || bin >= maxBin) return bin;
  const left = scores[bin - 1];
  const mid = scores[bin];
  const right = scores[bin + 1];
  const denom = left - (2 * mid) + right;
  if (denom === 0) return bin;
  const offset = 0.5 * (left - right) / denom;
  if (!Number.isFinite(offset)) return bin;
  return bin + clamp(offset, -1, 1);
}

function computeCandidateScores({
                                  magnitudes,
                                  minBin,
                                  maxBin,
                                  useLocalPeak,
                                }) {
  const nyquistBin = magnitudes.length - 1;
  let totalMagnitude = 0;
  for (let i = 0; i <= nyquistBin; i += 1) {
    totalMagnitude += magnitudes[i];
  }
  const meanMagnitude = totalMagnitude / (nyquistBin + 1);
  const candidateScores = new Float64Array(nyquistBin + 1);

  for (let candidateBin = minBin; candidateBin <= maxBin; candidateBin += 1) {
    let score = 0;
    for (let harmonicBin = candidateBin, harmonic = 1;
         harmonicBin <= nyquistBin;
         harmonicBin += candidateBin, harmonic += 1) {
      const harmonicMagnitude = useLocalPeak
          ? pickLocalPeak(magnitudes, harmonicBin, nyquistBin)
          : magnitudes[harmonicBin];
      const harmonicWeight = 1 / Math.sqrt(harmonic);
      score += Math.max(0, harmonicMagnitude - meanMagnitude) * harmonicWeight;
    }
    candidateScores[candidateBin] = score;
  }

  return candidateScores;
}

function findBestAndSecondBestBins(candidateScores, minBin, maxBin) {
  let bestBin = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let secondBestScore = Number.NEGATIVE_INFINITY;

  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const score = candidateScores[bin];
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestBin = bin;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  return {bestBin, bestScore, secondBestScore};
}

function computeFreqCandidateScoresBaselineV0(magnitudes, minBin, maxBin) {
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
    // Flipped form of residual: higher score is better.
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

function dg_fft_pitch_baseline_v0(window, sampleRate, minHz, maxHz, options = {}) {
  const rms = computeRms(window);
  if (rms < RMS_MIN) {
    return {hz: Number.NaN, rms, confidence: 0};
  }

  const spectrum = fft(window, sampleRate, {
    fftSize: FFT_BIN_COUNT * 2,
    windowFunction: MOCK_FFT_WINDOW_FUNCTION,
    includeNyquist: MOCK_FFT_INCLUDE_NYQUIST,
  });
  const magnitudes = spectrum.magnitudes;
  const nyquistBin = magnitudes.length - 1;
  const minBin = clamp(Math.ceil((minHz * spectrum.size) / sampleRate), 2, nyquistBin);
  const maxBin = clamp(Math.floor((maxHz * spectrum.size) / sampleRate), minBin, nyquistBin);
  const candidateScores = computeFreqCandidateScoresBaselineV0(magnitudes, minBin, maxBin);

  let bestBin = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let candidateBin = minBin; candidateBin <= maxBin; candidateBin += 1) {
    const score = candidateScores[candidateBin];
    if (score > bestScore) {
      bestScore = score;
      bestBin = candidateBin;
    }
  }

  if (!Number.isFinite(bestScore) || bestScore <= 0 || bestBin < minBin || bestBin > maxBin) {
    return {hz: Number.NaN, rms, confidence: 0};
  }
  const hz = (bestBin * sampleRate) / spectrum.size;
  if (options.includeFreqCandidateScores) {
    return {
      hz,
      rms,
      confidence: Number.NaN,
      ...packFreqCandidateScores(candidateScores, minBin, maxBin),
    };
  }
  return {hz, rms, confidence: Number.NaN};
}

function dg_fft_pitch_plus_v1(window, sampleRate, minHz, maxHz, options = {}) {
  const rms = computeRms(window);
  if (rms < RMS_MIN) {
    return {hz: Number.NaN, rms, confidence: 0};
  }

  const spectrum = fft(window, sampleRate, {
    fftSize: FFT_BIN_COUNT * 2,
    windowFunction: MOCK_FFT_WINDOW_FUNCTION,
    includeNyquist: MOCK_FFT_INCLUDE_NYQUIST,
  });
  const magnitudes = spectrum.magnitudes;
  const nyquistBin = magnitudes.length - 1;
  const minBin = clamp(Math.ceil((minHz * spectrum.size) / sampleRate), 2, nyquistBin);
  const maxBin = clamp(Math.floor((maxHz * spectrum.size) / sampleRate), minBin, nyquistBin);
  const candidateScores = computeCandidateScores({
    magnitudes,
    minBin,
    maxBin,
    useLocalPeak: true,
  });
  const {bestBin, bestScore, secondBestScore} = findBestAndSecondBestBins(
      candidateScores,
      minBin,
      maxBin
  );

  if (!Number.isFinite(bestScore) || bestScore <= 0 || bestBin < minBin || bestBin > maxBin) {
    return {hz: Number.NaN, rms, confidence: 0};
  }

  // Octave guard: only do a single half-step and require both score and magnitude support.
  let correctedBin = bestBin;
  if (bestBin >= minBin * 2) {
    const halfBin = Math.floor(bestBin / 2);
    if (halfBin >= minBin) {
      const halfScore = candidateScores[halfBin];
      const fullScore = candidateScores[bestBin];
      const halfMagnitude = pickLocalPeak(magnitudes, halfBin, nyquistBin);
      const fullMagnitude = pickLocalPeak(magnitudes, bestBin, nyquistBin);
      const keepsScore = halfScore >= fullScore * HALF_SCORE_KEEP_RATIO;
      const keepsMagnitude = halfMagnitude >= fullMagnitude * HALF_MAGNITUDE_KEEP_RATIO;
      if (keepsScore && keepsMagnitude) {
        correctedBin = halfBin;
      }
    }
  }

  const correctedScore = candidateScores[correctedBin];
  const confidence = Number.isFinite(secondBestScore) && correctedScore > 0
      ? Math.max(0, (correctedScore - secondBestScore) / correctedScore)
      : 1;
  const refinedBin = refineBinParabolic(candidateScores, correctedBin, minBin, maxBin);
  const hz = (refinedBin * sampleRate) / spectrum.size;
  if (options.includeFreqCandidateScores) {
    return {
      hz,
      rms,
      confidence,
      ...packFreqCandidateScores(candidateScores, minBin, maxBin),
    };
  }
  return {hz, rms, confidence};
}

function resolveRepoPath(relativePath) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..", relativePath);
}

function selectDgFftPitchMethod(methodName) {
  if (methodName === "dg_fft_pitch_baseline_v0") {
    return dg_fft_pitch_baseline_v0;
  }
  return dg_fft_pitch_plus_v1;
}

function analyzePitchTrack(samples, sampleRate, options) {
  const {
    windowSize,
    samplesPerSecond,
    minHz,
    maxHz,
    pitchFn,
  } = options;

  const hopSamples = Math.max(1, Math.round(sampleRate / samplesPerSecond));
  const windowCount = Math.max(0, Math.floor((samples.length - windowSize) / hopSamples) + 1);
  const timeSeconds = new Array(windowCount);
  const windowIndex = new Array(windowCount);
  const hz = new Array(windowCount);
  const rms = new Array(windowCount);
  const confidence = new Array(windowCount);
  const freqCandidateStartBins = new Array(windowCount);
  const freqCandidateScores = new Array(windowCount);

  const startedAt = performance.now();
  let voicedCount = 0;

  for (let index = 0; index < windowCount; index += 1) {
    const startSample = index * hopSamples;
    const analysisWindow = samples.subarray(startSample, startSample + windowSize);
    const detection = pitchFn(analysisWindow, sampleRate, minHz, maxHz, {
      includeFreqCandidateScores: true,
    });
    const hasPitch = detection.hz >= minHz && detection.hz <= maxHz;

    windowIndex[index] = index;
    timeSeconds[index] = (startSample + (windowSize / 2)) / sampleRate;
    hz[index] = hasPitch ? detection.hz : Number.NaN;
    rms[index] = detection.rms;
    confidence[index] = detection.confidence;
    freqCandidateStartBins[index] = Number.isFinite(detection.freqCandidateStartBin)
        ? detection.freqCandidateStartBin
        : null;
    freqCandidateScores[index] = Array.isArray(detection.freqCandidateScores)
        ? detection.freqCandidateScores
        : null;
    if (hasPitch) {
      voicedCount += 1;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    hopSamples,
    windowCount,
    voicedCount,
    elapsedMs,
    msPerWindow: windowCount > 0 ? elapsedMs / windowCount : 0,
    windowIndex,
    timeSeconds,
    hz,
    rms,
    confidence,
    freqCandidateStartBins,
    freqCandidateScores,
  };
}

function main() {
  const wavPath = resolveRepoPath("test/assets/david_vocals.wav");
  const outputDir = resolveRepoPath("scripts/fft-playground-output");
  const outputJsonPath = path.join(outputDir, "pitch-track-data.json");
  const outputHtmlPath = path.join(outputDir, "pitch-track.html");

  const {sampleRate, samples} = parseWavMono(wavPath);
  const pitchFn = selectDgFftPitchMethod(DG_FFT_PITCH_METHOD);
  const track = analyzePitchTrack(samples, sampleRate, {
    windowSize: WINDOW_SIZE,
    samplesPerSecond: SAMPLES_PER_SECOND,
    minHz: MIN_HZ,
    maxHz: MAX_HZ,
    pitchFn,
  });

  const payload = {
    sourceFile: wavPath,
    sampleRate,
    sourceSeconds: samples.length / sampleRate,
    windowSize: WINDOW_SIZE,
    transformLength: FFT_BIN_COUNT * 2,
    frequencyBinCount: FFT_BIN_COUNT,
    binSizeHz: sampleRate / (FFT_BIN_COUNT * 2),
    mockFftWindowFunction: MOCK_FFT_WINDOW_FUNCTION,
    mockFftIncludeNyquist: MOCK_FFT_INCLUDE_NYQUIST,
    samplesPerSecond: SAMPLES_PER_SECOND,
    hopSamples: track.hopSamples,
    pitchRange: {
      minHz: MIN_HZ,
      maxHz: MAX_HZ,
    },
    track: {
      method: DG_FFT_PITCH_METHOD,
      windowCount: track.windowCount,
      voicedCount: track.voicedCount,
      voicedRatio: track.windowCount > 0 ? track.voicedCount / track.windowCount : 0,
      elapsedMs: track.elapsedMs,
      msPerWindow: track.msPerWindow,
      windowIndex: track.windowIndex,
      timeSeconds: track.timeSeconds,
      hz: track.hz,
      rms: track.rms,
      confidence: track.confidence,
      freqCandidateStartBins: track.freqCandidateStartBins,
      freqCandidateScores: track.freqCandidateScores,
    },
  };

  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(outputJsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(outputHtmlPath, createPitchOverTimeHtml(payload));

  console.log(`Wrote ${outputJsonPath}`);
  console.log(`Wrote ${outputHtmlPath}`);
  console.log(
      `Processed ${track.windowCount} windows in ${track.elapsedMs.toFixed(2)} ms `
      + `(${track.msPerWindow.toFixed(4)} ms/window), voiced=${track.voicedCount}`
  );
  console.log(`Open in browser: ${pathToFileURL(outputHtmlPath).href}`);
}

main();
