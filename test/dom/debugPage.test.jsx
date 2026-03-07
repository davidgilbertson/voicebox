import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import DebugPage from "../../src/debug/DebugPage.jsx";

test("debug page starts capture and shows live level readouts", async () => {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  const originalGetSupportedConstraints = navigator.mediaDevices.getSupportedConstraints;
  const stopTrack = vi.fn();
  navigator.mediaDevices.getSupportedConstraints = vi.fn(() => ({
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
    latency: true,
  }));
  navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
    getAudioTracks: () => [
      {
        stop: stopTrack,
        getConstraints: () => ({
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: true,
          latency: 0.1,
        }),
        getSettings: () => ({
          sampleRate: 48_000,
          autoGainControl: false,
          echoCancellation: false,
        }),
      },
    ],
    getTracks() {
      return this.getAudioTracks();
    },
  }));

  const originalAudioContext = window.AudioContext;
  window.AudioContext = class DebugAudioContext {
    constructor() {
      this.sampleRate = 48_000;
      this.state = "running";
    }

    async resume() {}

    async close() {
      this.state = "closed";
    }

    createMediaStreamSource() {
      return {
        connect() {},
      };
    }

    createAnalyser() {
      return {
        fftSize: 2048,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(array) {
          array.fill(0);
          array[0] = 0.5;
          array[1] = -0.25;
        },
      };
    }
  };

  try {
    render(<DebugPage />);

    fireEvent.click(screen.getByRole("button", { name: "Start capture" }));

    expect(await screen.findByRole("button", { name: "Restart capture" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("peak-value")).not.toHaveTextContent("0.0000");
      expect(screen.getByTestId("rms-value")).not.toHaveTextContent("0.0000");
    });
    expect(screen.getByText(/^Min$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Current$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Max$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Raw abs$/i)).toBeInTheDocument();
    expect(screen.getByText(/^RMS$/i)).toBeInTheDocument();
    expect(screen.getByText(/Supported Constraints/i)).toBeInTheDocument();
    expect(screen.getByText(/Track Settings/i)).toBeInTheDocument();
    expect(screen.getAllByText(/"autoGainControl": false/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/"echoCancellation": false/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^latency$/i).length).toBeGreaterThan(0);
  } finally {
    window.AudioContext = originalAudioContext;
    navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    navigator.mediaDevices.getSupportedConstraints = originalGetSupportedConstraints;
  }
});
