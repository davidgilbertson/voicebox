import { PICA_ACCURACY_CENTS, PICA_SETTINGS_DEFAULTS } from "./config.js";
import { getCentsDifference } from "./utils.js";
import { getPicaWindowSamples } from "./windowing.js";
import { getPicaPitchAnalysisFromWaveform, getPicaSettings } from "./picaPitch.js";
import { analyzePitchyTrack } from "./pitchyPitch.js";

const TIMESTEPS_PER_SECOND = 80;
const VOCAL_SAMPLER_FILE_NAME = "vocal_sampler.wav";
const VOCAL_SAMPLER_ACTUAL_FILE_NAME = "vocal_sampler_actual.json";
const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];
const ANCHOR_MAX_DIFF_CENTS = 400;
const OCTAVE_OUTLIER_CENTS_THRESHOLD = 1000;

function createResolvedPitchMethod(label, key, pitchHz, msPerSecondAudio) {
  return {
    label,
    key,
    pitchHz,
    msPerSecondAudio,
  };
}

function createAccuracySummary(accuracy, correctCount, comparedCount) {
  return {
    accuracy,
    correctCount,
    comparedCount,
  };
}

function createAccuracySummaryByMethod(actualPitchHz, tracksByMethodKey) {
  return Object.fromEntries(
    Object.entries(tracksByMethodKey).map(([methodKey, predictedPitchHz]) => [
      methodKey,
      getPitchAccuracy(actualPitchHz, predictedPitchHz),
    ]),
  );
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

function normalizeActualPitchHzLength(actualPitchHz, targetLength) {
  if (!Array.isArray(actualPitchHz) || actualPitchHz.length === targetLength) {
    return actualPitchHz;
  }
  if (actualPitchHz.length > targetLength) {
    return actualPitchHz.slice(0, targetLength);
  }
  return actualPitchHz.concat(new Array(targetLength - actualPitchHz.length).fill(null));
}

export async function loadPitchSample(audioInput) {
  const { analyzeDecodedPitchSample, loadAudioSample } =
    await import("../pitchDetection/analysis.js");
  const loaded = await loadAudioSample(audioInput);
  const fftAnalysis = await analyzeDecodedPitchSample(loaded);
  const actualPitchHz = normalizeActualPitchHzLength(
    await loadActualPitchHz(audioInput),
    fftAnalysis.timeSec.length,
  );
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

function getPitchAccuracy(actualPitchHz, predictedPitchHz) {
  let correctCount = 0;
  let comparedCount = 0;
  if (!actualPitchHz) {
    return createAccuracySummary(Number.NaN, 0, 0);
  }

  for (let windowIndex = 0; windowIndex < actualPitchHz.length; windowIndex += 1) {
    const actualHz = actualPitchHz[windowIndex];
    if (!Number.isFinite(actualHz)) continue;
    comparedCount += 1;

    const predictedHz = predictedPitchHz[windowIndex];
    if (
      Number.isFinite(predictedHz) &&
      getCentsDifference(predictedHz, actualHz) <= PICA_ACCURACY_CENTS
    ) {
      correctCount += 1;
    }
  }

  return createAccuracySummary(
    comparedCount > 0 ? correctCount / comparedCount : Number.NaN,
    correctCount,
    comparedCount,
  );
}

function hzToCents(hz) {
  return hz > 0 ? 1200 * Math.log2(hz / 440) + 6900 : Number.NaN;
}

function centsToHz(cents) {
  return Number.isFinite(cents) ? 440 * Math.pow(2, (cents - 6900) / 1200) : Number.NaN;
}

function postProcessPitchTrack(pitchHz) {
  const rawPitchCents = pitchHz.map(hzToCents);
  const smoothedPitchCents = [...rawPitchCents];

  for (let index = 0; index < rawPitchCents.length; index += 1) {
    if (index >= 4) {
      const leftAnchorCents = rawPitchCents[index - 4];
      const rightAnchorCents = rawPitchCents[index];
      const centerCents = rawPitchCents[index - 2];
      if (
        Number.isFinite(leftAnchorCents) &&
        Number.isFinite(rightAnchorCents) &&
        Number.isFinite(centerCents) &&
        Math.abs(leftAnchorCents - rightAnchorCents) <= ANCHOR_MAX_DIFF_CENTS
      ) {
        const anchorMeanCents = (leftAnchorCents + rightAnchorCents) / 2;
        if (Math.abs(centerCents - anchorMeanCents) > OCTAVE_OUTLIER_CENTS_THRESHOLD) {
          rawPitchCents[index - 2] = anchorMeanCents;
          smoothedPitchCents[index - 2] = anchorMeanCents;
        }
      }
    }

    if (index >= SMOOTH_RADIUS * 2) {
      let smoothed = 0;
      let hasGap = false;
      for (let offset = -SMOOTH_RADIUS; offset <= SMOOTH_RADIUS; offset += 1) {
        const sample = rawPitchCents[index - SMOOTH_RADIUS + offset];
        if (!Number.isFinite(sample)) {
          hasGap = true;
          break;
        }
        smoothed += sample * SMOOTH_KERNEL[offset + SMOOTH_RADIUS];
      }
      if (!hasGap) {
        smoothedPitchCents[index - SMOOTH_RADIUS] = smoothed;
      }
    }
  }

  return smoothedPitchCents.map(centsToHz);
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
  };
}

function getMethodVisibility(methodVisibility = {}) {
  if (typeof methodVisibility === "boolean") {
    return {
      pitchy: methodVisibility,
      fft: true,
      pica: true,
      carryForward: true,
    };
  }
  return {
    pitchy: methodVisibility.pitchy !== false,
    fft: methodVisibility.fft !== false,
    pica: methodVisibility.pica !== false,
    carryForward: methodVisibility.carryForward !== false,
  };
}

function analyzePitchTrack(timeSec, samples, sampleRate, picaSettings, mode, timestepsPerSecond) {
  const pitchHz = new Array(timeSec.length);
  const correlation = new Array(timeSec.length);
  const priorStepByWindow = new Array(timeSec.length);
  let priorStep = null;

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < timeSec.length; windowIndex += 1) {
    priorStepByWindow[windowIndex] = priorStep ? { ...priorStep } : null;
    const picaWindow = getPicaWindowSamples(samples, sampleRate, timeSec[windowIndex]);
    const analysis = getPicaPitchAnalysisFromWaveform(
      picaWindow,
      sampleRate,
      picaSettings,
      mode === "carryForward" ? priorStep : null,
    );
    pitchHz[windowIndex] = analysis.hz;
    correlation[windowIndex] = analysis.winningCandidate?.correlation ?? Number.NaN;
    priorStep = getPriorStep(analysis, priorStep);
  }

  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz,
    correlation,
    priorStepByWindow,
    // pitchHz: postProcessPitchTrack(pitchHz),
    msPerSecondAudio:
      timeSec.length > 0 ? elapsedMs / (timeSec.length / timestepsPerSecond) : Number.NaN,
  };
}

