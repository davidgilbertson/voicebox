import {test} from "vitest";
import assert from "node:assert/strict";
import {interpolateFillValues} from "../../src/Recorder/seriesFill.js";

test("returns empty list for non-positive steps", () => {
  assert.deepEqual(interpolateFillValues(1, 2, 0), []);
  assert.deepEqual(interpolateFillValues(1, 2, -3), []);
});

test("returns the next value for one step", () => {
  assert.deepEqual(interpolateFillValues(1, 2, 1), [2]);
});

test("interpolates evenly when both endpoints are finite", () => {
  assert.deepEqual(interpolateFillValues(0, 10, 5), [2, 4, 6, 8, 10]);
});

test("fills with next value when previous is non-finite", () => {
  assert.deepEqual(interpolateFillValues(Number.NaN, 7, 3), [7, 7, 7]);
});

test("fills with NaN when next value is non-finite", () => {
  const values = interpolateFillValues(5, Number.NaN, 3);
  assert.equal(values.length, 3);
  assert.ok(values.every((value) => Number.isNaN(value)));
});
