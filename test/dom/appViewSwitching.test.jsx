import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect} from "vitest";
import AppShell from "../../src/AppShell.jsx";
import {readActiveView, writeActiveView} from "../../src/AppShell/config.js";

test("active view is restored from localStorage and saved on switch", async () => {
  writeActiveView("spectrogram");
  const user = userEvent.setup();
  render(<AppShell/>);

  const pitchButton = screen.getByRole("button", {name: "Pitch"});
  const vibratoButton = screen.getByRole("button", {name: "Vibrato"});
  const spectrogramButton = screen.getByRole("button", {name: "Spectrogram"});
  expect(spectrogramButton).toHaveAttribute("aria-pressed", "true");
  expect(pitchButton).toHaveAttribute("aria-pressed", "false");
  expect(vibratoButton).toHaveAttribute("aria-pressed", "false");

  await user.click(vibratoButton);
  expect(vibratoButton).toHaveAttribute("aria-pressed", "true");
  expect(pitchButton).toHaveAttribute("aria-pressed", "false");
  expect(spectrogramButton).toHaveAttribute("aria-pressed", "false");

  await waitFor(() => {
    expect(readActiveView()).toBe("vibrato");
  });
});

test("switching views redraws the active chart without errors", async () => {
  const user = userEvent.setup();
  render(<AppShell/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  await user.click(screen.getByRole("button", {name: "Spectrogram"}));
  await user.click(screen.getByRole("button", {name: "Vibrato"}));

  expect(screen.getByRole("button", {name: "Vibrato"})).toHaveAttribute("aria-pressed", "true");
});
