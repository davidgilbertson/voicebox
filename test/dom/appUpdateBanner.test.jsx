import React from "react";
import {render, screen} from "@testing-library/react";
import {expect, test} from "vitest";
import AppShell from "../../src/AppShell.jsx";

test("update banner is hidden by default", () => {
  render(<AppShell/>);

  expect(screen.getByTestId("sw-update-banner")).toHaveClass("-translate-y-full");
  expect(screen.getByText("Downloading a new version")).toBeInTheDocument();
});

test("update banner is shown while a new version downloads", () => {
  render(<AppShell downloadingUpdate/>);

  expect(screen.getByTestId("sw-update-banner")).toHaveClass("translate-y-0");
  expect(screen.getByText("Downloading a new version")).toBeInTheDocument();
});
