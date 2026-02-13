import {test} from "vitest";
import assert from "node:assert/strict";
import {detectPitchFftHpsDetailed, detectPitchFftResidualDetailed} from "../src/fftPitch.js";

function createSineSignal({sampleRate, size, hz, amplitude = 1, phase = 0}) {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    const t = i / sampleRate;
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * t) + phase);
  }
  return out;
}

test("detectPitchFftHpsDetailed detects a clean A3 sine wave", () => {
  const sampleRate = 48000;
  const size = 2048;
  const data = createSineSignal({sampleRate, size, hz: 220, amplitude: 0.8});
  const result = detectPitchFftHpsDetailed(data, sampleRate, 65, 1100);
  assert.ok(result.hz > 0);
  assert.ok(Math.abs(result.hz - 220) < 4);
});

test("detectPitchFftHpsDetailed favors the fundamental when harmonics are strong", () => {
  const sampleRate = 48000;
  const size = 2048;
  const fundamental = createSineSignal({sampleRate, size, hz: 220, amplitude: 0.35});
  const second = createSineSignal({sampleRate, size, hz: 440, amplitude: 0.9});
  const data = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    data[i] = fundamental[i] + second[i];
  }
  const result = detectPitchFftHpsDetailed(data, sampleRate, 65, 1100);
  assert.ok(result.hz > 0);
  assert.ok(Math.abs(result.hz - 220) < 6);
});

test("detectPitchFftHpsDetailed returns zero on silence", () => {
  const sampleRate = 48000;
  const size = 2048;
  const data = new Float32Array(size);
  const result = detectPitchFftHpsDetailed(data, sampleRate, 65, 1100);
  assert.equal(result.hz, 0);
});

test("detectPitchFftHpsDetailed with SHS detects a clean A3 sine wave", () => {
  const sampleRate = 48000;
  const size = 2048;
  const data = createSineSignal({sampleRate, size, hz: 220, amplitude: 0.8});
  const result = detectPitchFftHpsDetailed(data, sampleRate, 65, 1100, {
    detector: "shs",
  });
  assert.ok(result.hz > 0);
  assert.ok(Math.abs(result.hz - 220) < 4);
});

test("detectPitchFftHpsDetailed with SHS returns a stable harmonic-family pitch when harmonics are strong", () => {
  const sampleRate = 48000;
  const size = 2048;
  const fundamental = createSineSignal({sampleRate, size, hz: 220, amplitude: 0.35});
  const second = createSineSignal({sampleRate, size, hz: 440, amplitude: 0.9});
  const data = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    data[i] = fundamental[i] + second[i];
  }
  const result = detectPitchFftHpsDetailed(data, sampleRate, 65, 1100, {
    detector: "shs",
  });
  assert.ok(result.hz > 0);
  const nearFundamental = Math.abs(result.hz - 220) < 6;
  const nearSecondHarmonic = Math.abs(result.hz - 440) < 6;
  assert.ok(nearFundamental || nearSecondHarmonic);
  assert.ok(result.confidence > 0);
});

test("detectPitchFftResidualDetailed detects a clean A3 sine wave", () => {
  const sampleRate = 48000;
  const size = 2048;
  const data = createSineSignal({sampleRate, size, hz: 220, amplitude: 0.8});
  const result = detectPitchFftResidualDetailed(data, sampleRate, 65, 1100);
  assert.ok(result.hz > 0);
  assert.ok(Number.isFinite(result.confidence));
});

test("detectPitchFftResidualDetailed returns zero on silence", () => {
  const sampleRate = 48000;
  const size = 2048;
  const data = new Float32Array(size);
  const result = detectPitchFftResidualDetailed(data, sampleRate, 65, 1100);
  assert.equal(result.hz, 0);
});
