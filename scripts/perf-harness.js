import fs from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath} from "node:url";
import {
  analyzeAudioWindow,
  analyzeAudioWindowFft,
  createAudioState,
  setupAudioState,
} from "../src/audioSeries.js";
import {
  createAnalysisState,
  createRawAudioBuffer,
  drainRawBuffer,
  enqueueAudioSamples,
} from "../src/audioPipeline.js";
import {createPitchTimeline, writePitchTimeline} from "../src/pitchTimeline.js";
import {estimateTimelineVibratoRateHz} from "../src/vibratoRate.js";
import {createSpectrogramTimeline, writeSpectrogramColumn} from "../src/spectrogramTimeline.js";
import {consumeTimelineElapsed} from "../src/timelineSteps.js";

const ANALYSIS_FFT_SIZE_DEFAULT = 2048;
const SAMPLES_PER_SECOND = 200;
const RAW_BUFFER_SECONDS = 8;
const PITCH_SECONDS = 5;
const CENTER_SECONDS = 1;
const SILENCE_PAUSE_THRESHOLD_MS = 300;
const VIBRATO_RATE_MIN_HZ = 3;
const VIBRATO_RATE_MAX_HZ = 9;
const VIBRATO_ANALYSIS_WINDOW_SECONDS = 0.5;
const VIBRATO_MIN_CONTIGUOUS_SECONDS = 0.4;
const DEFAULT_WORKLET_CHUNK_SIZE = 256;
const SPECTROGRAM_BINS = 4096;
const COMPARE_RANGE_MIN_HZ = 65.40639132514966; // C2
const COMPARE_RANGE_MAX_HZ = 2093.004522404789; // C7

function resolveRepoPath(relativePath) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..", relativePath);
}

