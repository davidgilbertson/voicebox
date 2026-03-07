import { expect, test, vi } from "vitest";
import {
  createRecorderAudioSession,
  destroyRecorderAudioSession,
} from "../../src/Recorder/audioSession.js";

test("recorder session starts when AudioWorkletNode rejects Safari-unfriendly options", async () => {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  const originalAudioWorkletNode = window.AudioWorkletNode;

  const stopTrack = vi.fn();
  navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
    getTracks: () => [{ stop: stopTrack }],
  }));

  window.AudioWorkletNode = class AudioWorkletNodeWithoutOptions {
    constructor(context, name) {
      this.context = context;
      this.name = name;
      this.port = {
        onmessage: null,
        postMessage: vi.fn(),
      };
    }

    connect() {}

    disconnect() {}
  };

  let session = null;
  try {
    session = await createRecorderAudioSession({
      fftSize: 2048,
      displayPixelsPerSecond: 80,
      workletModuleUrl: new URL("../../src/Recorder/worklets/audioWorklet.js", import.meta.url),
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: false,
      },
    });
    expect(session.captureNode.name).toBe("audio-capture-processor");
  } finally {
    destroyRecorderAudioSession(session ?? {});
    window.AudioWorkletNode = originalAudioWorkletNode;
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  }
});
