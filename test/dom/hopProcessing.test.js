import { describe, expect, test, vi } from "vitest";
import { createPitchProcessingState } from "../../src/Recorder/pitchProcessing.js";
import { createSpectrogramBuffers, processOneAudioHop } from "../../src/Recorder/hopProcessing.js";
import { getPicaWindowSampleCount } from "../../src/Recorder/picaPitch.js";
import { appendRawAudioSamples, createRawAudioState } from "../../src/Recorder/rawAudio.js";
import { hzToCents } from "../../src/pitchScale.js";
import { SpectrogramChartRenderer } from "../../src/Recorder/Spectrogram/spectrogramTools.js";

function createHop({
  volume = 4.5,
  minHz = 80,
  maxHz = 1200,
  sampleCount,
  highRes = false,
  amplitude = 0.5,
} = {}) {
  const sampleRate = 48_000;
  const windowLength = getPicaWindowSampleCount(sampleRate, minHz);
  const rawAudioState = createRawAudioState({ sampleRate, seconds: 2 });
  const samples = new Float32Array(sampleCount ?? windowLength);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
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
    test("Calibrated quiet and loud inputs produce the same pitch, spectrum and pitch colour", () => {
      const outputs = [1, 8].map((scale) => {
        const hop = createHop({ amplitude: 0.01 * scale });
        hop.engineState.volume = (4 + Math.log10((0.01 * scale) / Math.sqrt(2))) * 2.6;
        hop.engineState.volumeTracking.maxHeardVolume = (4 + Math.log10(0.04 * scale)) * 2.6;
        hop.engineState.minVolumeThreshold = (4 + Math.log10(0.001 * scale)) * 2.6;
        hop.hopState.audioSessionState.analyser.getFloatFrequencyData.mockImplementation((target) =>
          target.fill(-80 + 20 * Math.log10(scale)),
        );
        const rawBefore = hop.hopState.rawAudioState.ring.values();
        const result = processOneAudioHop(hop);
        expect(hop.hopState.rawAudioState.ring.values()).toEqual(rawBefore);
        return {
          pitch: hop.hopState.processingState.rawPitchCentsRing.newest(),
          colour: result.nextLineStrengthEma,
          spectrum: result.spectrumDb[0],
        };
      });
      expect(outputs[0].pitch).toBeCloseTo(hzToCents(220), 0);
      expect(outputs[1].pitch).toBeCloseTo(outputs[0].pitch, 4);
      expect(outputs[1].colour).toBeCloseTo(outputs[0].colour, 6);
      expect(outputs[1].spectrum).toBeCloseTo(outputs[0].spectrum, 4);
    });

    test("Resetting the remembered maximum immediately changes spectrogram normalization", () => {
      const hop = createHop();
      hop.engineState.volume = 5;
      hop.engineState.volumeTracking.maxHeardVolume = 9;
      const before = processOneAudioHop(hop);
      const beforeDb = before.spectrumDb[0];
      hop.engineState.volumeTracking.maxHeardVolume = 2;
      const after = processOneAudioHop(hop);
      expect(after.spectrumDb[0]).toBeGreaterThan(beforeDb + 25);
      expect(hop.engineState.volumeTracking.maxHeardVolume).toBe(5);
      expect(after.shouldPersistMaxVolume).toBe(true);
    });

    test("Moderate notes keep their pitch after a loud note raises the remembered maximum", () => {
      const hop = createHop({ amplitude: 0.005 });
      hop.engineState.volumeTracking.maxHeardVolume = 2;
      const moderateSamples = hop.hopState.rawAudioState.ring.values();
      const loudSamples = Float32Array.from(moderateSamples, (sample) => sample * 40);

      for (const samples of [moderateSamples, loudSamples, moderateSamples]) {
        appendRawAudioSamples(hop.hopState.rawAudioState, samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
        );
        hop.engineState.volume = (4 + Math.log10(rms)) * 2.6;
        processOneAudioHop(hop);
        expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeCloseTo(
          hzToCents(220),
          0,
        );
      }
      expect(hop.engineState.volumeTracking.maxHeardVolume).toBeGreaterThan(hop.engineState.volume);
    });

    test("Repeated hops preserve raw pitch samples and do not accumulate spectrogram gain", () => {
      const hop = createHop({ amplitude: 0.01 });
      const first = processOneAudioHop(hop);
      const firstDb = first.spectrumDb[0];
      const firstWindow = hop.hopState.audioSessionState.picaWindowSamples.slice();
      const second = processOneAudioHop(hop);
      expect(second.spectrumDb[0]).toBe(firstDb);
      expect(hop.hopState.audioSessionState.picaWindowSamples).toEqual(firstWindow);
    });

    test("A silent waveform produces no pitch even when the volume gate is open", () => {
      const hop = createHop({ amplitude: 0 });
      processOneAudioHop(hop);
      expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeNaN();
    });

    test("The spectrogram maps normalized decibels without another volume gain", () => {
      const renderer = new SpectrogramChartRenderer({ minHz: 30, maxHz: 11000, renderScale: 1 });
      renderer.appendColumn(new Float32Array([-100, -57.5, -15]));
      expect(Array.from(renderer.pendingColumns[0])).toEqual([0, 0.5, 1]);
    });
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
      expect(result.spectrumDb[0]).toBeCloseTo(
        -40 + 20 * Math.log10(0.25 / 10 ** (4.5 / 2.6 - 4)),
        4,
      );
      expect(hop.hopState.processingState.rawPitchCentsRing.newest()).toBeCloseTo(
        hzToCents(220),
        0,
      );
    });
  });
});
