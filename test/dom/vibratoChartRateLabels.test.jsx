import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { VibratoChart } from "../../src/Recorder/Vibrato/VibratoChart.jsx";
import { readPitchLineColorMode } from "../../src/Recorder/config.js";

describe("Vibrato", () => {
  test("The vibrato bar labels the integer rates across the 4-8 Hz range", () => {
    render(
      <VibratoChart vibratoRate={null} lineColorMode={readPitchLineColorMode()} renderScale={1} />,
    );

    for (const label of ["4 Hz", "5 Hz", "6 Hz", "7 Hz", "8 Hz"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
