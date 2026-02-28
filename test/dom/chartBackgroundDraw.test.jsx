import {test, expect, vi} from "vitest";
import {drawWaveformTrace} from "../../src/Recorder/canvasTools.js";
import {readPitchLineColorMode} from "../../src/Recorder/config.js";
import {PitchChartRenderer} from "../../src/Recorder/Pitch/pitchTools.js";
import {RingBuffer} from "../../src/Recorder/ringBuffer.js";

function createRing(values) {
  const ring = new RingBuffer(values.length || 1);
  for (const value of values) {
    ring.push(value);
  }
  return ring;
}

function createCanvasContext(drawImage = vi.fn()) {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "middle",
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
  };
}

function createCanvas(ctx) {
  return {
    clientWidth: 200,
    clientHeight: 120,
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
}

test("pitch renderer draws background even when there is no waveform data", () => {
  const drawImage = vi.fn();
  const ctx = createCanvasContext(drawImage);
  const canvas = createCanvas(ctx);
  const renderer = new PitchChartRenderer();
  renderer.setCanvas(canvas);
  renderer.updateOptions({
    minCents: 0,
    maxCents: 1200,
    lineColorMode: readPitchLineColorMode(),
    renderScale: 1,
  });
  renderer.draw({
    smoothedPitchCentsRing: createRing([]),
    signalStrengthRing: createRing([]),
  });

  expect(drawImage).toHaveBeenCalled();
});

test("line renderer uses color mapping callback when color values are provided", () => {
  const mapColorValueToStroke = vi.fn(() => "rgb(0 0 0)");
  const ctx = createCanvasContext();

  const valuesRing = createRing([0, 0.5, 1]);
  const colorValuesRing = createRing([0.1, 0.5, 0.9]);
  drawWaveformTrace({
    ctx,
    valuesRing,
    colorValuesRing,
    yRange: 1,
    mapColorValueToStroke,
    plotWidth: 200,
    plotHeight: 120,
  });

  expect(mapColorValueToStroke).toHaveBeenCalled();
});
