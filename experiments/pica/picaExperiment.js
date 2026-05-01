import { PICA_ACCURACY_CENTS } from "./config.js";
import { postProcessPitchTrack } from "./pitchProcessing.js";
import { getCentsDifference } from "./utils.js";
import { buildWindowSequence, getDetectorWindowSamples, getWindowEndSample } from "./windowing.js";
import { getPicaPitchAnalysisFromWaveform } from "./picaPitch.js";
import { getPipsPitchHzFromWaveform } from "./pipsPitch.js";
import { getPiscPitchHzFromWaveform } from "./piscPitch.js";
import { getPica2PitchAnalysisFromWaveform } from "./pica2Pitch.js";
import { getPifsPitchHzFromWaveform } from "./pifsPitch.js";
import { getPiraPitchHzFromWaveform } from "./piraPitch.js";
import { getPizaPitchAnalysisFromWaveform } from "./pizaPitch.js";
import { analyzePitchyTrack } from "./pitchyPitch.js";
import { getActualPitchData } from "./actualLabels.js";
import { PICA_METHOD_REGISTRY, normalizeSelectedMethods } from "./methodRegistry.js";

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

export async function loadPitchSample(audioInput, selectedMethods = {}) {
  const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
  const { analyzeDecodedPitchSample, loadAudioSample } =
    await import("../pitchDetection/analysis.js");
  const loaded = await loadAudioSample(audioInput);
  const windowSequence = buildWindowSequence(loaded.sampleRate, loaded.samples.length);
  const fftAnalysis = normalizedSelectedMethods.FFT
    ? await analyzeDecodedPitchSample(loaded, null, { timeline: windowSequence })
    : null;
  const { actualPitchHz, baseActualPitchHz } = await getActualPitchData(
    audioInput,
    windowSequence.windowCount,
  );
  return {
    sampleRate: loaded.sampleRate,
    samples: loaded.samples,
    windowSequence,
    timeSec: windowSequence.timeSec,
    actualPitchHz,
    baseActualPitchHz,
    fftAnalysis,
  };
}

export async function ensurePreparedPitchSampleFftAnalysis(preparedSample) {
  if (preparedSample.fftAnalysis) {
    return preparedSample;
  }

  const { analyzeDecodedPitchSample } = await import("../pitchDetection/analysis.js");
  const fftAnalysis = await analyzeDecodedPitchSample(
    {
      sampleRate: preparedSample.sampleRate,
      samples: preparedSample.samples,
    },
    null,
    { timeline: preparedSample.windowSequence },
  );
  preparedSample.fftAnalysis = fftAnalysis;
  return preparedSample;
}

export async function loadActualPitchSample(audioInput) {
  const loaded = await loadWavSamples(audioInput);
  const windowSequence = buildWindowSequence(loaded.sampleRate, loaded.samples.length);
  const { actualPitchHz, baseActualPitchHz } = await getActualPitchData(
    audioInput,
    windowSequence.windowCount,
  );
  return {
    sampleRate: loaded.sampleRate,
    samples: loaded.samples,
    windowSequence,
    timeSec: windowSequence.timeSec,
    actualPitchHz,
    baseActualPitchHz,
  };
}

function getPitchAccuracy(actualPitchHz, predictedPitchHz) {
  let correctCount = 0;
  let comparedCount = 0;
  if (!actualPitchHz) {
    return {
      accuracy: Number.NaN,
      correctCount: 0,
      comparedCount: 0,
    };
  }

  for (let windowIndex = 0; windowIndex < actualPitchHz.length; windowIndex += 1) {
    const actualHz = actualPitchHz[windowIndex];
    const predictedHz = predictedPitchHz[windowIndex];

    if (!Number.isFinite(actualHz)) {
      if (Number.isFinite(predictedHz)) {
        comparedCount += 1;
      }
      continue;
    }

    comparedCount += 1;
    if (
      Number.isFinite(predictedHz) &&
      getCentsDifference(predictedHz, actualHz) <= PICA_ACCURACY_CENTS
    ) {
      correctCount += 1;
    }
  }

  return {
    accuracy: comparedCount > 0 ? correctCount / comparedCount : Number.NaN,
    correctCount,
    comparedCount,
  };
}