function parseWavMono(filePath) {
  const bytes = fs.readFileSync(filePath);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const riff = bytes.toString("ascii", 0, 4);
  const wave = bytes.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Unsupported WAV container: ${filePath}`);
  }

  let offset = 12;
  let format = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        channelCount: view.getUint16(chunkDataOffset + 2, true),
        sampleRate: view.getUint32(chunkDataOffset + 4, true),
        blockAlign: view.getUint16(chunkDataOffset + 12, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = chunkDataOffset + paddedSize;
  }

  if (!format || dataOffset <= 0 || dataSize <= 0) {
    throw new Error(`Incomplete WAV metadata: ${filePath}`);
  }

  const {
    audioFormat,
    sampleRate,
    blockAlign,
    bitsPerSample,
  } = format;
  const frameCount = Math.floor(dataSize / blockAlign);
  const out = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * blockAlign;
    if (audioFormat === 1 && bitsPerSample === 16) {
      out[frame] = view.getInt16(frameOffset, true) / 32768;
      continue;
    }
    if (audioFormat === 1 && bitsPerSample === 32) {
      out[frame] = view.getInt32(frameOffset, true) / 2147483648;
      continue;
    }
    if (audioFormat === 3 && bitsPerSample === 32) {
      out[frame] = view.getFloat32(frameOffset, true);
      continue;
    }
    throw new Error(`Unsupported WAV encoding: format=${audioFormat}, bits=${bitsPerSample}`);
  }

  return {sampleRate, samples: out};
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}

function average(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function buildMockSpectrogramBins(windowSamples, outputBins) {
  const inputLength = windowSamples.length;
  const outputLength = outputBins.length;
  for (let bin = 0; bin < outputLength; bin += 1) {
    const sampleIndex = Math.floor((bin / outputLength) * inputLength);
    const sample = windowSamples[sampleIndex];
    outputBins[bin] = Math.max(0, Math.min(1, Math.abs(sample) * 6));
  }
}

function applyIdentitySpectrogramFilter(inputBins, outputBins) {
  for (let i = 0; i < inputBins.length; i += 1) {
    outputBins[i] = inputBins[i];
  }
}

function analyzePitchWindow({
  pitchAlgorithm,
  audioState,
  windowSamples,
  pitchMinHz,
  pitchMaxHz,
  currentView,
}) {
  if (pitchAlgorithm === "autocorr") {
    return analyzeAudioWindow(audioState, windowSamples, pitchMinHz, pitchMaxHz, {
      adaptiveRange: currentView === "pitch",
    });
  }

  const refinementMode = pitchAlgorithm === "fft_raw" || pitchAlgorithm === "fft_residual"
      ? "off"
      : pitchAlgorithm === "fft_refined_wide"
          ? "wide"
          : "balanced";
  return analyzeAudioWindowFft(audioState, windowSamples, pitchMinHz, pitchMaxHz, {
    refinementMode,
    detector: pitchAlgorithm === "fft_residual" ? "residual" : "hps",
  });
}

function runScenario({
  name,
  samples,
  sampleRate,
  frameRate,
  samplesPerSecond,
  pitchMinHz,
  pitchMaxHz,
  currentView,
  pitchDetectionOnSpectrogram,
  includeSpectrogramWork,
  workletChunkSize,
  pitchAlgorithm,
  analysisFftSize = ANALYSIS_FFT_SIZE_DEFAULT,
}) {
  const audioStateSeed = createAudioState(samplesPerSecond);
  const audioState = setupAudioState(audioStateSeed, {
    context: null,
    source: null,
    stream: null,
    captureNode: null,
    analyser: null,
    sinkGain: null,
    analysisFps: samplesPerSecond,
    centerSeconds: CENTER_SECONDS,
    sampleRate,
  });

  const rawBuffer = createRawAudioBuffer(sampleRate, {
    fftSize: analysisFftSize,
    rawBufferSeconds: RAW_BUFFER_SECONDS,
  });
  const analysisState = createAnalysisState(sampleRate, {
    fftSize: analysisFftSize,
    samplesPerSecond,
  });
  const timeline = createPitchTimeline({
    samplesPerSecond,
    seconds: PITCH_SECONDS,
    silencePauseThresholdMs: SILENCE_PAUSE_THRESHOLD_MS,
    autoPauseOnSilence: true,
    nowMs: 0,
  });
  const spectrogram = createSpectrogramTimeline({
    samplesPerSecond,
    seconds: PITCH_SECONDS,
    binCount: SPECTROGRAM_BINS,
  });
  const spectrogramClock = {writeClockMs: 0, accumulator: 0};
  const normalizedBins = new Float32Array(SPECTROGRAM_BINS);
  const filteredBins = new Float32Array(SPECTROGRAM_BINS);

  const frameTimes = [];
  let sampleCursor = 0;
  let feedAccumulator = 0;
  let didTimelineChange = false;

  const metrics = {
    frames: 0,
    droppedSamples: 0,
    maxRawBufferSize: 0,
    windowsProcessed: 0,
    pitchWindows: 0,
    pitchMs: 0,
    pitchTimelineSteps: 0,
    spectrogramBuildMs: 0,
    spectrogramFilterMs: 0,
    spectrogramWriteMs: 0,
    spectrogramColumns: 0,
    vibratoEstimates: 0,
    vibratoMs: 0,
  };

  const shouldDetectPitch = currentView !== "spectrogram" || pitchDetectionOnSpectrogram;
  const frameSamples = sampleRate / frameRate;
  const startMs = performance.now();

  while (sampleCursor < samples.length || rawBuffer.size > 0) {
    metrics.frames += 1;
    const frameStart = performance.now();

    feedAccumulator += frameSamples;
    let samplesToFeed = Math.floor(feedAccumulator);
    feedAccumulator -= samplesToFeed;
    if (sampleCursor >= samples.length) {
      samplesToFeed = 0;
    }

    while (samplesToFeed > 0 && sampleCursor < samples.length) {
      const chunkLength = Math.min(workletChunkSize, samplesToFeed, samples.length - sampleCursor);
      const chunk = samples.subarray(sampleCursor, sampleCursor + chunkLength);
      metrics.droppedSamples += enqueueAudioSamples(rawBuffer, chunk);
      sampleCursor += chunkLength;
      samplesToFeed -= chunkLength;
      if (rawBuffer.size > metrics.maxRawBufferSize) {
        metrics.maxRawBufferSize = rawBuffer.size;
      }
    }

    didTimelineChange = false;
    metrics.windowsProcessed += drainRawBuffer(rawBuffer, analysisState, (windowSamples, nowMs) => {
      if (includeSpectrogramWork) {
        if (spectrogramClock.writeClockMs <= 0) {
          spectrogramClock.writeClockMs = nowMs;
        } else {
          const elapsedMs = nowMs - spectrogramClock.writeClockMs;
          spectrogramClock.writeClockMs = nowMs;
          const spectrogramStep = consumeTimelineElapsed(
              elapsedMs,
              samplesPerSecond,
              spectrogramClock.accumulator
          );
          spectrogramClock.accumulator = spectrogramStep.accumulator;

          if (spectrogramStep.steps > 0) {
            let t0 = performance.now();
            buildMockSpectrogramBins(windowSamples, normalizedBins);
            metrics.spectrogramBuildMs += performance.now() - t0;

            t0 = performance.now();
            applyIdentitySpectrogramFilter(normalizedBins, filteredBins);
            metrics.spectrogramFilterMs += performance.now() - t0;

            t0 = performance.now();
            writeSpectrogramColumn(spectrogram, filteredBins, spectrogramStep.steps);
            metrics.spectrogramWriteMs += performance.now() - t0;
            metrics.spectrogramColumns += spectrogramStep.steps;
            didTimelineChange = true;
          }
        }
      }

      if (!shouldDetectPitch) {
        timeline.writeClockMs = nowMs;
        timeline.accumulator = 0;
        return;
      }

      const t0 = performance.now();
      const result = analyzePitchWindow({
        pitchAlgorithm,
        audioState,
        windowSamples,
        pitchMinHz,
        pitchMaxHz,
        currentView,
      });
      metrics.pitchMs += performance.now() - t0;
      metrics.pitchWindows += 1;
      if (!result) return;

      const writeResult = writePitchTimeline(timeline, {
        nowMs,
        hasVoice: result.hasVoice,
        cents: result.cents,
      });
      metrics.pitchTimelineSteps += writeResult.steps;
      if (writeResult.steps > 0) {
        didTimelineChange = true;
      }
    });

    if (currentView === "vibrato" && didTimelineChange) {
      const t0 = performance.now();
      estimateTimelineVibratoRateHz({
        values: timeline.values,
        writeIndex: timeline.writeIndex,
        count: timeline.count,
        samplesPerSecond: timeline.samplesPerSecond,
        minRateHz: VIBRATO_RATE_MIN_HZ,
        maxRateHz: VIBRATO_RATE_MAX_HZ,
        analysisWindowSeconds: VIBRATO_ANALYSIS_WINDOW_SECONDS,
        minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
      });
      metrics.vibratoMs += performance.now() - t0;
      metrics.vibratoEstimates += 1;
    }

    frameTimes.push(performance.now() - frameStart);
  }

  const totalMs = performance.now() - startMs;
  const audioSeconds = samples.length / sampleRate;
  const wallSeconds = totalMs / 1000;
  const spectrogramTotalMs = metrics.spectrogramBuildMs + metrics.spectrogramFilterMs + metrics.spectrogramWriteMs;
  const measuredComponentTotalMs = metrics.pitchMs + spectrogramTotalMs + metrics.vibratoMs;
  const frames = Math.max(1, metrics.frames);
  const frameMeanMs = average(frameTimes);

  return {
    name,
    config: {
      frameRate,
      pitchAlgorithm,
      analysisFftSize,
      samplesPerSecond,
      currentView,
      pitchDetectionOnSpectrogram,
      includeSpectrogramWork,
      pitchMinHz,
      pitchMaxHz,
      workletChunkSize,
    },
    audioSeconds,
    wallSeconds,
    realtimeMultiplier: wallSeconds > 0 ? audioSeconds / wallSeconds : 0,
    frame: {
      count: metrics.frames,
      meanMs: frameMeanMs,
      p95Ms: percentile(frameTimes, 95),
      maxMs: percentile(frameTimes, 100),
    },
    metrics: {
      ...metrics,
      spectrogramTotalMs,
      measuredComponentTotalMs,
      meanMsPerFrame: {
        total: frameMeanMs,
        measuredComponents: measuredComponentTotalMs / frames,
        pitch: metrics.pitchMs / frames,
        spectrogram: spectrogramTotalMs / frames,
        vibrato: metrics.vibratoMs / frames,
        other: Math.max(0, frameMeanMs - (measuredComponentTotalMs / frames)),
      },
      pitchMsPerWindow: metrics.pitchWindows > 0 ? metrics.pitchMs / metrics.pitchWindows : 0,
      spectrogramBuildMsPerColumn: metrics.spectrogramColumns > 0
          ? metrics.spectrogramBuildMs / metrics.spectrogramColumns
          : 0,
    },
  };
}

function printScenarioResult(result) {
  console.log(`\n=== ${result.name} ===`);
  console.log(`pitchAlgorithm: ${result.config.pitchAlgorithm}`);
  console.log(`analysisFftSize: ${result.config.analysisFftSize}`);
  console.log(`simulatedFrameRate: ${result.config.frameRate} fps`);
  console.log(`audioSeconds: ${result.audioSeconds.toFixed(3)}`);
  console.log(`wallSeconds: ${result.wallSeconds.toFixed(3)}`);
  console.log(`realtimeMultiplier: ${result.realtimeMultiplier.toFixed(2)}x`);
  console.log(
      `frame(ms): mean=${result.frame.meanMs.toFixed(3)} p95=${result.frame.p95Ms.toFixed(3)} max=${result.frame.maxMs.toFixed(3)}`
  );
  console.log(
      `ms/frame components: total=${result.metrics.meanMsPerFrame.total.toFixed(3)} measured=${result.metrics.meanMsPerFrame.measuredComponents.toFixed(3)} pitch=${result.metrics.meanMsPerFrame.pitch.toFixed(3)} spectrogram=${result.metrics.meanMsPerFrame.spectrogram.toFixed(3)} vibrato=${result.metrics.meanMsPerFrame.vibrato.toFixed(3)} other=${result.metrics.meanMsPerFrame.other.toFixed(3)}`
  );
  console.log(
      `pitch(ms/window): ${result.metrics.pitchMsPerWindow.toFixed(3)} | windows=${result.metrics.pitchWindows}`
  );
}

function main() {
  const inputPath = resolveRepoPath("test/assets/c4_vibrato_6hz_200c.wav");
  const {sampleRate, samples} = parseWavMono(inputPath);

  const scenarios = [
    {
      name: "autocorr-c2c7-200sps-frame60",
      frameRate: 60,
      pitchAlgorithm: "autocorr",
      analysisFftSize: 2048,
      samplesPerSecond: SAMPLES_PER_SECOND,
      pitchMinHz: COMPARE_RANGE_MIN_HZ,
      pitchMaxHz: COMPARE_RANGE_MAX_HZ,
      currentView: "vibrato",
      pitchDetectionOnSpectrogram: true,
      includeSpectrogramWork: true,
      workletChunkSize: DEFAULT_WORKLET_CHUNK_SIZE,
    },
    {
      name: "fftRaw-c2c7-200sps-frame60",
      frameRate: 60,
      pitchAlgorithm: "fft_raw",
      analysisFftSize: 2048,
      samplesPerSecond: SAMPLES_PER_SECOND,
      pitchMinHz: COMPARE_RANGE_MIN_HZ,
      pitchMaxHz: COMPARE_RANGE_MAX_HZ,
      currentView: "vibrato",
      pitchDetectionOnSpectrogram: true,
      includeSpectrogramWork: true,
      workletChunkSize: DEFAULT_WORKLET_CHUNK_SIZE,
    },
    {
      name: "fftRefined-c2c7-200sps-frame60",
      frameRate: 60,
      pitchAlgorithm: "fft_refined",
      analysisFftSize: 2048,
      samplesPerSecond: SAMPLES_PER_SECOND,
      pitchMinHz: COMPARE_RANGE_MIN_HZ,
      pitchMaxHz: COMPARE_RANGE_MAX_HZ,
      currentView: "vibrato",
      pitchDetectionOnSpectrogram: true,
      includeSpectrogramWork: true,
      workletChunkSize: DEFAULT_WORKLET_CHUNK_SIZE,
    },
    {
      name: "fftResidual-c2c7-200sps-frame60",
      frameRate: 60,
      pitchAlgorithm: "fft_residual",
      analysisFftSize: 2048,
      samplesPerSecond: SAMPLES_PER_SECOND,
      pitchMinHz: COMPARE_RANGE_MIN_HZ,
      pitchMaxHz: COMPARE_RANGE_MAX_HZ,
      currentView: "vibrato",
      pitchDetectionOnSpectrogram: true,
      includeSpectrogramWork: true,
      workletChunkSize: DEFAULT_WORKLET_CHUNK_SIZE,
    },
    {
      name: "fftRefinedWide-c2c7-200sps-frame60",
      frameRate: 60,
      pitchAlgorithm: "fft_refined_wide",
      analysisFftSize: 2048,
      samplesPerSecond: SAMPLES_PER_SECOND,
      pitchMinHz: COMPARE_RANGE_MIN_HZ,
      pitchMaxHz: COMPARE_RANGE_MAX_HZ,
      currentView: "vibrato",
      pitchDetectionOnSpectrogram: true,
      includeSpectrogramWork: true,
      workletChunkSize: DEFAULT_WORKLET_CHUNK_SIZE,
    },
  ];

  const results = scenarios.map((scenario) => runScenario({
    ...scenario,
    sampleRate,
    samples,
  }));

  for (const result of results) {
    printScenarioResult(result);
  }

  console.log("\nJSON:");
  console.log(JSON.stringify({inputPath, sampleRate, sampleCount: samples.length, results}, null, 2));
}

main();
