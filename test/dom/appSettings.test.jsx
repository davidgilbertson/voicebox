import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect, vi } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";
import { appendRawAudioSamples } from "../../src/Recorder/rawAudio.js";
import {
  readAutoPauseOnSilence,
  readHighResSpectrogram,
  readHalfResolutionCanvas,
  readMaxVolume,
  readMinVolumeThreshold,
  readPitchLineColorMode,
  readRunAt30Fps,
  readSmoothing,
  readSpectrogramMaxHz,
  readSpectrogramMinHz,
} from "../../src/Recorder/config.js";
import { readDeveloperMode as readAppDeveloperMode } from "../../src/AppShell/config.js";

describe("Settings", () => {
  test("Settings start at their defaults and persist when changed", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    const autoPauseCheckbox = screen.getByRole("checkbox", {
      name: /Auto pause on silence/i,
    });
    const calibrateButton = screen.getByRole("button", { name: /Record minimum volume/i });
    const runAt30FpsCheckbox = screen.getByRole("checkbox", {
      name: /Run at 30 FPS/i,
    });
    const halfResolutionCanvasCheckbox = screen.getByRole("checkbox", {
      name: /Half-resolution canvas/i,
    });
    const halfResolutionSpectrogramCheckbox = screen.getByRole("checkbox", {
      name: /Half-resolution spectrogram/i,
    });

    expect(autoPauseCheckbox).toBeChecked();
    expect(calibrateButton).toBeEnabled();
    expect(runAt30FpsCheckbox).not.toBeChecked();
    expect(halfResolutionCanvasCheckbox).not.toBeChecked();
    expect(halfResolutionSpectrogramCheckbox).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: /Smoothing/i })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Use PICA/i })).toBeNull();

    await user.click(runAt30FpsCheckbox);
    expect(runAt30FpsCheckbox).toBeChecked();
    await user.click(halfResolutionCanvasCheckbox);
    expect(halfResolutionCanvasCheckbox).toBeChecked();
    await user.click(halfResolutionSpectrogramCheckbox);
    expect(halfResolutionSpectrogramCheckbox).toBeChecked();

    await waitFor(() => {
      expect(readAutoPauseOnSilence()).toBe(true);
      expect(readMinVolumeThreshold()).toBe(2);
      expect(readRunAt30Fps()).toBe(true);
      expect(readHalfResolutionCanvas()).toBe(true);
      expect(readHighResSpectrogram()).toBe(false);
    });
  });

  test("Settings can reset the remembered maximum volume", async () => {
    localStorage.setItem("voicebox.maxVolume", "8");
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    await user.click(screen.getByRole("button", { name: /Reset maximum volume/i }));

    expect(readMaxVolume()).toBe(2);
    expect(globalThis.__appRecordingEngineForTests.volumeTracking.maxHeardVolume).toBe(2);
  });

  test("Spectrogram frequency settings are editable and persisted", async () => {
    render(<AppShell />);
    fireEvent.click(screen.getByLabelText("Open settings"));
    const minInput = screen.getByLabelText("Spectrogram minimum frequency (Hz)");
    const maxInput = screen.getByLabelText("Spectrogram maximum frequency (Hz)");

    expect(minInput).toHaveValue(readSpectrogramMinHz());
    expect(maxInput).toHaveValue(readSpectrogramMaxHz());
    expect(minInput).not.toHaveAttribute("min");
    expect(minInput).not.toHaveAttribute("max");
    expect(maxInput).not.toHaveAttribute("min");
    expect(maxInput).not.toHaveAttribute("max");

    fireEvent.change(minInput, { target: { value: "55" } });
    fireEvent.change(maxInput, { target: { value: "7200" } });
    fireEvent.blur(minInput);
    fireEvent.blur(maxInput);

    await waitFor(() => {
      expect(readSpectrogramMinHz()).toBe(55);
      expect(readSpectrogramMaxHz()).toBe(7200);
    });
  });

  test("Spectrogram frequency inputs can be cleared while editing and commit on blur", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    const minInput = screen.getByLabelText("Spectrogram minimum frequency (Hz)");

    fireEvent.change(minInput, { target: { value: "" } });
    expect(minInput).toHaveValue(null);

    fireEvent.change(minInput, { target: { value: "65" } });
    fireEvent.blur(minInput);

    await waitFor(() => {
      expect(readSpectrogramMinHz()).toBe(65);
    });
  });

  test.each([undefined, { level: 0.8, charging: true }])(
    "Battery use is hidden when battery information is unavailable or charging (%j)",
    async (battery) => {
      navigator.getBattery = battery ? vi.fn(async () => battery) : undefined;
      const user = userEvent.setup();
      render(<AppShell />);

      await user.click(screen.getByLabelText("Open settings"));
      expect(screen.queryByText("Battery use")).toBeNull();
      expect(screen.queryByText("NA")).toBeNull();
    },
  );

  test("Battery use shows -- in the first minute", async () => {
    const battery = {
      level: 0.8,
      charging: false,
    };
    navigator.getBattery = vi.fn(async () => battery);

    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    expect(await screen.findByText("Battery use")).toBeInTheDocument();
    expect(screen.getByText("-- %/min")).toBeInTheDocument();
  });

  test("The pitch-line color mode falls back to terrain when invalid and persists when changed", async () => {
    const user = userEvent.setup();

    // An invalid persisted value falls back to terrain.
    localStorage.setItem("voicebox.pitchLineColorMode", "red");
    const invalidRender = render(<AppShell />);
    await user.click(screen.getByLabelText("Open settings"));
    expect(screen.getByRole("radio", { name: "Terrain" })).toBeChecked();
    expect(readPitchLineColorMode()).toBe("terrain");
    invalidRender.unmount();

    // Selecting a mode persists it.
    localStorage.removeItem("voicebox.pitchLineColorMode");
    render(<AppShell />);
    await user.click(screen.getByLabelText("Open settings"));
    await user.click(screen.getByRole("radio", { name: "Orange" }));
    await waitFor(() => {
      expect(readPitchLineColorMode()).toBe("orange");
    });
  });

  test("Developer mode unlocks after four quick taps on the settings heading and can be exited", async () => {
    const user = userEvent.setup();
    const tapTimes = [0, 200, 400, 600];
    vi.spyOn(performance, "now").mockImplementation(() => tapTimes.shift() ?? 600);
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    const headingButton = screen.getByRole("button", { name: "Settings" });

    await user.click(headingButton);
    await user.click(headingButton);
    await user.click(headingButton);
    await user.click(headingButton);

    expect(screen.getByRole("button", { name: "Exit dev mode" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "/debug" })).toHaveAttribute("href", "/debug");
    const smoothingCheckbox = screen.getByRole("checkbox", { name: /Smoothing/i });
    expect(smoothingCheckbox).toBeChecked();
    expect(readAppDeveloperMode()).toBe(true);

    await user.click(smoothingCheckbox);
    await waitFor(() => {
      expect(readSmoothing()).toBe(false);
    });

    await user.click(screen.getByRole("button", { name: "Exit dev mode" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Exit dev mode" })).toBeNull();
      expect(readAppDeveloperMode()).toBe(false);
    });
  });

  test("The share button only appears for paused recorder views with captured audio", async () => {
    navigator.share = vi.fn(async () => {});
    navigator.canShare = vi.fn(() => true);

    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    expect(screen.queryByRole("button", { name: /Share paused recording/i })).toBeNull();

    const engine = globalThis.__appRecordingEngineForTests;
    appendRawAudioSamples(engine.rawAudioState, new Float32Array(48_000).fill(0.25));
    engine.setUi({ hasEverRun: true, isWantedRunning: false });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Share paused recording/i })).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Close settings"));
    await user.click(screen.getByRole("button", { name: "Scales" }));
    await user.click(screen.getByLabelText("Open settings"));

    expect(screen.queryByRole("button", { name: /Share paused recording/i })).toBeNull();
  });

  test("Developer mode shows a paused download button in recorder views", async () => {
    const user = userEvent.setup();
    window.showSaveFilePicker = vi.fn();
    render(<AppShell />);

    const engine = globalThis.__appRecordingEngineForTests;
    appendRawAudioSamples(engine.rawAudioState, new Float32Array(48_000).fill(0.25));
    engine.setUi({ hasEverRun: true, isWantedRunning: false });

    await user.click(screen.getByLabelText("Open settings"));
    const headingButton = screen.getByRole("button", { name: "Settings" });
    await user.click(headingButton);
    await user.click(headingButton);
    await user.click(headingButton);
    await user.click(headingButton);
    await user.click(screen.getByLabelText("Close settings"));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Download paused recording/i }),
      ).toBeInTheDocument();
    });

    delete window.showSaveFilePicker;
  });
});
