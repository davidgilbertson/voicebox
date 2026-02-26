import React from "react";
import {render, screen} from "@testing-library/react";
import {test, expect} from "vitest";
import VibratoChart from "../../src/Recorder/VibratoChart.jsx";

test("vibrato bar shows intermediate integer rate labels", () => {
  render(
      <VibratoChart
          yRange={300}
          maxDrawJumpCents={80}
          vibratoRate={null}
          vibratoRateMinHz={3}
          vibratoRateMaxHz={9}
          vibratoSweetMinHz={4}
          vibratoSweetMaxHz={8}
      />
  );

  expect(screen.getByText("5 Hz")).toBeInTheDocument();
  expect(screen.getByText("6 Hz")).toBeInTheDocument();
  expect(screen.getByText("7 Hz")).toBeInTheDocument();
});
