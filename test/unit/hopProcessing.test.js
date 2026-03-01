import {expect, test} from "vitest";
import {createPitchProcessingState} from "../../src/Recorder/pitchProcessing.js";
import {
  applyNoiseProfileToSpectrum,
  createHighResSpectrogramBuffers,
  createSpectrogramBuffers,
  processOneAudioHop,
} from "../../src/Recorder/hopProcessing.js";

function createAnalyserWithSpectrum(spectrumDb, {minDecibels = -100, maxDecibels = -20} = {}) {
  return {
    frequencyBinCount: spectrumDb.length,
    minDecibels,
    maxDecibels,
    getFloatFrequencyData(target) {
      target.set(spectrumDb);
    },
  };
}

test("processOneAudioHop does not write pitch history when silence gating pauses immediately", () => {
  const processingState = createPitchProcessingState({
    columnRateHz: 80,
    seconds: 2,
    silencePauseStepThreshold: 1,
  });
  const spectrogramBuffers = createSpectrogramBuffers(4);
  const audioSessionState = {
    analyser: createAnalyserWithSpectrum(new Float32Array([-40, -45, -50, -55])),
    sampleRate: 48000,
    hzBuffer: new Float32Array(16),
    hzIndex: 0,
  };
  const result = processOneAudioHop({
    engineState: {
      activeView: "pitch",
      pitchRange: {minHz: 80, maxHz: 1200},
      spectrogramRange: {minHz: 80, maxHz: 1200},
      signalLevel: 0.001,
      minSignalThreshold: 0.015,
      signalTracking: {maxHeardSignalLevel: 0.2},
      lineStrengthEma: 0,
      autoPauseOnSilence: true,
      skipNextSpectrumFrame: false,
    },
    hopState: {
      processingState,
      audioSessionState,
      spectrogramNoiseState: {profile: null, calibrating: false, sumBins: null, sampleCount: 0},
      spectrogramBuffers,
    },
  });

  expect(result.didFrameDataChange).toBe(false);
  expect(result.spectrogramColumn).toBeNull();
  expect(processingState.rawPitchCentsRing.sampleCount).toBe(0);
});

test("processOneAudioHop writes one pitch-history step for valid signal and returns spectrogram column", () => {
  const processingState = createPitchProcessingState({
    columnRateHz: 80,
    seconds: 2,
    silencePauseStepThreshold: 4,
  });
  const spectrogramBuffers = createSpectrogramBuffers(4);
  const audioSessionState = {
    analyser: createAnalyserWithSpectrum(new Float32Array([-40, -45, -50, -55])),
    sampleRate: 48000,
    hzBuffer: new Float32Array(16),
    hzIndex: 0,
  };
  const result = processOneAudioHop({
    engineState: {
      activeView: "pitch",
      pitchRange: {minHz: 80, maxHz: 1200},
      spectrogramRange: {minHz: 80, maxHz: 1200},
      signalLevel: 0.25,
      minSignalThreshold: 0.015,
      signalTracking: {maxHeardSignalLevel: 0.1},
      lineStrengthEma: 0,
      autoPauseOnSilence: true,
      skipNextSpectrumFrame: false,
    },
    hopState: {
      processingState,
      audioSessionState,
      spectrogramNoiseState: {profile: null, calibrating: false, sumBins: null, sampleCount: 0},
      spectrogramBuffers,
    },
  });

  expect(result.didFrameDataChange).toBe(true);
  expect(result.spectrogramColumn).toBeInstanceOf(Float32Array);
  expect(result.shouldPersistMaxSignalLevel).toBe(true);
  expect(processingState.rawPitchCentsRing.sampleCount).toBe(1);
});