export async function analyzePreparedPitchSample(
  preparedSample,
  settings = PICA_SETTINGS_DEFAULTS,
  methodVisibility = {},
) {
  const visibleMethods = getMethodVisibility(methodVisibility);
  const picaSettings = getPicaSettings(settings);
  const { actualPitchHz, fftAnalysis, sampleRate, samples } = preparedSample;
  console.assert(
    actualPitchHz === null || actualPitchHz.length === fftAnalysis.timeSec.length,
    "Expected actualPitchHz JSON length to match fftAnalysis.timeSec length",
    {
      actualPitchHzLength: actualPitchHz?.length ?? null,
      timeSecLength: fftAnalysis.timeSec.length,
    },
  );
  const emptyTrack = {
    pitchHz: new Array(fftAnalysis.timeSec.length).fill(Number.NaN),
    correlation: new Array(fftAnalysis.timeSec.length).fill(Number.NaN),
    priorStepByWindow: new Array(fftAnalysis.timeSec.length).fill(null),
    msPerSecondAudio: Number.NaN,
  };
  const picaTrack = visibleMethods.pica
    ? analyzePitchTrack(
        fftAnalysis.timeSec,
        samples,
        sampleRate,
        picaSettings,
        "pica",
        fftAnalysis.samplesPerSecond,
      )
    : emptyTrack;
  const carryForwardTrack = visibleMethods.carryForward
    ? analyzePitchTrack(
        fftAnalysis.timeSec,
        samples,
        sampleRate,
        picaSettings,
        "carryForward",
        fftAnalysis.samplesPerSecond,
      )
    : emptyTrack;
  const rawPitchyTrack = visibleMethods.pitchy
    ? await analyzePitchyTrack(
        fftAnalysis.timeSec,
        samples,
        sampleRate,
        fftAnalysis.samplesPerSecond,
      )
    : emptyTrack;
  const pitchyTrack = visibleMethods.pitchy
    ? {
        ...rawPitchyTrack,
        pitchHz: postProcessPitchTrack(rawPitchyTrack.pitchHz),
      }
    : emptyTrack;

  const accuracyByMethodKey = createAccuracySummaryByMethod(actualPitchHz, {
    fft: fftAnalysis.pitchHz,
    pica: picaTrack.pitchHz,
    pitchy: pitchyTrack.pitchHz,
    carryForward: carryForwardTrack.pitchHz,
  });

  return {
    sampleRate,
    samples,
    timeSec: fftAnalysis.timeSec,
    actualPitchHz,
    pitchHz: fftAnalysis.pitchHz,
    picaPitchHz: picaTrack.pitchHz,
    picaCorrelation: picaTrack.correlation,
    pitchyPitchHz: pitchyTrack.pitchHz,
    carryForwardPitchHz: carryForwardTrack.pitchHz,
    carryForwardCorrelation: carryForwardTrack.correlation,
    carryForwardPriorStepByWindow: carryForwardTrack.priorStepByWindow,
    picaSettings,
    metrics: {
      accuracyByMethodKey,
    },
    methods: [
      createResolvedPitchMethod(
        "Pitchy",
        "pitchy",
        pitchyTrack.pitchHz,
        pitchyTrack.msPerSecondAudio,
      ),
      createResolvedPitchMethod(
        "Voicebox FFT",
        "fft",
        fftAnalysis.pitchHz,
        fftAnalysis.perf.voiceboxPipelineMsPerSecondAudio,
      ),
      createResolvedPitchMethod(
        "Voicebox Pica",
        "pica",
        picaTrack.pitchHz,
        picaTrack.msPerSecondAudio,
      ),
      createResolvedPitchMethod(
        "Carry Forward",
        "carryForward",
        carryForwardTrack.pitchHz,
        carryForwardTrack.msPerSecondAudio,
      ),
    ],
    perf: {
      voiceboxPipelineMsPerSecondAudio: fftAnalysis.perf.voiceboxPipelineMsPerSecondAudio,
      picaPipelineMsPerSecondAudio: picaTrack.msPerSecondAudio,
      pitchyPipelineMsPerSecondAudio: pitchyTrack.msPerSecondAudio,
      carryForwardPipelineMsPerSecondAudio: carryForwardTrack.msPerSecondAudio,
    },
  };
}

