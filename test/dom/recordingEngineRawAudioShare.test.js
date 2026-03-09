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
