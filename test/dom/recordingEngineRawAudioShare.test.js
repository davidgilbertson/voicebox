import { expect, test, vi } from "vitest";
import { RecordingEngine } from "../../src/Recorder/RecordingEngine.js";
import { appendRawAudioSamples } from "../../src/Recorder/rawAudio.js";
import { createRecordingEngineConfig } from "../utils/engineConfig.js";

test("shared wav filename uses the actual captured duration", async () => {
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

test("downloaded wav filename uses the same naming as share and reuses the picker id", async () => {
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
