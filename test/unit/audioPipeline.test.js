import {test} from "vitest";
import assert from "node:assert/strict";
import {
  createAnalysisState,
  createRawAudioBuffer,
  drainRawBuffer,
  enqueueAudioSamples,
} from "../../src/audioPipeline.js";

test("enqueueAudioSamples overwrites oldest samples when raw buffer is full", () => {
  const raw = createRawAudioBuffer(10, {windowSize: 4, rawBufferSeconds: 0.2});
  const dropped = enqueueAudioSamples(raw, Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(dropped, 2);
  assert.equal(raw.size, 8);
});

test("drainRawBuffer emits analysis windows at the configured hop cadence", () => {
  const raw = createRawAudioBuffer(1000, {windowSize: 4, rawBufferSeconds: 1});
  enqueueAudioSamples(raw, Float32Array.from({length: 50}, (_, i) => i));
  const analysis = createAnalysisState(1000, {windowSize: 4, samplesPerSecond: 100});

  const windows = [];
  const nowMsValues = [];
  const emitted = drainRawBuffer(raw, analysis, (windowSamples, nowMs) => {
    windows.push(Array.from(windowSamples));
    nowMsValues.push(nowMs);
  });

  assert.equal(emitted, 5);
  assert.deepEqual(nowMsValues, [10, 20, 30, 40, 50]);
  assert.deepEqual(windows[0], [6, 7, 8, 9]);
  assert.deepEqual(windows[4], [46, 47, 48, 49]);
  assert.equal(raw.size, 0);
});
