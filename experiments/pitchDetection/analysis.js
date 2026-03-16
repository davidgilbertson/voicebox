import { createWindowSpectrumComputer } from "./browserSpectrum.js";
import { DEFAULT_PITCH_TUNING, detectPitchFromSpectrumDetailed } from "../pitchDetectionCore.js";

// export const AUDIO_PATH = "../../.private/assets/david_vocals.wav";
// export const AUDIO_PATH = "../../.private/assets/david_clipping_e4.wav";
export const AUDIO_PATH = "../../.private/assets/High ah gaps.wav";
// export const AUDIO_PATH = "../../.private/assets/rozette_vibrato.wav";
export const DISPLAY_SAMPLES_PER_SECOND = 80;
// export const FFT_SIZE = 8192;
export const FFT_SIZE = 4096;
// export const FFT_SIZE = 2048;
export const FFT_BIN_COUNT = FFT_SIZE / 2;
export const MIN_HZ = 32.703;
export const MAX_HZ = 1396.913;
export const DEFAULT_PEAKINESS_CUTOFF = 0.8;
const ANCHOR_MAX_DIFF_CENTS = 400;
export { DEFAULT_PITCH_TUNING };
const PITCHY_MIN_CLARITY = 0.6;
let pitchyModulePromise = null;

function hzToCents(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return Number.NaN;
  return 1200 * Math.log2(hz);
}

function detectPeakiness(magnitudes) {
  const epsilon = 1e-12;
  const count = magnitudes.length - 1;
  const invCount = 1 / count;
  let logSum = 0;
  let linearSum = 0;
  let peakMagnitude = 0;
  for (let i = 1; i < magnitudes.length; i += 1) {
    const magnitude = magnitudes[i];
    if (magnitude > peakMagnitude) peakMagnitude = magnitude;
    const safeMagnitude = magnitude > epsilon ? magnitude : epsilon;
    logSum += Math.log(safeMagnitude);
    linearSum += safeMagnitude;
  }
  const flatness = Math.exp(logSum * invCount) / (linearSum * invCount);
  return {
    flatness,
    peakiness: 1 - flatness,
    peakMagnitude,
  };
}

function applyAnchorOutlierCorrectionInPlace(values, newestIndex) {
  if (newestIndex < 4) return;
  const left2 = values[newestIndex - 4];
  const right2 = values[newestIndex];
  if (!Number.isFinite(left2) || left2 <= 0) return;
  if (!Number.isFinite(right2) || right2 <= 0) return;

  const anchorDiffCents = Math.abs(hzToCents(left2) - hzToCents(right2));
  if (anchorDiffCents > ANCHOR_MAX_DIFF_CENTS) return;

  const anchorMeanHz = (left2 + right2) / 2;
  if (!(anchorMeanHz > 0)) return;
  const centerIndex = newestIndex - 2;
  const centerValue = values[centerIndex];
  if (!Number.isFinite(centerValue) || !(centerValue > 0)) return;

  if (Math.abs(Math.log(anchorMeanHz / centerValue)) <= 0.5) return;
  values[centerIndex] = anchorMeanHz;
}

function fftBinsToPitchDetailedWithDebug(spectrumBins, sampleRate, minHz, maxHz, tuning = null) {
  return detectPitchFromSpectrumDetailed(spectrumBins, sampleRate, {
    minHz,
    maxHz,
    tuning,
  });
}

async function getPitchyDetector(frameSize) {
  if (!pitchyModulePromise) {
    pitchyModulePromise = import("https://esm.sh/pitchy@4.1.0");
  }
  const pitchyModule = await pitchyModulePromise;
  return pitchyModule.PitchDetector.forFloat32Array(frameSize);
}

async function analyzePitchyComparison({ samples, sampleRate, hopSamples, windowCount }) {
  const pitchyHz = new Array(windowCount);
  let pitchyDetector = null;
  try {
    pitchyDetector = await getPitchyDetector(FFT_SIZE);
  } catch (error) {
    console.warn("Pitchy detector unavailable", error);
  }
  if (!pitchyDetector) {
    for (let i = 0; i < windowCount; i += 1) {
      pitchyHz[i] = Number.NaN;
    }
    return { pitchyHz, pitchyElapsedMs: 0 };
  }

  let pitchyElapsedMs = 0;
  for (let i = 0; i < windowCount; i += 1) {
    const endSample = i * hopSamples;
    if (endSample < FFT_SIZE) {
      pitchyHz[i] = Number.NaN;
      continue;
    }
    const frameSamples = samples.subarray(endSample - FFT_SIZE, endSample);
    const pitchyStartMs = performance.now();
    const [pitchyPitch, pitchyClarity] = pitchyDetector.findPitch(frameSamples, sampleRate);
    pitchyElapsedMs += performance.now() - pitchyStartMs;
    const pitchyInRange =
      Number.isFinite(pitchyPitch) &&
      pitchyPitch >= MIN_HZ &&
      pitchyPitch <= MAX_HZ &&
      pitchyClarity >= PITCHY_MIN_CLARITY;
    pitchyHz[i] = pitchyInRange ? pitchyPitch : Number.NaN;
  }
  return { pitchyHz, pitchyElapsedMs };
}

