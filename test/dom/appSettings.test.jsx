import React from "react";
import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect, vi} from "vitest";
import AppShell from "../../src/AppShell.jsx";
import {
  readAutoPauseOnSilence,
  readHalfResolutionCanvas,
  readPitchLineColorMode,
  readRunAt30Fps,
  readSpectrogramMaxHz,
  readSpectrogramMinHz,
} from "../../src/Recorder/config.js";

test("settings defaults and persistence work via localStorage", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  const autoPauseCheckbox = screen.getByRole("checkbox", {name: /Auto pause on silence/i});
  const runAt30FpsCheckbox = screen.getByRole("checkbox", {name: /Run at 30 FPS/i});
  const halfResolutionCanvasCheckbox = screen.getByRole("checkbox", {name: /Half-resolution canvas/i});

  expect(autoPauseCheckbox).toBeChecked();
  expect(runAt30FpsCheckbox).not.toBeChecked();
  expect(halfResolutionCanvasCheckbox).not.toBeChecked();

  await user.click(runAt30FpsCheckbox);
  expect(runAt30FpsCheckbox).toBeChecked();
  await user.click(halfResolutionCanvasCheckbox);
  expect(halfResolutionCanvasCheckbox).toBeChecked();

  await waitFor(() => {
    expect(readAutoPauseOnSilence()).toBe(true);
    expect(readRunAt30Fps()).toBe(true);
    expect(readHalfResolutionCanvas()).toBe(true);
  });
});

test("spectrogram frequency settings are editable and persisted", async () => {
  render(<AppShell/>);
  fireEvent.click(screen.getByLabelText("Open settings"));
  const minInput = screen.getByLabelText("Spectrogram minimum frequency (Hz)");
  const maxInput = screen.getByLabelText("Spectrogram maximum frequency (Hz)");

  expect(minInput).toHaveValue(readSpectrogramMinHz());
  expect(maxInput).toHaveValue(readSpectrogramMaxHz());
  expect(minInput).not.toHaveAttribute("min");
  expect(minInput).not.toHaveAttribute("max");
  expect(maxInput).not.toHaveAttribute("min");
  expect(maxInput).not.toHaveAttribute("max");

  fireEvent.change(minInput, {target: {value: "55"}});
  fireEvent.change(maxInput, {target: {value: "7200"}});
  fireEvent.blur(minInput);
  fireEvent.blur(maxInput);

  await waitFor(() => {
    expect(readSpectrogramMinHz()).toBe(55);
    expect(readSpectrogramMaxHz()).toBe(7200);
  });
});

test("spectrogram frequency inputs can be cleared while editing and commit on blur", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  const minInput = screen.getByLabelText("Spectrogram minimum frequency (Hz)");

  fireEvent.change(minInput, {target: {value: ""}});
  expect(minInput).toHaveValue(null);

  fireEvent.change(minInput, {target: {value: "65"}});
  fireEvent.blur(minInput);

  await waitFor(() => {
    expect(readSpectrogramMinHz()).toBe(65);
  });
});

test("temporary pitch detector overlay buttons are removed", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  expect(screen.queryByRole("button", {name: "FFT residual"})).toBeNull();
  expect(screen.queryByRole("button", {name: "FFT raw"})).toBeNull();
});

test("temporary window/bin overlay buttons are removed", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

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
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  expect(await screen.findByText("Battery use")).toBeInTheDocument();
  expect(screen.getByText("-- %/min")).toBeInTheDocument();
});

test("battery use shows NA while charging", async () => {
  navigator.getBattery = vi.fn(async () => ({
    level: 0.52,
    charging: true,
  }));

  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  await waitFor(() => {
    expect(screen.getByText("Battery use")).toBeInTheDocument();
    expect(screen.getByText("NA")).toBeInTheDocument();
  });
});

test("battery use shows NA when battery level is unavailable", async () => {
  navigator.getBattery = vi.fn(async () => ({
    level: undefined,
    charging: false,
  }));

  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  await waitFor(() => {
    expect(screen.getByText("Battery use")).toBeInTheDocument();
    expect(screen.getByText("NA")).toBeInTheDocument();
  });
});

test("pitch line color mode persists from settings", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  const orangeRadio = screen.getByRole("radio", {name: "Orange"});
  await user.click(orangeRadio);

  await waitFor(() => {
    expect(readPitchLineColorMode()).toBe("orange");
  });
});

test("invalid persisted pitch line color mode falls back to terrain", async () => {
  localStorage.setItem("voicebox.pitchLineColorMode", "red");
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  const terrainRadio = screen.getByRole("radio", {name: "Terrain"});
  expect(terrainRadio).toBeChecked();
  expect(readPitchLineColorMode()).toBe("terrain");
});

test("settings about link points to the local about page", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByLabelText("Open settings"));
  const aboutLink = screen.getByRole("link", {name: "About"});

  expect(aboutLink).toHaveAttribute("href", "/about");
});
