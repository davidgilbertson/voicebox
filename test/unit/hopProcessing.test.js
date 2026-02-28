import {expect, test, vi} from "vitest";
import {createPitchTimeline, writePitchTimeline} from "../../src/Recorder/pitchTimeline.js";
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
  const pitchHistory = createPitchTimeline({
    columnRateHz: 80,
    seconds: 2,
    silencePauseStepThreshold: 1,
  });
  const spectrogramCapture = createSpectrogramCaptureBuffers(4);
  const audioState = {
    analyser: createAnalyserWithSpectrum(new Float32Array([-40, -45, -50, -55])),
    sampleRate: 48000,
  };
  const result = processOneAudioHop({
    isManuallyPaused: false,
    activeView: "pitch",
    pitchRange: {minHz: 80, maxHz: 1200},
    spectrogramRange: {minHz: 80, maxHz: 1200},
    signalLevel: 0.001,
    minSignalThreshold: 0.015,
    signalTracking: {maxHeardSignalLevel: 0.2},
    spectrumIntensityEma: 0,
    autoPauseOnSilence: true,
    pitchHistory,
    audioState,
    spectrogramNoiseState: {profile: null, calibrating: false, sumBins: null, sampleCount: 0},
    spectrogramCapture,
    skipNextSpectrumFrame: false,
    analyzePitch: vi.fn(() => ({cents: 1200})),
    writePitchTimeline,
    estimateTimelineVibratoRate: vi.fn(() => null),
    vibratoRateConfig: {minRateHz: 4, maxRateHz: 8, analysisWindowSeconds: 2, minContinuousSeconds: 0.2},
  });

  expect(result.didFrameDataChange).toBe(false);
  expect(result.spectrogramColumn).toBeNull();
  expect(pitchHistory.rawPitchCentsRing.sampleCount).toBe(0);
});

test("processOneAudioHop writes one pitch-history step for valid signal and returns spectrogram column", () => {
  const pitchHistory = createPitchTimeline({
    columnRateHz: 80,
    seconds: 2,
    silencePauseStepThreshold: 4,
  });
  const spectrogramCapture = createSpectrogramCaptureBuffers(4);
  const audioState = {
    analyser: createAnalyserWithSpectrum(new Float32Array([-40, -45, -50, -55])),
    sampleRate: 48000,
  };
  const analyzePitch = vi.fn(() => ({cents: 1200}));
  const estimateTimelineVibratoRate = vi.fn(() => 5.5);
  const result = processOneAudioHop({
    isManuallyPaused: false,
    activeView: "pitch",
    pitchRange: {minHz: 80, maxHz: 1200},
    spectrogramRange: {minHz: 80, maxHz: 1200},
    signalLevel: 0.25,
    minSignalThreshold: 0.015,
    signalTracking: {maxHeardSignalLevel: 0.1},
    spectrumIntensityEma: 0,
    autoPauseOnSilence: true,
    pitchHistory,
    audioState,
    spectrogramNoiseState: {profile: null, calibrating: false, sumBins: null, sampleCount: 0},
    spectrogramCapture,
    skipNextSpectrumFrame: false,
    analyzePitch,
    writePitchTimeline,
    estimateTimelineVibratoRate,
    vibratoRateConfig: {minRateHz: 4, maxRateHz: 8, analysisWindowSeconds: 2, minContinuousSeconds: 0.2},
  });

  expect(result.didFrameDataChange).toBe(true);
  expect(result.spectrogramColumn).toBeInstanceOf(Float32Array);
  expect(result.shouldPersistMaxSignalLevel).toBe(true);
  expect(pitchHistory.rawPitchCentsRing.sampleCount).toBe(1);
  expect(Number.isFinite(pitchHistory.rawPitchCentsRing.newest())).toBe(true);
  expect(analyzePitch).toHaveBeenCalledTimes(1);
  expect(estimateTimelineVibratoRate).toHaveBeenCalledTimes(1);
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
