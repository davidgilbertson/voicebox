import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect} from "vitest";
import App from "../src/App.jsx";

test("active view is restored from localStorage and saved on switch", async () => {
  localStorage.setItem("voicebox.activeView", "pitch");
  const user = userEvent.setup();
  render(<App/>);

  const pitchButton = screen.getByRole("button", {name: "Pitch"});
  const vibratoButton = screen.getByRole("button", {name: "Vibrato"});
  expect(pitchButton.className.includes("bg-sky-400")).toBe(true);
  expect(vibratoButton.className.includes("bg-sky-400")).toBe(false);

  await user.click(vibratoButton);
  expect(vibratoButton.className.includes("bg-sky-400")).toBe(true);

  await waitFor(() => {
    expect(localStorage.getItem("voicebox.activeView")).toBe("vibrato");
  });
});

test("switching views redraws the active chart without errors", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  await user.click(screen.getByRole("button", {name: "Vibrato"}));

  expect(screen.getByRole("button", {name: "Vibrato"}).className.includes("bg-sky-400")).toBe(true);
});