export function detectPitchFromSpectrumWithDebug(spectrumBins, sampleRate) {
  return fftBinsToPitchDetailedWithDebug(spectrumBins, sampleRate, MIN_HZ, MAX_HZ, null);
}

async function loadWavSamples(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load WAV: ${url} (${response.status})`);
  }
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

export async function loadAudioSample(audioInput = null) {
  return typeof audioInput === "string"
    ? loadWavSamples(audioInput)
    : (audioInput ?? (await loadWavSamples(AUDIO_PATH)));
}

export async function analyzeDecodedPitchSample(loaded, tuning = null, options = null) {
  const peakinessCutoff = Number.isFinite(options?.peakinessCutoff)
    ? Math.max(0, Math.min(1, options.peakinessCutoff))
    : DEFAULT_PEAKINESS_CUTOFF;
  const disablePeakinessGate = options?.disablePeakinessGate === true;
  const disablePeakinessMetrics = options?.disablePeakinessMetrics === true;
  const { sampleRate, samples } = loaded;
  const hopSamples = Math.max(1, Math.round(sampleRate / DISPLAY_SAMPLES_PER_SECOND));
  const windowCount = Math.max(0, Math.floor((samples.length - FFT_SIZE) / hopSamples) + 1);
  const spectrumStartMs = performance.now();
  const getWindowSpectrum = await createWindowSpectrumComputer({
    samples,
    sampleRate,
    binCount: FFT_BIN_COUNT,
    windowSize: FFT_SIZE,
    hopSamples,
    windowCount,
  });
  const spectrumElapsedMs = performance.now() - spectrumStartMs;

  const timeSec = new Array(windowCount);
  const pitchHz = new Array(windowCount);
  const spectralFlatness = new Array(windowCount);
  const peakiness = new Array(windowCount);
  const peakMagnitude = new Array(windowCount);
  const windowSpectra = new Array(windowCount);
  const windowDebug = new Array(windowCount);
  let voiceboxElapsedMs = 0;

  // Core Voicebox path
  for (let i = 0; i < windowCount; i += 1) {
    const magnitudes = getWindowSpectrum(i);
    const voiceboxStartMs = performance.now();
    const result = fftBinsToPitchDetailedWithDebug(magnitudes, sampleRate, MIN_HZ, MAX_HZ, tuning);
    voiceboxElapsedMs += performance.now() - voiceboxStartMs;
    const peakinessMetrics = disablePeakinessMetrics
      ? { flatness: Number.NaN, peakiness: Number.NaN, peakMagnitude: Number.NaN }
      : detectPeakiness(magnitudes);
    timeSec[i] = i / DISPLAY_SAMPLES_PER_SECOND;
    const hasEnoughHistory = i * hopSamples >= FFT_SIZE;
    pitchHz[i] =
      hasEnoughHistory &&
      result.hz > 0 &&
      (disablePeakinessGate ||
        (Number.isFinite(peakinessMetrics.peakiness) &&
          peakinessMetrics.peakiness >= peakinessCutoff))
        ? result.hz
        : Number.NaN;
    spectralFlatness[i] = peakinessMetrics.flatness;
    peakiness[i] = peakinessMetrics.peakiness;
    peakMagnitude[i] = peakinessMetrics.peakMagnitude;
    applyAnchorOutlierCorrectionInPlace(pitchHz, i);
    windowSpectra[i] = magnitudes;
    windowDebug[i] = result.debug;
  }

  return {
    sourceFile: AUDIO_PATH,
    sampleRate,
    samples,
    samplesPerSecond: DISPLAY_SAMPLES_PER_SECOND,
    hopSamples,
    windowSize: FFT_SIZE,
    binSizeHz: sampleRate / 2 / FFT_BIN_COUNT,
    timeSec,
    pitchHz,
    spectralFlatness,
    peakiness,
    peakMagnitude,
    peakinessCutoff,
    perf: {
      fftSpectrumMsPerSecondAudio:
        windowCount > 0
          ? spectrumElapsedMs / (windowCount / DISPLAY_SAMPLES_PER_SECOND)
          : Number.NaN,
      voiceboxMsPerSecondAudio:
        windowCount > 0
          ? voiceboxElapsedMs / (windowCount / DISPLAY_SAMPLES_PER_SECOND)
          : Number.NaN,
      voiceboxPipelineMsPerSecondAudio:
        windowCount > 0
          ? (spectrumElapsedMs + voiceboxElapsedMs) / (windowCount / DISPLAY_SAMPLES_PER_SECOND)
          : Number.NaN,
      windowCount,
    },
    windowSpectra,
    windowDebug,
  };
}

export async function analyzeDecodedPitchSampleWithComparison(
  loaded,
  tuning = null,
  options = null,
) {
  const voiceboxResult = await analyzeDecodedPitchSample(loaded, tuning, options);
  const { samples, sampleRate, hopSamples } = voiceboxResult;
  const windowCount = voiceboxResult.timeSec.length;
  const { pitchyHz, pitchyElapsedMs } = await analyzePitchyComparison({
    samples,
    sampleRate,
    hopSamples,
    windowCount,
  });

  return {
    ...voiceboxResult,
    pitchyHz,
    perf: {
      ...voiceboxResult.perf,
      pitchyMsPerSecondAudio:
        windowCount > 0 ? pitchyElapsedMs / (windowCount / DISPLAY_SAMPLES_PER_SECOND) : Number.NaN,
      timeRatio:
        pitchyElapsedMs > 0 && Number.isFinite(voiceboxResult.perf.voiceboxMsPerSecondAudio)
          ? voiceboxResult.perf.voiceboxMsPerSecondAudio /
            (pitchyElapsedMs / (windowCount / DISPLAY_SAMPLES_PER_SECOND))
          : Number.NaN,
    },
  };
}

export async function analyzePitchSample(audioInput = null, tuning = null, options = null) {
  const loaded = await loadAudioSample(audioInput);
  return analyzeDecodedPitchSampleWithComparison(loaded, tuning, options);
}

export function buildWindowDebugObject(result, windowIndex) {
  if (!Number.isInteger(windowIndex) || windowIndex < 0 || windowIndex >= result.timeSec.length) {
    return {
      windowIndex,
      error: "index out of range",
      maxIndex: result.timeSec.length - 1,
    };
  }
  const debug = result.windowDebug[windowIndex] ?? null;
  const selectedPartialBins = Array.isArray(debug?.selectedPartials)
    ? debug.selectedPartials.map((item) => Math.round(item.selectedBin))
    : [];
  const selectedPartials = Array.isArray(debug?.selectedPartials)
    ? debug.selectedPartials.map((item) => ({
        p: item.p,
        targetBin: item.targetBin,
        selectedBin: item.selectedBin,
        refinedPBin: item.refinedPBin,
        weight: item.weight,
        f0FromPBin: item.f0FromPBin,
      }))
    : [];
  const hypotheses = Array.isArray(debug?.hypothesisScores)
    ? [...debug.hypothesisScores]
        .sort((a, b) => b.hypothesisScore - a.hypothesisScore)
        .map((item) => ({
          p: item.p ?? null,
          peak: 1,
          sourcePeakBin: item.sourcePeakBin ?? null,
          f0Hz: item.f0Bin * (debug?.binSizeHz ?? result.binSizeHz),
          hypothesisScore: item.hypothesisScore,
          rawScore: item.rawScore,
        }))
    : [];
  return {
    windowIndex,
    timeSec: result.timeSec[windowIndex],
    predictedHz: result.pitchHz[windowIndex],
    tuning: debug?.tuning ?? null,
    reason: debug?.reason ?? "no debug",
    strongestPeakBin: debug?.strongestPeakBin ?? null,
    strongestPeakHz: debug?.strongestPeakHz ?? null,
    seedPeakBins: debug?.seedPeakBins ?? null,
    bestP: debug?.bestP ?? null,
    bestF0Hz: debug?.bestF0Hz ?? null,
    finalHz: debug?.finalHz ?? null,
    selectedPartialBins,
    selectedPartials,
    hypotheses,
  };
}
