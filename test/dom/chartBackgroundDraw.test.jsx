import React from "react";
import {createRef} from "react";
import {render} from "@testing-library/react";
import {test, expect, vi} from "vitest";
import Chart from "../../src/Recorder/Chart.jsx";
import {RingBuffer} from "../../src/Recorder/ringBuffer.js";

function createRing(values) {
  const ring = new RingBuffer(values.length || 1);
  for (const value of values) {
    ring.push(value);
  }
  return ring;
}

test("chart draw calls background renderer even when there is no data", () => {
  const chartRef = createRef();
  const drawBackground = vi.fn();

  render(<Chart ref={chartRef}/>);

  chartRef.current.draw({
    valuesRing: createRing([]),
    yRange: 1,
    drawBackground,
  });

  expect(drawBackground).toHaveBeenCalledTimes(1);
});

test("chart draw uses color mapping callback when color values are provided", () => {
  const chartRef = createRef();
  const mapColorValueToStroke = vi.fn(() => "rgb(0 0 0)");

  render(<Chart ref={chartRef}/>);

  const valuesRing = createRing([0, 0.5, 1]);
  const colorValuesRing = createRing([0.1, 0.5, 0.9]);
  chartRef.current.draw({
    valuesRing,
    colorValuesRing,
    yRange: 1,
    mapColorValueToStroke,
  });

  expect(mapColorValueToStroke).toHaveBeenCalled();
});
