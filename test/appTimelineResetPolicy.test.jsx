import React from "react";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect} from "vitest";
import App from "../src/App.jsx";

test("opening and closing settings does not clear active view", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByRole("button", {name: "Pitch"}));
  await user.click(screen.getByLabelText("Open settings"));
  await user.click(screen.getByLabelText("Close settings"));

  const pitchButton = screen.getByRole("button", {name: "Pitch"});
  expect(pitchButton.className.includes("bg-sky-400")).toBe(true);
});