test("processOneAudioHop uses pitch range for detection even on spectrogram view", () => {
  const processingState = createPitchProcessingState({
    columnRateHz: 80,
    seconds: 2,
    silencePauseStepThreshold: 4,
  });
  const spectrumDb = new Float32Array(512);
  spectrumDb.fill(-100);
  spectrumDb[8] = -80;
  spectrumDb[9] = -20;
  spectrumDb[10] = -80;
  const spectrogramBuffers = createSpectrogramBuffers(spectrumDb.length);
  const audioSessionState = {
    analyser: createAnalyserWithSpectrum(spectrumDb),
    sampleRate: 48000,
    hzBuffer: new Float32Array(16),
    hzIndex: 0,
  };

  processOneAudioHop({
    engineState: {
      activeView: "spectrogram",
      pitchRange: {minHz: 380, maxHz: 500},
      spectrogramRange: {minHz: 700, maxHz: 900},
      signalLevel: 0.25,
      minSignalThreshold: 0.015,
      signalTracking: {maxHeardSignalLevel: 0.1},
      lineStrengthEma: 0,
      autoPauseOnSilence: true,
      skipNextSpectrumFrame: false,
    },
    hopState: {
      processingState,
      audioSessionState,
      spectrogramNoiseState: {profile: null, calibrating: false, sumBins: null, sampleCount: 0},
      spectrogramBuffers,
    },
  });

  expect(Number.isFinite(processingState.rawPitchCentsRing.newest())).toBe(true);
});

test("applyNoiseProfileToSpectrum clamps filtered values at zero", () => {
  const spectrogramNoiseState = {
    profile: new Float32Array([0.9]),
    calibrating: false,
    sumBins: null,
    sampleCount: 0,
  };
  const spectrogramBuffers = {
    spectrumFiltered: new Float32Array(1),
  };
  const {spectrumFiltered} = applyNoiseProfileToSpectrum({
    spectrumNormalized: new Float32Array([0.1]),
    spectrogramNoiseState,
    spectrogramBuffers,
  });
  expect(spectrumFiltered[0]).toBe(0);
});

test("processOneAudioHop can use separate analysers for pitch and spectrogram paths", () => {
  const processingState = createPitchProcessingState({
    columnRateHz: 80,
    seconds: 2,
    silencePauseStepThreshold: 4,
  });
  const pitchSpectrumDb = new Float32Array(512);
  pitchSpectrumDb.fill(-100);
  pitchSpectrumDb[8] = -80;
  pitchSpectrumDb[9] = -20;
  pitchSpectrumDb[10] = -80;
  const spectrogramSpectrumDb = new Float32Array([-40, -45, -50, -55]);
  const audioSessionState = {
    analyser: createAnalyserWithSpectrum(pitchSpectrumDb),
    highResAnalyser: createAnalyserWithSpectrum(spectrogramSpectrumDb),
    sampleRate: 48000,
    hzBuffer: new Float32Array(16),
    hzIndex: 0,
  };

  const result = processOneAudioHop({
    engineState: {
      activeView: "spectrogram",
      pitchRange: {minHz: 380, maxHz: 500},
      spectrogramRange: {minHz: 80, maxHz: 1200},
      signalLevel: 0.25,
      minSignalThreshold: 0.015,
      signalTracking: {maxHeardSignalLevel: 0.1},
      lineStrengthEma: 0,
      autoPauseOnSilence: true,
      skipNextSpectrumFrame: false,
    },
    hopState: {
      processingState,
      audioSessionState,
      spectrogramNoiseState: {profile: null, calibrating: false, sumBins: null, sampleCount: 0},
      spectrogramBuffers: createSpectrogramBuffers(pitchSpectrumDb.length),
      highResSpectrogramBuffers: createHighResSpectrogramBuffers(spectrogramSpectrumDb.length),
    },
  });

  expect(audioSessionState.hzIndex).toBe(1);
  expect(result.spectrogramBuffers.spectrumNormalized.length).toBe(pitchSpectrumDb.length);
  expect(result.highResSpectrogramBuffers.spectrumNormalized.length).toBe(spectrogramSpectrumDb.length);
  expect(result.spectrogramColumn.length).toBe(spectrogramSpectrumDb.length);
});
