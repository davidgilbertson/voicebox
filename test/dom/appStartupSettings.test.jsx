import { expect, test } from "vitest";
import { RecordingEngine } from "../../src/Recorder/RecordingEngine.js";
import { PlaybackEngine } from "../../src/ScalesPage/PlaybackEngine.js";
import { readConfig } from "../../src/config.js";
import { createPlaybackEngineConfig, createRecordingEngineConfig } from "../utils/engineConfig.js";

test("readConfig groups persisted values for initial app initialization", () => {
  localStorage.setItem("voicebox.activeView", "pitch");
  localStorage.setItem("voicebox.highResSpectrogram", "false");
  localStorage.setItem("voicebox.pitchMinNote", "D2");
  localStorage.setItem("voicebox.pitchMaxNote", "A5");
  localStorage.setItem("voicebox.minVolumeThreshold", "3.5");
  localStorage.setItem("voicebox.keepRunningInBackground", "true");
  localStorage.setItem("voicebox.scales.bpm", "320");
  localStorage.setItem("voicebox.scales.minNote", "B2");
  localStorage.setItem("voicebox.scales.maxNote", "F4");
  localStorage.setItem("voicebox.scales.selectedName", "Major");

  expect(readConfig()).toEqual({
    app: {
      activeView: "pitch",
    },
    shared: {
      keepRunningInBackground: true,
    },
    recorder: {
      autoPauseOnSilence: true,
      runAt30Fps: false,
      halfResolutionCanvas: false,
      highResSpectrogram: false,
      minVolumeThreshold: 3.5,
      pitchMinNote: "D2",
      pitchMaxNote: "A5",
      pitchLineColorMode: "terrain",
      spectrogramMinHz: 30,
      spectrogramMaxHz: 11_000,
    },
    scales: {
      bpm: 320,
      scaleMinNote: "B2",
      scaleMaxNote: "F4",
      selectedScaleName: "Major",
      gestureHelpDismissed: false,
    },
  });
});

test("engines can be constructed from boot settings before React effects run", () => {
  const recorder = new RecordingEngine({
    ...createRecordingEngineConfig(),
    keepRunningInBackground: true,
    autoPauseOnSilence: false,
    runAt30Fps: true,
    highResSpectrogram: true,
    minVolumeThreshold: 4.2,
    pitchMinNote: "D2",
    pitchMaxNote: "A5",
  });
  const playback = new PlaybackEngine({
    ...createPlaybackEngineConfig(),
    keepRunningInBackground: true,
    isForeground: false,
    bpm: 320,
    scaleMinNote: "B2",
    scaleMaxNote: "F4",
    selectedScaleName: "Major",
  });

  try {
    expect(recorder.state.keepRunningInBackground).toBe(true);
    expect(recorder.state.autoPauseOnSilence).toBe(false);
    expect(recorder.state.runAt30Fps).toBe(true);
    expect(recorder.state.highResSpectrogram).toBe(true);
    expect(recorder.state.minVolumeThreshold).toBe(4.2);
    expect(recorder.state.pitchRange.minHz).toBeGreaterThan(0);
    expect(recorder.state.pitchRange.maxHz).toBeGreaterThan(recorder.state.pitchRange.minHz);

    expect(playback.state.keepRunningInBackground).toBe(true);
    expect(playback.state.isForeground).toBe(false);
    expect(playback.state.ui.bpm).toBe(320);
    expect(playback.state.ui.selectedScaleName).toBe("Major");
    expect(playback.state.scaleMinMidi).toBeLessThan(playback.state.scaleMaxMidi);
  } finally {
    recorder.destroy();
    playback.destroy();
  }
});
