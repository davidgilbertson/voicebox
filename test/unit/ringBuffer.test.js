import {test} from "vitest";
import assert from "node:assert/strict";
import {RingBuffer} from "../../src/Recorder/ringBuffer.js";

function orderedValues(ring) {
  return Array.from(ring.slice());
}

test("ring buffer keeps newest N values", () => {
  const ring = new RingBuffer(3);
  ring.push(1);
  ring.push(2);
  ring.push(3);
  ring.push(4);
  assert.deepEqual(orderedValues(ring), [2, 3, 4]);
});

test("ring resize preserves newest values", () => {
  const ring = new RingBuffer(4);
  ring.push(10);
  ring.push(20);
  ring.push(30);
  ring.push(40);
  ring.resize(2);
  assert.deepEqual(orderedValues(ring), [30, 40]);
});
