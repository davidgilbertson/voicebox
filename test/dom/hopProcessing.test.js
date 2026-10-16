import { describe, expect, test, vi } from "vitest";
import { createPitchProcessingState } from "../../src/Recorder/pitchProcessing.js";
import { createSpectrogramBuffers, processOneAudioHop } from "../../src/Recorder/hopProcessing.js";
import { getPicaWindowSampleCount } from "../../src/Recorder/picaPitch.js";
import { appendRawAudioSamples, createRawAudioState } from "../../src/Recorder/rawAudio.js";
import { hzToCents } from "../../src/pitchScale.js";

function createHop({ volume = 4.5, minHz = 80, maxHz = 1200, sampleCount, highRes = false } = {}) {
  const sampleRate = 48_000;
  const windowLength = getPicaWindowSampleCount(sampleRate, minHz);
  const rawAudioState = createRawAudioState({ sampleRate, seconds: 2 });
  const samples = new Float32Array(sampleCount ?? windowLength);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
  }
  appendRawAudioSamples(rawAudioState, samples);
  const analyser = {
    frequencyBinCount: 512,
    minDecibels: -100,
    getFloatFrequencyData: vi.fn((target) => target.fill(-60)),
  };
  const highResAnalyser = highRes
    ? {
        ...analyser,
        frequencyBinCount: 1024,
        getFloatFrequencyData: vi.fn((target) => target.fill(-40)),
      }
    : null;
  return {
    engineState: {
      pitchRange: { minHz, maxHz },
      volume,
      minVolumeThreshold: 2,
      volumeTracking: { maxHeardVolume: 4 },
      lineStrengthEma: 0,
      autoPauseOnSilence: true,
      skipNextSpectrumFrame: false,
    },
    hopState: {
      processingState: createPitchProcessingState({
        columnRateHz: 80,
        seconds: 2,
        silencePauseStepThreshold: 1,
      }),
      audioSessionState: {
        analyser,
        highResAnalyser,
        sampleRate,
        picaWindowSamples: new Float32Array(windowLength),
      },
      rawAudioState,
      spectrogramBuffers: createSpectrogramBuffers(analyser.frequencyBinCount),
      highResSpectrogramBuffers: highRes
        ? createSpectrogramBuffers(highResAnalyser.frequencyBinCount)
        : null,
    },
  };
}

describe("Recorder pages", () => {
  describe("Per-hop processing", () => {
    test("Silence gating skips writing pitch history when it pauses on the first hop", () => {
      const hop = createHop({ volume: 1 });
      const result = processOneAudioHop(hop);
      expect(result.didFrameDataChange).toBe(false);
      expect(result.spectrumDb).toBeNull();
      expect(hop.hopState.processingState.rawPitchCentsRing.sampleCount).toBe(0);
    });

    test("Raw audio determines pitch even when the spectrum has no peak", () => {
      const hop = createHop();
      const result = processOneAudioHop(hop);
      expect(result.didFrameDataChange).toBe(true);
      expect(result.spectrumDb).toBeInstanceOf(Float32Array);
      expect(result.shouldPersistMaxVolume).toBe(true);
      expect(hop.hopState.processingState.rawPitchCentsRing.sampleCount).toBe(1);
      expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeCloseTo(
        hzToCents(220),
        0,
      );
    });

    test("Pitch detection respects the configured pitch range", () => {
      const inRange = createHop({ minHz: 80, maxHz: 500 });
      processOneAudioHop(inRange);
      expect(inRange.hopState.processingState.rawPitchCentsRing.newest()).toBeCloseTo(
        hzToCents(220),
        0,
      );
      const outOfRange = createHop({ minHz: 300, maxHz: 1200 });
      processOneAudioHop(outOfRange);
      expect(outOfRange.hopState.processingState.rawPitchCentsRing.newest()).toBeNaN();
    });

    test("Pitch stays unavailable until enough raw samples have arrived", () => {
      const hop = createHop({ sampleCount: 100 });
      processOneAudioHop(hop);
      expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeNaN();
    });

    test("Below-threshold audio produces no pitch when auto-pause is disabled", () => {
      const hop = createHop({ volume: 1 });
      hop.engineState.autoPauseOnSilence = false;
      const result = processOneAudioHop(hop);
      expect(result.spectrumDb).toBeInstanceOf(Float32Array);
      expect(hop.hopState.processingState.rawPitchCentsRing.sampleCount).toBe(1);
      expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeNaN();
    });

    test.each([false, true])(
      "Spectrogram startup skips uninitialized frames at high resolution %s",
      (highRes) => {
        const hop = createHop({ highRes });
        const analyser = highRes
          ? hop.hopState.audioSessionState.highResAnalyser
          : hop.hopState.audioSessionState.analyser;
        analyser.getFloatFrequencyData.mockImplementationOnce((target) => target.fill(-Infinity));
        const uninitialized = processOneAudioHop(hop);
        expect(uninitialized.spectrumDb).toBeNull();
        hop.engineState.skipNextSpectrumFrame = uninitialized.nextSkipNextSpectrumFrame;
        const settling = processOneAudioHop(hop);
        expect(settling.spectrumDb).toBeNull();
        hop.engineState.skipNextSpectrumFrame = settling.nextSkipNextSpectrumFrame;
        expect(processOneAudioHop(hop).spectrumDb).toBeInstanceOf(Float32Array);
      },
    );

    test("The base analyser is skipped when PICA reads from the high-res spectrogram", () => {
      const hop = createHop({ highRes: true });
      const result = processOneAudioHop(hop);
      expect(hop.hopState.audioSessionState.analyser.getFloatFrequencyData).not.toHaveBeenCalled();
      expect(
        hop.hopState.audioSessionState.highResAnalyser.getFloatFrequencyData,
      ).toHaveBeenCalledTimes(1);
      expect(result.spectrumDb.length).toBe(1024);
      expect(result.spectrumDb[0]).toBe(-40);
      expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeCloseTo(
        hzToCents(220),
        0,
      );
    });
  });
});