function getPriorStep(analysis, priorStep) {
  const hasPrediction =
    Number.isFinite(analysis?.hz) && Number.isFinite(analysis?.winningCandidate?.correlation);

  if (!hasPrediction) {
    return {
      hz: Number.NaN,
      correlation: Number.NaN,
      carryForwardRunLength: 0,
      fullPredictionCountSinceLastNaN: 0,
      suppressedOctaveJumpCount: 0,
    };
  }

  const fullPredictionCountSinceLastNaN =
    analysis.winningCandidate.type === "carryForward"
      ? (priorStep?.fullPredictionCountSinceLastNaN ?? 0)
      : (priorStep?.fullPredictionCountSinceLastNaN ?? 0) + 1;

  return {
    hz: analysis.hz,
    correlation: analysis.winningCandidate.correlation,
    carryForwardRunLength:
      analysis.winningCandidate.type === "carryForward"
        ? (priorStep?.carryForwardRunLength ?? 0) + 1
        : 0,
    fullPredictionCountSinceLastNaN,
    suppressedOctaveJumpCount: analysis.suppressedOctaveJumpCount ?? 0,
  };
}

function getMsPerSecondAudio(elapsedMs, timestepsPerSecond, sampleCount) {
  return sampleCount > 0 ? elapsedMs / (sampleCount / timestepsPerSecond) : Number.NaN;
}

function maybePostProcessPitchTrack(pitchHz, postProcessingEnabled) {
  return postProcessingEnabled ? postProcessPitchTrack(pitchHz) : pitchHz;
}

function timePostProcessPitchTrack(pitchHz, timestepsPerSecond, postProcessingEnabled) {
  const startMs = performance.now();
  const processedPitchHz = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedPitchHz,
    msPerSecondAudio: getMsPerSecondAudio(elapsedMs, timestepsPerSecond, pitchHz.length),
  };
}

function createEmptyTrack(length) {
  return {
    pitchHz: new Array(length).fill(Number.NaN),
    correlation: new Array(length).fill(Number.NaN),
    zeroCrossingDensity: new Array(length).fill(Number.NaN),
    priorStepByWindow: new Array(length).fill(null),
    msPerSecondAudio: Number.NaN,
  };
}

function analyzePicaTrack(
  windowSequence,
  samples,
  sampleRate,
  settings,
  mode,
  postProcessingEnabled,
) {
  const pitchHz = new Array(windowSequence.windowCount);
  const correlation = new Array(windowSequence.windowCount);
  const zeroCrossingDensity = new Array(windowSequence.windowCount);
  const priorStepByWindow = new Array(windowSequence.windowCount);
  let priorStep = null;

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      correlation[windowIndex] = Number.NaN;
      zeroCrossingDensity[windowIndex] = Number.NaN;
      continue;
    }
    priorStepByWindow[windowIndex] = priorStep ? { ...priorStep } : null;
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    const analysis = getPicaPitchAnalysisFromWaveform(
      detectorWindow,
      sampleRate,
      settings,
      mode === "carryForward" ? priorStep : null,
    );
    pitchHz[windowIndex] = analysis.hz;
    correlation[windowIndex] = analysis.winningCandidate?.correlation ?? Number.NaN;
    zeroCrossingDensity[windowIndex] = analysis.foldExtrema.zeroCrossingDensity;
    priorStep = getPriorStep(analysis, priorStep);
  }

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    correlation,
    zeroCrossingDensity,
    priorStepByWindow,
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

