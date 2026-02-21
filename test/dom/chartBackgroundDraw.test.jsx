import React from "react";
import {createRef} from "react";
import {render} from "@testing-library/react";
import {test, expect, vi} from "vitest";
import Chart from "../../src/Recorder/Chart.jsx";

test("chart draw calls background renderer even when there is no data", () => {
  const chartRef = createRef();
  const drawBackground = vi.fn();

  render(<Chart ref={chartRef}/>);

  chartRef.current.draw({
    values: new Float32Array(8),
    writeIndex: 0,
    count: 0,
    yRange: 1,
    drawBackground,
  });

  expect(drawBackground).toHaveBeenCalledTimes(1);
});

test("chart draw uses color mapping callback when color values are provided", () => {
  const chartRef = createRef();
  const mapColorValueToStroke = vi.fn(() => "rgb(0 0 0)");

  render(<Chart ref={chartRef}/>);

  chartRef.current.draw({
    values: new Float32Array([0, 0.5, 1]),
    colorValues: new Float32Array([0.1, 0.5, 0.9]),
    writeIndex: 0,
    count: 3,
    yRange: 1,
    mapColorValueToStroke,
  });

  expect(mapColorValueToStroke).toHaveBeenCalled();
});
