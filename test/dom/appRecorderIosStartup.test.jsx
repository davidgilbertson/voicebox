import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";

describe("Recorder pages", () => {
  test("Manual start overlay is shown before the first microphone request when permission is only prompted", async () => {
    window.__setForegroundForTests({ visible: true, focused: true });
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    const originalPermissions = navigator.permissions;
    const stopTrack = vi.fn();

    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({ state: "prompt" })),
      },
    });
    navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
      getAudioTracks: () => [{ stop: stopTrack }],
      getTracks() {
        return this.getAudioTracks();
      },
    }));

    try {
      render(<AppShell />);

      expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
      expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Start" }));

      await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: originalPermissions,
      });
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});