export async function analyzePreparedActualPitchSample(
  preparedSample,
  settings = PICA_SETTINGS_DEFAULTS,
  methodVisibility = {},
) {
  const visibleMethods = getMethodVisibility(methodVisibility);
  const picaSettings = getPicaSettings(settings);
  const { actualPitchHz, sampleRate, samples } = preparedSample;
  const timeSec = actualPitchHz.map((_, index) => index / TIMESTEPS_PER_SECOND);
  const emptyTrack = {
    pitchHz: new Array(timeSec.length).fill(Number.NaN),
    correlation: new Array(timeSec.length).fill(Number.NaN),
    priorStepByWindow: new Array(timeSec.length).fill(null),
    msPerSecondAudio: Number.NaN,
  };
  const picaTrack = visibleMethods.pica
    ? analyzePitchTrack(timeSec, samples, sampleRate, picaSettings, "pica", TIMESTEPS_PER_SECOND)
    : emptyTrack;
  const carryForwardTrack = visibleMethods.carryForward
    ? analyzePitchTrack(
        timeSec,
        samples,
        sampleRate,
        picaSettings,
        "carryForward",
        TIMESTEPS_PER_SECOND,
      )
    : emptyTrack;
  const rawPitchyTrack = visibleMethods.pitchy
    ? await analyzePitchyTrack(timeSec, samples, sampleRate, TIMESTEPS_PER_SECOND)
    : emptyTrack;
  const pitchyTrack = visibleMethods.pitchy
    ? {
        ...rawPitchyTrack,
        pitchHz: postProcessPitchTrack(rawPitchyTrack.pitchHz),
      }
    : emptyTrack;
  const accuracyByMethodKey = createAccuracySummaryByMethod(actualPitchHz, {
    fft: new Array(timeSec.length).fill(Number.NaN),
    pica: picaTrack.pitchHz,
    pitchy: pitchyTrack.pitchHz,
    carryForward: carryForwardTrack.pitchHz,
  });

  return {
    sampleRate,
    samples,
    timeSec,
    actualPitchHz,
    pitchHz: new Array(timeSec.length).fill(Number.NaN),
    picaPitchHz: picaTrack.pitchHz,
    picaCorrelation: picaTrack.correlation,
    pitchyPitchHz: pitchyTrack.pitchHz,
    carryForwardPitchHz: carryForwardTrack.pitchHz,
    carryForwardCorrelation: carryForwardTrack.correlation,
    carryForwardPriorStepByWindow: carryForwardTrack.priorStepByWindow,
    picaSettings,
    metrics: {
      accuracyByMethodKey,
    },
    methods: [
      createResolvedPitchMethod(
        "Voicebox FFT",
        "fft",
        new Array(timeSec.length).fill(Number.NaN),
        Number.NaN,
      ),
      createResolvedPitchMethod(
        "Voicebox Pica",
        "pica",
        picaTrack.pitchHz,
        picaTrack.msPerSecondAudio,
      ),
      createResolvedPitchMethod(
        "Pitchy",
        "pitchy",
        pitchyTrack.pitchHz,
        pitchyTrack.msPerSecondAudio,
      ),
      createResolvedPitchMethod(
        "Carry Forward",
        "carryForward",
        carryForwardTrack.pitchHz,
        carryForwardTrack.msPerSecondAudio,
      ),
    ],
    perf: {
      voiceboxPipelineMsPerSecondAudio: Number.NaN,
      picaPipelineMsPerSecondAudio: picaTrack.msPerSecondAudio,
      pitchyPipelineMsPerSecondAudio: pitchyTrack.msPerSecondAudio,
      carryForwardPipelineMsPerSecondAudio: carryForwardTrack.msPerSecondAudio,
    },
  };
}
