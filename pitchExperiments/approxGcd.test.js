import test from "node:test";
import assert from "node:assert/strict";
import {predictF0} from "./audioProcessing.js";

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createJitteredMultiples(base, multipleCount, jitterAmplitude, rng) {
  const values = [];
  for (let multiple = 1; multiple <= multipleCount; multiple += 1) {
    const jitter = (rng() * 2 - 1) * jitterAmplitude;
    values.push((base * multiple) + jitter);
  }
  return values;
}

test("predictF0 finds base spacing for jittered harmonic sets", () => {
  const rng = createSeededRandom(12345);
  const bases = [20, 27, 35, 48, 60, 73, 95];
  for (const base of bases) {
    for (let count = 2; count <= 6; count += 1) {
      const values = createJitteredMultiples(base, count, 0.6, rng);
      const result = predictF0(values, {tol: 1.5, maxDivisor: 8, minInliers: 2});
      assert.ok(Number.isFinite(result), `Expected finite result for base=${base}, count=${count}`);
      assert.ok(
          Math.abs(result - base) <= 1.6,
          `Expected ~${base}, got ${result} for values=${JSON.stringify(values)}`
      );
    }
  }
});

test("predictF0 handles omitted fundamental by using upper harmonics", () => {
  const values = [40.3, 60.2, 80.4];
  const result = predictF0(values, {tol: 1.5, maxDivisor: 8, minInliers: 2});
  assert.ok(Number.isFinite(result));
  assert.ok(Math.abs(result - 20) <= 1.6, `Expected ~20, got ${result}`);
});

test("predictF0 falls back to min(gap, smallest value) when gcd is inconclusive", () => {
  const values = [20.2, 40.4, 60.1];
  const result = predictF0(values, {tol: 1.5, minValue: 30});
  assert.ok(Number.isFinite(result));
  assert.ok(Math.abs(result - 19.7) <= 0.0001, `Expected fallback ~19.7, got ${result}`);
});
