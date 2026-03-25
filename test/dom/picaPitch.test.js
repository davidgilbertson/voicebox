import assert from "node:assert/strict";
import { test } from "vitest";
import { isLargePicaPitchJump } from "../../src/Recorder/picaPitch.js";

test("octave-jump suppression only triggers for large near-octave leaps", () => {
  assert.equal(isLargePicaPitchJump(200, 300), false);
  assert.equal(isLargePicaPitchJump(200, 111), true);
  assert.equal(isLargePicaPitchJump(200, 360), false);
  assert.equal(isLargePicaPitchJump(200, 361), true);
});

test("octave-jump suppression ignores invalid prior or candidate pitches", () => {
  assert.equal(isLargePicaPitchJump(Number.NaN, 200), false);
  assert.equal(isLargePicaPitchJump(200, Number.NaN), false);
  assert.equal(isLargePicaPitchJump(0, 200), false);
  assert.equal(isLargePicaPitchJump(200, -1), false);
});
