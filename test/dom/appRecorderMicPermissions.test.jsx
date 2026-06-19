import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";

describe("Recorder", () => {
  test("A blocked microphone shows recovery copy instead of the generic first-run button", async () => {
    window.__setForegroundForTests({ visible: true, focused: true });
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    const deniedError = Object.assign(new Error("Permission denied."), {
      name: "NotAllowedError",
    });
    navigator.mediaDevices.getUserMedia = vi.fn(async () => {
      throw deniedError;
    });

    try {
      render(<AppShell />);

      expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(
        screen.getByText(
          "Microphone access is blocked. Allow it in site settings, then try again.",
        ),
      ).toBeInTheDocument();
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});
