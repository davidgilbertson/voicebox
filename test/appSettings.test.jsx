import React from "react";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {test, expect} from "vitest";
import App from "../src/App.jsx";

test("settings defaults and persistence work via localStorage", async () => {
  const user = userEvent.setup();
  render(<App/>);

  await user.click(screen.getByLabelText("Open settings"));
  const autoPauseCheckbox = screen.getByRole("checkbox", {name: /Auto pause on silence/i});
  const showStatsCheckbox = screen.getByRole("checkbox", {name: /Show stats/i});

  expect(autoPauseCheckbox).toBeChecked();
  expect(showStatsCheckbox).not.toBeChecked();

  await user.click(showStatsCheckbox);
  expect(showStatsCheckbox).toBeChecked();

  await waitFor(() => {
    expect(localStorage.getItem("voicebox.showStats")).toBe("true");
    expect(localStorage.getItem("voicebox.autoPauseOnSilence")).toBe("true");
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
