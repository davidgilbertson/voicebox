import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";

describe("App shell", () => {
  test("The update banner is hidden by default", () => {
    render(<AppShell />);

    expect(screen.getByTestId("sw-update-banner")).toHaveClass("-translate-y-full");
    expect(screen.getByText("Downloading a new version")).toBeInTheDocument();
  });

  test("The update banner is shown while a new version downloads", () => {
    render(<AppShell downloadingUpdate />);

    expect(screen.getByTestId("sw-update-banner")).toHaveClass("translate-y-0");
    expect(screen.getByText("Downloading a new version")).toBeInTheDocument();
  });
});
