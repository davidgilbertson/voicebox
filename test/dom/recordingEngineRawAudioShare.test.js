import { describe, expect, test, vi } from "vitest";
import { RecordingEngine } from "../../src/Recorder/RecordingEngine.js";
import { appendRawAudioSamples, readRawAudioSamples } from "../../src/Recorder/rawAudio.js";
import { createRecordingEngineConfig } from "../utils/engineConfig.js";

describe("Recorder pages", () => {
  describe("Sharing captured audio", () => {
    test("Silence auto-pause preserves the audio shown on the chart for export", async () => {
      vi.stubGlobal(
        "AudioWorkletNode",
        class extends window.AudioWorkletNode {
          constructor() {
            super();
            this.port.postMessage = () => {};
          }
        },
      );
      const engine = new RecordingEngine(createRecordingEngineConfig());
      try {
        await engine.startAudio();
        const onMessage = engine.audioSessionState.captureNode.port.onmessage;
        const sendHop = (volume, sample) =>
          onMessage({
            data: {
              sampleCount: engine.state.hopSize,
              volume,
              samples: new Float32Array(engine.state.hopSize).fill(sample),
            },
          });
        for (let i = 0; i < 10; i += 1) sendHop(7, 0.1);
        // Include the existing brief silence tail before auto-pause takes effect.
        for (let i = 0; i < 30; i += 1) sendHop(0, 0);
        const visibleAudio = readRawAudioSamples(engine.rawAudioState);
        const visibleSteps = engine.pitchProcessingState.rawPitchCentsRing.sampleCount;
        expect(visibleAudio).toContain(Math.fround(0.1));
        for (let i = 0; i < 1200; i += 1) sendHop(0, 0);
        expect(engine.pitchProcessingState.rawPitchCentsRing.sampleCount).toBe(visibleSteps);
        expect(engine.rawAudioState.ring.sampleCount).toBe(visibleAudio.length);
        expect(readRawAudioSamples(engine.rawAudioState)).toEqual(visibleAudio);
        // A fresh sound must still be analysed after a long auto-pause.
        sendHop(7, 0.2);
        expect(engine.pitchProcessingState.rawPitchCentsRing.sampleCount).toBe(visibleSteps + 1);
        expect(readRawAudioSamples(engine.rawAudioState).slice(-engine.state.hopSize)).toEqual(
          new Float32Array(engine.state.hopSize).fill(0.2),
        );
        engine.setWantsToRun(false);
        const pausedAudio = readRawAudioSamples(engine.rawAudioState);
        sendHop(0, 0);
        expect(readRawAudioSamples(engine.rawAudioState)).toEqual(pausedAudio);
        navigator.share = vi.fn(async () => {});
        await engine.shareRawAudio();
        const file = navigator.share.mock.calls[0][0].files[0];
        const wav = new DataView(await file.arrayBuffer());
        expect(wav.getUint32(40, true)).toBe(pausedAudio.length * 2);
        expect(wav.getInt16(44, true)).toBe(Math.round(0.1 * 32767));
        expect(wav.getInt16(44 + (pausedAudio.length - 1) * 2, true)).toBe(Math.round(0.2 * 32767));
      } finally {
        engine.destroy();
      }
    });

    test("The shared wav filename uses the actual captured duration", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-08T12:34:56"));

      navigator.share = vi.fn(async () => {});
      navigator.canShare = vi.fn(() => true);

      const engine = new RecordingEngine(createRecordingEngineConfig());
      try {
        appendRawAudioSamples(engine.rawAudioState, new Float32Array(48_000 * 3).fill(0.25));
        engine.rawAudioState.seconds = 22;
        engine.setUi({ hasEverRun: true, isWantedRunning: false });

        await engine.shareRawAudio();

        expect(navigator.share).toHaveBeenCalledTimes(1);
        const [{ files }] = navigator.share.mock.calls[0];
        expect(files).toHaveLength(1);
        expect(files[0].name).toMatch(/^voicebox-last-3-seconds-\d{4}-\d{2}-\d{2}-\d{4}\.wav$/);
      } finally {
        engine.destroy();
      }
    });

    test("The downloaded wav filename matches the shared name and reuses the picker id", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-08T12:34:56"));

      const close = vi.fn(async () => {});
      const write = vi.fn(async () => {});
      window.showSaveFilePicker = vi.fn(async () => ({
        createWritable: vi.fn(async () => ({
          write,
          close,
        })),
      }));

      const engine = new RecordingEngine(createRecordingEngineConfig());
      try {
        appendRawAudioSamples(engine.rawAudioState, new Float32Array(48_000 * 3).fill(0.25));
        engine.rawAudioState.seconds = 22;
        engine.setUi({ hasEverRun: true, isWantedRunning: false });

        await expect(engine.downloadRawAudio()).resolves.toBe(true);

        expect(window.showSaveFilePicker).toHaveBeenCalledTimes(1);
        const [pickerOptions] = window.showSaveFilePicker.mock.calls[0];
        expect(pickerOptions.id).toBe("voicebox-raw-audio");
        expect(pickerOptions.suggestedName).toMatch(
          /^voicebox-last-3-seconds-\d{4}-\d{2}-\d{2}-\d{4}\.wav$/,
        );
        expect(write).toHaveBeenCalledTimes(1);
        const [file] = write.mock.calls[0];
        expect(file.name).toBe(pickerOptions.suggestedName);
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        delete window.showSaveFilePicker;
        engine.destroy();
      }
    });
  });
});
