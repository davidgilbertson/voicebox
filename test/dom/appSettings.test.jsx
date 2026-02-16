import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect, vi} from "vitest";
import App, {
  AUTO_PAUSE_ON_SILENCE_STORAGE_KEY,
  HALF_RESOLUTION_CANVAS_STORAGE_KEY,
  RUN_AT_30_FPS_STORAGE_KEY,
  SHOW_STATS_STORAGE_KEY,
  SPECTROGRAM_MAX_HZ_DEFAULT,
  SPECTROGRAM_MIN_HZ_DEFAULT,
} from "../../src/App.jsx";

test("settings defaults and persistence work via localStorage", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByLabelText("Open settings"));
  const autoPauseCheckbox = screen.getByRole("checkbox", {name: /Auto pause on silence/i});
  const showStatsCheckbox = screen.getByRole("checkbox", {name: /Show stats/i});
  const runAt30FpsCheckbox = screen.getByRole("checkbox", {name: /Run at 30 FPS/i});
  const halfResolutionCanvasCheckbox = screen.getByRole("checkbox", {name: /Half-resolution canvas/i});

  expect(autoPauseCheckbox).toBeChecked();
  expect(showStatsCheckbox).not.toBeChecked();
  expect(runAt30FpsCheckbox).not.toBeChecked();
  expect(halfResolutionCanvasCheckbox).not.toBeChecked();

  await user.click(showStatsCheckbox);
  expect(showStatsCheckbox).toBeChecked();
  await user.click(runAt30FpsCheckbox);
  expect(runAt30FpsCheckbox).toBeChecked();
  await user.click(halfResolutionCanvasCheckbox);
  expect(halfResolutionCanvasCheckbox).toBeChecked();

  await waitFor(() => {
    expect(localStorage.getItem(SHOW_STATS_STORAGE_KEY)).toBe("true");
    expect(localStorage.getItem(AUTO_PAUSE_ON_SILENCE_STORAGE_KEY)).toBe("true");
    expect(localStorage.getItem(RUN_AT_30_FPS_STORAGE_KEY)).toBe("true");
    expect(localStorage.getItem(HALF_RESOLUTION_CANVAS_STORAGE_KEY)).toBe("true");
  });
});

test("spectrogram frequency settings are editable and persisted", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByLabelText("Open settings"));
  const minInput = screen.getByLabelText("Spectrogram minimum frequency (Hz)");
  const maxInput = screen.getByLabelText("Spectrogram maximum frequency (Hz)");

  expect(minInput).toHaveValue(SPECTROGRAM_MIN_HZ_DEFAULT);
  expect(maxInput).toHaveValue(SPECTROGRAM_MAX_HZ_DEFAULT);
  expect(minInput).not.toHaveAttribute("min");
  expect(minInput).not.toHaveAttribute("max");
  expect(maxInput).not.toHaveAttribute("min");
  expect(maxInput).not.toHaveAttribute("max");

  fireEvent.change(minInput, {target: {value: "55"}});
  fireEvent.change(maxInput, {target: {value: "7200"}});

  await waitFor(() => {
    expect(localStorage.getItem("voicebox.spectrogramMinHz")).toBe("55");
    expect(localStorage.getItem("voicebox.spectrogramMaxHz")).toBe("7200");
  });
});

test("enabling show stats displays stats panel", async () => {
  const user = userEvent.setup();
  render(<App/>);

  expect(screen.queryByText(/Data:/)).toBeNull();
  await user.click(screen.getByLabelText("Open settings"));
  await user.click(screen.getByRole("checkbox", {name: /Show stats/i}));

  expect(await screen.findByText(/Data:/)).toBeInTheDocument();
});

test("temporary pitch detector overlay buttons are removed", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  expect(screen.queryByRole("button", {name: "FFT residual"})).toBeNull();
  expect(screen.queryByRole("button", {name: "FFT raw"})).toBeNull();
});

test("temporary window/bin overlay buttons are removed", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  expect(screen.queryByRole("button", {name: "WINDOW_SIZE 4096"})).toBeNull();
  expect(screen.queryByRole("button", {name: "SPECTROGRAM_BINS 8192"})).toBeNull();
});

test("battery use shows -- in the first minute", async () => {
  const battery = {
    level: 0.8,
    charging: false,
  };
  navigator.getBattery = vi.fn(async () => battery);

  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByLabelText("Open settings"));
  expect(await screen.findByText("Battery use")).toBeInTheDocument();
  expect(screen.getByText("-- %/min")).toBeInTheDocument();
});

test("battery use is hidden while charging", async () => {
  navigator.getBattery = vi.fn(async () => ({
    level: 0.52,
    charging: true,
  }));

  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByLabelText("Open settings"));
  await waitFor(() => {
    expect(screen.queryByText("Battery use")).toBeNull();
  });
});

test("battery use is hidden when battery level is unavailable", async () => {
  navigator.getBattery = vi.fn(async () => ({
    level: undefined,
    charging: false,
  }));

  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByLabelText("Open settings"));
  await waitFor(() => {
    expect(screen.queryByText("Battery use")).toBeNull();
  });
});
