import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";

describe("App shell", () => {
  test("Opening and closing settings keeps the active view", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole("button", { name: "Pitch" }));
    await user.click(screen.getByLabelText("Open settings"));
    await user.click(screen.getByLabelText("Close settings"));

    const pitchButton = screen.getByRole("button", { name: "Pitch" });
    expect(pitchButton).toHaveAttribute("aria-pressed", "true");
  });
});
