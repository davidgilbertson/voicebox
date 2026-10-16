import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";

describe("Recorder pages", () => {
  test("Tapping the chart pauses and resumes recording, and the paused pill shows a pause icon", async () => {
    const originalAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class AudioWorkletNodeWithPostMessage {
      constructor() {
        this.port = {
          onmessage: null,
          postMessage: () => {},
        };
      }

      connect() {}

      disconnect() {}
    };
    window.__setForegroundForTests({ visible: true, focused: true });
    try {
      render(<AppShell />);

      const area = await screen.findByTestId("recorder-chart-area");
      fireEvent.pointerDown(area, {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        pointerType: "touch",
      });

      const pausedPill = await screen.findByRole("status");
      expect(pausedPill).toHaveTextContent("Paused");
      expect(pausedPill.querySelector("svg.lucide-pause")).not.toBeNull();

      fireEvent.pointerDown(area, {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        pointerType: "touch",
      });

      await waitFor(() => {
        expect(screen.queryByRole("status")).toBeNull();
      });
    } finally {
      window.AudioWorkletNode = originalAudioWorkletNode;
    }
  });
});
