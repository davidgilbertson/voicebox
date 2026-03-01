import React from "react";
import {render, screen} from "@testing-library/react";
import {test, expect} from "vitest";
import AboutPage from "../../src/AboutPage.jsx";

test("about page shows app entry action", () => {
  render(<AboutPage/>);

  expect(screen.getByRole("heading", {name: "Voicebox"})).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "Scales"})).toBeInTheDocument();
  expect(screen.getByRole("heading", {name: "Settings"})).toBeInTheDocument();
  expect(screen.getByRole("img", {name: "Scales page screenshot"})).toHaveAttribute("src", "/images/ScalesPage.png");
  expect(screen.getByRole("img", {name: "Spectrogram page screenshot"})).toHaveAttribute(
    "src",
    "/images/SpectrogramPage.png"
  );
  expect(screen.getByRole("img", {name: "Pitch page screenshot"})).toHaveAttribute("src", "/images/PitchPage.png");
  expect(screen.getByRole("img", {name: "Vibrato page screenshot"})).toHaveAttribute("src", "/images/VibratoPage.png");
  expect(screen.getByRole("img", {name: "Settings page screenshot"})).toHaveAttribute("src", "/images/SettingsPage.png");
  expect(screen.getByRole("link", {name: "Open Voicebox"})).toHaveAttribute("href", "/");
});
