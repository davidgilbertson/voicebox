import {afterEach, expect, test, vi} from "vitest";
import {createAudioEngine} from "../../src/Recorder/AudioEngine.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  window.__setForegroundForTests({visible: true, focused: true});
});

test("pending audio start is cancelled if app backgrounds before start completes", async () => {
  window.__setForegroundForTests({visible: true, focused: true});
  const getUserMediaDeferred = deferred();
  const stopTrack = vi.fn();
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = vi.fn(() => getUserMediaDeferred.promise);

  const engine = createAudioEngine();
  try {
    engine.updateSettings({
      keepRunningInBackground: false,
      autoPauseOnSilence: true,
      pitchMinNote: "C1",
      pitchMaxNote: "F6",
      spectrogramMinHz: 20,
      spectrogramMaxHz: 5000,
    });
    engine.setWantsToRun(true);
    engine.startIfNeeded();

    window.__setForegroundForTests({visible: false, focused: false});
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));

    getUserMediaDeferred.resolve({
      getTracks: () => [{stop: stopTrack}],
    });
    await flushMicrotasks();

    expect(engine.getUiSnapshot().isAudioRunning).toBe(false);
    expect(stopTrack).toHaveBeenCalled();
  } finally {
    engine.destroy();
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
  }
});
