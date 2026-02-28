import React from "react";
import {render, screen} from "@testing-library/react";
import {test, expect} from "vitest";
import VibratoChart from "../../src/Recorder/Vibrato/VibratoChart.jsx";
import {readPitchLineColorMode} from "../../src/Recorder/config.js";

test("vibrato bar shows intermediate integer rate labels", () => {
  render(
      <VibratoChart
          vibratoRate={null}
          lineColorMode={readPitchLineColorMode()}
          renderScale={1}
      />
  );

  expect(screen.getByText("5 Hz")).toBeInTheDocument();
  expect(screen.getByText("6 Hz")).toBeInTheDocument();
  expect(screen.getByText("7 Hz")).toBeInTheDocument();
});

test("vibrato rate labels use the lighter style and larger font size", () => {
  render(
      <VibratoChart
          vibratoRate={null}
          lineColorMode={readPitchLineColorMode()}
          renderScale={1}
      />
  );

  expect(screen.getByText("5 Hz")).toHaveClass("text-slate-300/85");
  expect(screen.getByText("6 Hz")).toHaveClass("text-slate-300/85");
  expect(screen.getByText("7 Hz")).toHaveClass("text-slate-300/85");
  expect(screen.getByText("4 Hz")).toHaveClass("text-slate-300/85");
  expect(screen.getByText("8 Hz")).toHaveClass("text-slate-300/85");
  expect(screen.getByText("5 Hz").closest("div")).toHaveClass("text-xs");
});
