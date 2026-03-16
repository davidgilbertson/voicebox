import { PICA_ACCURACY_CENTS, PICA_SETTINGS_DEFAULTS } from "./config.js";
import { getCentsDifference } from "./utils.js";
import { getPicaWindowSamples } from "./windowing.js";
import { getPicaPitchAnalysisFromWaveform, getPicaSettings } from "./picaPitch.js";

const TIMESTEPS_PER_SECOND = 80;
const VOCAL_SAMPLER_FILE_NAME = "vocal_sampler.wav";
const VOCAL_SAMPLER_ACTUAL_FILE_NAME = "vocal_sampler_actual.json";

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

function getActualAccuracyMetrics(actualPitchHz, fftPitchHz, picaPitchHz) {
  let fftCorrectCount = 0;
  let picaCorrectCount = 0;
  let actualComparedCount = 0;
  if (!actualPitchHz) {
    return {
      fftAccuracy: Number.NaN,
      fftCorrectCount: 0,
      picaAccuracy: Number.NaN,
      picaCorrectCount: 0,
      actualComparedCount: 0,
      picaComparedCount: 0,
    };
  }

  for (let windowIndex = 0; windowIndex < actualPitchHz.length; windowIndex += 1) {
    const actualHz = actualPitchHz[windowIndex];
    if (!Number.isFinite(actualHz)) continue;

    actualComparedCount += 1;
    const fftHz = fftPitchHz?.[windowIndex];
    const picaHz = picaPitchHz[windowIndex];
    if (Number.isFinite(fftHz) && getCentsDifference(fftHz, actualHz) <= PICA_ACCURACY_CENTS) {
      fftCorrectCount += 1;
    }
    if (Number.isFinite(picaHz) && getCentsDifference(picaHz, actualHz) <= PICA_ACCURACY_CENTS) {
      picaCorrectCount += 1;
    }
  }

  return {
    fftAccuracy: actualComparedCount > 0 ? fftCorrectCount / actualComparedCount : Number.NaN,
    fftCorrectCount,
    picaAccuracy: actualComparedCount > 0 ? picaCorrectCount / actualComparedCount : Number.NaN,
    picaCorrectCount,
    actualComparedCount,
    picaComparedCount: actualComparedCount,
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

function getPriorStep(analysis) {
  if (
    !Number.isFinite(analysis?.hz) ||
    !Number.isFinite(analysis?.winningCandidate?.logCorrelation)
  ) {
    return null;
  }
  return {
    hz: analysis.hz,
    logCorrelation: analysis.winningCandidate.logCorrelation,
  };
}

function analyzePitchTrack(timeSec, samples, sampleRate, picaSettings, mode, timestepsPerSecond) {
  const pitchHz = new Array(timeSec.length);
  let priorStep = null;

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < timeSec.length; windowIndex += 1) {
    const picaWindow = getPicaWindowSamples(samples, sampleRate, timeSec[windowIndex]);
    const analysis = getPicaPitchAnalysisFromWaveform(
      picaWindow,
      sampleRate,
      picaSettings,
      mode === "carryForward" ? priorStep : null,
    );
    pitchHz[windowIndex] = analysis.hz;
    priorStep = getPriorStep(analysis);
  }

  const elapsedMs = performance.now() - startMs;
  return {
    pitchHz,
    msPerSecondAudio:
      timeSec.length > 0 ? elapsedMs / (timeSec.length / timestepsPerSecond) : Number.NaN,
  };
}

export async function analyzePreparedPitchSample(
  preparedSample,
  settings = PICA_SETTINGS_DEFAULTS,
) {
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
  const picaTrack = analyzePitchTrack(
    fftAnalysis.timeSec,
    samples,
    sampleRate,
    picaSettings,
    "pica",
    fftAnalysis.samplesPerSecond,
  );
  const carryForwardTrack = analyzePitchTrack(
    fftAnalysis.timeSec,
    samples,
    sampleRate,
    picaSettings,
    "carryForward",
    fftAnalysis.samplesPerSecond,
  );

  const picaMetrics = getActualAccuracyMetrics(
    actualPitchHz,
    fftAnalysis.pitchHz,
    picaTrack.pitchHz,
  );
  const carryForwardMetrics = getPitchAccuracy(actualPitchHz, carryForwardTrack.pitchHz);

  return {
    sampleRate,
    samples,
    timeSec: fftAnalysis.timeSec,
    actualPitchHz,
    pitchHz: fftAnalysis.pitchHz,
    picaPitchHz: picaTrack.pitchHz,
    carryForwardPitchHz: carryForwardTrack.pitchHz,
    picaSettings,
    metrics: {
      ...picaMetrics,
      carryForwardAccuracy: carryForwardMetrics.accuracy,
      carryForwardCorrectCount: carryForwardMetrics.correctCount,
      carryForwardComparedCount: carryForwardMetrics.comparedCount,
    },
    methods: [
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
      carryForwardPipelineMsPerSecondAudio: carryForwardTrack.msPerSecondAudio,
    },
  };
}

export async function analyzePreparedActualPitchSample(
  preparedSample,
  settings = PICA_SETTINGS_DEFAULTS,
) {
  const picaSettings = getPicaSettings(settings);
  const { actualPitchHz, sampleRate, samples } = preparedSample;
  const timeSec = actualPitchHz.map((_, index) => index / TIMESTEPS_PER_SECOND);
  const picaTrack = analyzePitchTrack(
    timeSec,
    samples,
    sampleRate,
    picaSettings,
    "pica",
    TIMESTEPS_PER_SECOND,
  );
  const carryForwardTrack = analyzePitchTrack(
    timeSec,
    samples,
    sampleRate,
    picaSettings,
    "carryForward",
    TIMESTEPS_PER_SECOND,
  );
  const carryForwardMetrics = getPitchAccuracy(actualPitchHz, carryForwardTrack.pitchHz);

  return {
    sampleRate,
    samples,
    timeSec,
    actualPitchHz,
    pitchHz: new Array(timeSec.length).fill(Number.NaN),
    picaPitchHz: picaTrack.pitchHz,
    carryForwardPitchHz: carryForwardTrack.pitchHz,
    picaSettings,
    metrics: {
      ...getActualAccuracyMetrics(actualPitchHz, null, picaTrack.pitchHz),
      carryForwardAccuracy: carryForwardMetrics.accuracy,
      carryForwardCorrectCount: carryForwardMetrics.correctCount,
      carryForwardComparedCount: carryForwardMetrics.comparedCount,
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
        "Carry Forward",
        "carryForward",
        carryForwardTrack.pitchHz,
        carryForwardTrack.msPerSecondAudio,
      ),
    ],
    perf: {
      voiceboxPipelineMsPerSecondAudio: Number.NaN,
      picaPipelineMsPerSecondAudio: picaTrack.msPerSecondAudio,
      carryForwardPipelineMsPerSecondAudio: carryForwardTrack.msPerSecondAudio,
    },
  };
}