function analyzePizaTrack(windowSequence, samples, sampleRate, settings, postProcessingEnabled) {
  const pitchHz = new Array(windowSequence.windowCount);

  window.pizaDebug.foldAnalyses = new Array(windowSequence.windowCount);
  window.pizaDebug.activeWindowIndex = null;
  window.pizaDebug.recordFoldDebug = true;

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }
    window.pizaDebug.activeWindowIndex = windowIndex;
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    const analysis = getPizaPitchAnalysisFromWaveform(detectorWindow, sampleRate, settings);
    pitchHz[windowIndex] = analysis.hz;
  }

  window.pizaDebug.activeWindowIndex = null;
  window.pizaDebug.recordFoldDebug = false;

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    correlation: new Array(windowSequence.windowCount).fill(Number.NaN),
    zeroCrossingDensity: new Array(windowSequence.windowCount).fill(Number.NaN),
    priorStepByWindow: new Array(windowSequence.windowCount).fill(null),
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

function analyzePica2Track(windowSequence, samples, sampleRate, settings, postProcessingEnabled) {
  const pitchHz = new Array(windowSequence.windowCount);

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    const analysis = getPica2PitchAnalysisFromWaveform(detectorWindow, sampleRate, settings);
    pitchHz[windowIndex] = analysis.hz;
  }

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    correlation: new Array(windowSequence.windowCount).fill(Number.NaN),
    zeroCrossingDensity: new Array(windowSequence.windowCount).fill(Number.NaN),
    priorStepByWindow: new Array(windowSequence.windowCount).fill(null),
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

function analyzePiraTrack(windowSequence, samples, sampleRate, settings, postProcessingEnabled) {
  const pitchHz = new Array(windowSequence.windowCount);

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }
    window.windowIndex = windowIndex;
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    pitchHz[windowIndex] = getPiraPitchHzFromWaveform(detectorWindow, sampleRate, settings);
  }

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    correlation: new Array(windowSequence.windowCount).fill(Number.NaN),
    zeroCrossingDensity: new Array(windowSequence.windowCount).fill(Number.NaN),
    priorStepByWindow: new Array(windowSequence.windowCount).fill(null),
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

function analyzePipsTrack(windowSequence, samples, sampleRate, settings, postProcessingEnabled) {
  const pitchHz = new Array(windowSequence.windowCount);

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    pitchHz[windowIndex] = getPipsPitchHzFromWaveform(detectorWindow, sampleRate, settings);
  }

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    correlation: new Array(windowSequence.windowCount).fill(Number.NaN),
    zeroCrossingDensity: new Array(windowSequence.windowCount).fill(Number.NaN),
    priorStepByWindow: new Array(windowSequence.windowCount).fill(null),
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

function analyzePiscTrack(windowSequence, samples, sampleRate, settings, postProcessingEnabled) {
  const pitchHz = new Array(windowSequence.windowCount);
  const correlation = new Array(windowSequence.windowCount);

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      correlation[windowIndex] = Number.NaN;
      continue;
    }
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    pitchHz[windowIndex] = getPiscPitchHzFromWaveform(detectorWindow, sampleRate, settings);
    correlation[windowIndex] = window.piscDebug.winningCorrelation;
  }

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    correlation,
    zeroCrossingDensity: new Array(windowSequence.windowCount).fill(Number.NaN),
    priorStepByWindow: new Array(windowSequence.windowCount).fill(null),
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

function analyzePifsTrack(windowSequence, samples, sampleRate, settings, postProcessingEnabled) {
  const pitchHz = new Array(windowSequence.windowCount);
  const foldScenario = new Array(windowSequence.windowCount);

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      foldScenario[windowIndex] = Number.NaN;
      continue;
    }
    window.windowIndex = windowIndex;
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    pitchHz[windowIndex] = getPifsPitchHzFromWaveform(detectorWindow, sampleRate, settings);
    foldScenario[windowIndex] = window.pifsDebug.foldScenario;
  }

  const processedTrack = maybePostProcessPitchTrack(pitchHz, postProcessingEnabled);
  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz: processedTrack,
    foldScenario,
    correlation: new Array(windowSequence.windowCount).fill(Number.NaN),
    zeroCrossingDensity: new Array(windowSequence.windowCount).fill(Number.NaN),
    priorStepByWindow: new Array(windowSequence.windowCount).fill(null),
    msPerSecondAudio: getMsPerSecondAudio(
      elapsedMs,
      windowSequence.windowsPerSecond,
      windowSequence.windowCount,
    ),
  };
}

