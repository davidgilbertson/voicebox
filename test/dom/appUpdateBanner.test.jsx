import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";

describe("App shell", () => {
  test("The update banner shows when a new version is downloading", () => {
    const { rerender } = render(<AppShell />);
    expect(screen.getByTestId("sw-update-banner")).toHaveClass("-translate-y-full");

    rerender(<AppShell downloadingUpdate />);
    expect(screen.getByTestId("sw-update-banner")).toHaveClass("translate-y-0");
    expect(screen.getByText("Downloading a new version")).toBeInTheDocument();
  });
});
