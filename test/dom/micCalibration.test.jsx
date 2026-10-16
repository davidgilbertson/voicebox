import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

// On the scales page the recorder mic is off, so calibration has to open its own
// standalone session rather than reusing/starting the recorder engine (which would
// spin the recorder up just to calibrate). Mock the standalone measurement so the
// test asserts which branch runs, not the real audio capture.
const { calibrateStandaloneMock } = vi.hoisted(() => ({
  calibrateStandaloneMock: vi.fn(async () => 5),
}));

vi.mock("../../src/Recorder/micCalibration.js", async (importOriginal) => ({
  ...(await importOriginal()),
  calibrateMinVolumeThreshold: (...args) => calibrateStandaloneMock(...args),
}));

import { AppShell } from "../../src/AppShell.jsx";

describe("Settings", () => {
  test("Calibrating the mic on the scales page measures without starting the recorder", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    const engine = globalThis.__appRecordingEngineForTests;
    const engineCalibrateSpy = vi.spyOn(engine, "calibrateMinVolumeThreshold");

    await user.click(screen.getByRole("button", { name: "Scales" }));
    await user.click(screen.getByLabelText("Open settings"));
    await user.click(screen.getByRole("button", { name: /Record minimum volume/i }));

    await waitFor(() => {
      expect(calibrateStandaloneMock).toHaveBeenCalledTimes(1);
    });
    expect(engineCalibrateSpy).not.toHaveBeenCalled();
  });
});
