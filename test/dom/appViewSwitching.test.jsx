import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect} from "vitest";
import App, {ACTIVE_VIEW_STORAGE_KEY} from "../../src/App.jsx";

test("active view is restored from localStorage and saved on switch", async () => {
  localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, "spectrogram");
  const user = userEvent.setup();
  render(<App/>);

  const pitchButton = screen.getByRole("button", {name: "Pitch"});
  const vibratoButton = screen.getByRole("button", {name: "Vibrato"});
  const spectrogramButton = screen.getByRole("button", {name: "Spectrogram"});
  expect(spectrogramButton).toHaveClass("bg-sky-400");
  expect(pitchButton).not.toHaveClass("bg-sky-400");
  expect(vibratoButton).not.toHaveClass("bg-sky-400");

  await user.click(vibratoButton);
  expect(vibratoButton).toHaveClass("bg-sky-400");

  await waitFor(() => {
    expect(localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY)).toBe("vibrato");
  });
});

test("switching views redraws the active chart without errors", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  await user.click(screen.getByRole("button", {name: "Spectrogram"}));
  await user.click(screen.getByRole("button", {name: "Vibrato"}));

  expect(screen.getByRole("button", {name: "Vibrato"})).toHaveClass("bg-sky-400");
});