export async function analyzePreparedPitchSample(preparedSample, settings, selectedMethods = {}) {
  const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
  const { actualPitchHz, fftAnalysis, sampleRate, samples, windowSequence } = preparedSample;
  const { timeSec } = windowSequence;
  console.assert(
    actualPitchHz === null || actualPitchHz.length === timeSec.length,
    "Expected actualPitchHz JSON length to match the shared window sequence length",
    {
      actualPitchHzLength: actualPitchHz?.length ?? null,
      timeSecLength: timeSec.length,
    },
  );
  const emptyTrack = createEmptyTrack(timeSec.length);
  const processedFftTrack =
    normalizedSelectedMethods.FFT && fftAnalysis
      ? timePostProcessPitchTrack(
          fftAnalysis.pitchHz,
          windowSequence.windowsPerSecond,
          settings.postProcessingEnabled !== false,
        )
      : emptyTrack;
  const fftPipelineMsPerSecondAudio =
    normalizedSelectedMethods.FFT && fftAnalysis
      ? fftAnalysis.perf.voiceboxPipelineMsPerSecondAudio + processedFftTrack.msPerSecondAudio
      : Number.NaN;
  window.pizaDebug.foldAnalyses = new Array(timeSec.length);
  window.pizaDebug.activeWindowIndex = null;
  window.pizaDebug.recordFoldDebug = false;
  const tracksByMethodKey = {};
  tracksByMethodKey.FFT = processedFftTrack;
  tracksByMethodKey.PICA = normalizedSelectedMethods.PICA
    ? analyzePicaTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        "pica",
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIZA = normalizedSelectedMethods.PIZA
    ? analyzePizaTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PICA2 = normalizedSelectedMethods.PICA2
    ? analyzePica2Track(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIRA = normalizedSelectedMethods.PIRA
    ? analyzePiraTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIFS = normalizedSelectedMethods.PIFS
    ? analyzePifsTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIPS = normalizedSelectedMethods.PIPS
    ? analyzePipsTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PISC = normalizedSelectedMethods.PISC
    ? analyzePiscTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PICACF = normalizedSelectedMethods.PICACF
    ? analyzePicaTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        "carryForward",
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PITCHY = normalizedSelectedMethods.PITCHY
    ? await analyzePitchyTrack(windowSequence, samples, sampleRate)
    : emptyTrack;
  const accuracyByMethodKey = Object.fromEntries(
    PICA_METHOD_REGISTRY.map((method) => [
      method.key,
      getPitchAccuracy(actualPitchHz, tracksByMethodKey[method.key].pitchHz),
    ]),
  );
  const methods = PICA_METHOD_REGISTRY.map((method) => ({
    key: method.key,
    label: method.key,
    pitchHz: tracksByMethodKey[method.key].pitchHz,
    msPerSecondAudio:
      method.key === "FFT"
        ? fftPipelineMsPerSecondAudio
        : tracksByMethodKey[method.key].msPerSecondAudio,
  }));
  const perf = Object.fromEntries(
    PICA_METHOD_REGISTRY.map((method) => [
      method.perfKey,
      method.key === "FFT"
        ? fftPipelineMsPerSecondAudio
        : tracksByMethodKey[method.key].msPerSecondAudio,
    ]),
  );
  return {
    sampleRate,
    samples,
    windowSequence,
    timeSec,
    actualPitchHz,
    ...Object.fromEntries(
      PICA_METHOD_REGISTRY.map((method) => [
        method.resultKey,
        tracksByMethodKey[method.key].pitchHz,
      ]),
    ),
    picaCorrelation: tracksByMethodKey.PICA.correlation,
    piscCorrelation: tracksByMethodKey.PISC.correlation,
    picaZeroCrossingDensity: tracksByMethodKey.PICA.zeroCrossingDensity,
    picaFoldCount: new Array(timeSec.length).fill(Number.NaN),
    pifsFoldScenario: tracksByMethodKey.PIFS.foldScenario,
    picaCfCorrelation: tracksByMethodKey.PICACF.correlation,
    picaCfZeroCrossingDensity: tracksByMethodKey.PICACF.zeroCrossingDensity,
    picaCfPriorStepByWindow: tracksByMethodKey.PICACF.priorStepByWindow,
    settings,
    metrics: {
      accuracyByMethodKey,
    },
    methods,
    perf,
  };
}

export async function analyzePreparedActualPitchSample(
  preparedSample,
  settings,
  selectedMethods = {},
) {
  const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
  const { actualPitchHz, sampleRate, samples, windowSequence } = preparedSample;
  const { timeSec } = windowSequence;
  const emptyTrack = createEmptyTrack(timeSec.length);
  window.pizaDebug.foldAnalyses = new Array(timeSec.length);
  window.pizaDebug.activeWindowIndex = null;
  window.pizaDebug.recordFoldDebug = false;
  const tracksByMethodKey = {};
  tracksByMethodKey.FFT = emptyTrack;
  tracksByMethodKey.PICA = normalizedSelectedMethods.PICA
    ? analyzePicaTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        "pica",
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIZA = normalizedSelectedMethods.PIZA
    ? analyzePizaTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PICA2 = normalizedSelectedMethods.PICA2
    ? analyzePica2Track(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIRA = normalizedSelectedMethods.PIRA
    ? analyzePiraTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIFS = normalizedSelectedMethods.PIFS
    ? analyzePifsTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PIPS = normalizedSelectedMethods.PIPS
    ? analyzePipsTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PISC = normalizedSelectedMethods.PISC
    ? analyzePiscTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PICACF = normalizedSelectedMethods.PICACF
    ? analyzePicaTrack(
        windowSequence,
        samples,
        sampleRate,
        settings,
        "carryForward",
        settings.postProcessingEnabled !== false,
      )
    : emptyTrack;
  tracksByMethodKey.PITCHY = normalizedSelectedMethods.PITCHY
    ? await analyzePitchyTrack(windowSequence, samples, sampleRate)
    : emptyTrack;
  const accuracyByMethodKey = Object.fromEntries(
    PICA_METHOD_REGISTRY.map((method) => [
      method.key,
      getPitchAccuracy(actualPitchHz, tracksByMethodKey[method.key].pitchHz),
    ]),
  );
  const methods = PICA_METHOD_REGISTRY.map((method) => ({
    key: method.key,
    label: method.key,
    pitchHz: tracksByMethodKey[method.key].pitchHz,
    msPerSecondAudio:
      method.key === "FFT" ? Number.NaN : tracksByMethodKey[method.key].msPerSecondAudio,
  }));
  const perf = Object.fromEntries(
    PICA_METHOD_REGISTRY.map((method) => [
      method.perfKey,
      method.key === "FFT" ? Number.NaN : tracksByMethodKey[method.key].msPerSecondAudio,
    ]),
  );
  return {
    sampleRate,
    samples,
    windowSequence,
    timeSec,
    actualPitchHz,
    ...Object.fromEntries(
      PICA_METHOD_REGISTRY.map((method) => [
        method.resultKey,
        tracksByMethodKey[method.key].pitchHz,
      ]),
    ),
    picaCorrelation: tracksByMethodKey.PICA.correlation,
    piscCorrelation: tracksByMethodKey.PISC.correlation,
    picaZeroCrossingDensity: tracksByMethodKey.PICA.zeroCrossingDensity,
    picaFoldCount: new Array(timeSec.length).fill(Number.NaN),
    pifsFoldScenario: tracksByMethodKey.PIFS.foldScenario,
    picaCfCorrelation: tracksByMethodKey.PICACF.correlation,
    picaCfZeroCrossingDensity: tracksByMethodKey.PICACF.zeroCrossingDensity,
    picaCfPriorStepByWindow: tracksByMethodKey.PICACF.priorStepByWindow,
    settings,
    metrics: {
      accuracyByMethodKey,
    },
    methods,
    perf,
  };
}
