import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect } from "vitest";
import AppShell from "../../src/AppShell.jsx";
import { writeActiveView } from "../../src/AppShell/config.js";
import { readScaleBpm, readScaleMinNote, SCALE_BPM_DEFAULT } from "../../src/ScalesPage/config.js";

test("scales page does not mount recorder controls", async () => {
  writeActiveView("scales");
  render(<AppShell />);

  expect(screen.getByRole("combobox", { name: "Scale pattern" })).toHaveValue("Semitones");
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enable metronome" })).toBeInTheDocument();
  expect(screen.getByLabelText("Open settings")).toBeEnabled();
});

test("scales bpm controls use large size and desktop alignment classes", async () => {
  writeActiveView("scales");
  render(<AppShell />);

  const decrementBpmButton = screen.getByRole("button", {
    name: "Decrease scales BPM",
  });
  const playButton = screen.getByRole("button", { name: "Play" });
  const metronomeButton = screen.getByRole("button", {
    name: "Enable metronome",
  });
  const scalePatternSelect = screen.getByRole("combobox", {
    name: "Scale pattern",
  });
  expect(decrementBpmButton.parentElement).toHaveClass("h-16");
  expect(screen.getByText("BPM")).toBeInTheDocument();
  expect(scalePatternSelect).toHaveClass("h-16");
  expect(scalePatternSelect).toHaveClass("w-full");
  expect(metronomeButton).toHaveClass("h-16");
  expect(metronomeButton).toHaveClass("w-16");
  expect(metronomeButton).toHaveClass("ml-auto");
  expect(metronomeButton).toHaveClass("md:ml-0");
  expect(playButton).toHaveClass("h-16");
});

test("scales bpm persists", async () => {
  writeActiveView("scales");
  const user = userEvent.setup();
  render(<AppShell />);

  expect(readScaleBpm()).toBe(SCALE_BPM_DEFAULT);
  expect(screen.getByText(String(SCALE_BPM_DEFAULT))).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Increase scales BPM" }));

  await waitFor(() => {
    expect(readScaleBpm()).toBe(SCALE_BPM_DEFAULT + 10);
  });
});

test("scales minimum note can be changed from settings", async () => {
  writeActiveView("scales");
  const user = userEvent.setup();
  render(<AppShell />);

  await user.click(screen.getByLabelText("Open settings"));
  await waitFor(() => {
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: "Increase scales minimum" }));

  await waitFor(() => {
    expect(readScaleMinNote()).toBe("A#2");
  });
});

test("settings opens from scales page without manually switching pages", async () => {
  writeActiveView("scales");
  const user = userEvent.setup();
  render(<AppShell />);

  await user.click(screen.getByLabelText("Open settings"));

  await waitFor(() => {
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});

test("gesture help panel can be dismissed and stays dismissed", async () => {
  writeActiveView("scales");
  const user = userEvent.setup();
  const { unmount } = render(<AppShell />);

  expect(
    screen.getByText(/use gestures to control what happens when the scale repeats/i),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Got it" }));
  expect(
    screen.queryByText(/use gestures to control what happens when the scale repeats/i),
  ).toBeNull();

  unmount();
  render(<AppShell />);
  expect(
    screen.queryByText(/use gestures to control what happens when the scale repeats/i),
  ).toBeNull();
});
