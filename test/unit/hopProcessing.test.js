import {expect, test} from "vitest";
import {createPitchProcessingState} from "../../src/Recorder/pitchProcessing.js";
import {
  applyNoiseProfileToSpectrum,
  createSpectrogramCaptureBuffers,
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
  const spectrogramCapture = createSpectrogramCaptureBuffers(4);
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
      spectrogramCapture,
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
  const spectrogramCapture = createSpectrogramCaptureBuffers(4);
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
      spectrogramCapture,
    },
  });

  expect(result.didFrameDataChange).toBe(true);
  expect(result.spectrogramColumn).toBeInstanceOf(Float32Array);
  expect(result.shouldPersistMaxSignalLevel).toBe(true);
  expect(processingState.rawPitchCentsRing.sampleCount).toBe(1);
});

test("applyNoiseProfileToSpectrum clamps filtered values at zero", () => {
  const spectrogramNoiseState = {
    profile: new Float32Array([0.9]),
    calibrating: false,
    sumBins: null,
    sampleCount: 0,
  };
  const spectrogramCapture = {
    spectrumFiltered: new Float32Array(1),
  };
  const {spectrumFiltered} = applyNoiseProfileToSpectrum({
    spectrumNormalized: new Float32Array([0.1]),
    spectrogramNoiseState,
    spectrogramCapture,
  });
  expect(spectrumFiltered[0]).toBe(0);
});
