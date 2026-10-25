import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";
import {
  createBaseMicrophoneSession,
  destroyMicrophoneSession,
} from "../../src/Recorder/audioSession.js";

const inputs = [
  { kind: "audioinput", deviceId: "ipad", label: "iPad microphone" },
  { kind: "audioinput", deviceId: "external", label: "Headset microphone" },
];
const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;

beforeEach(() => {
  navigator.mediaDevices.enumerateDevices = vi.fn(async () => inputs);
});

afterEach(() => {
  navigator.mediaDevices.enumerateDevices = originalEnumerateDevices;
});

describe("Microphone selection", () => {
  test("A saved headset microphone overrides automatic selection when capture starts", async () => {
    localStorage.setItem("voicebox.microphoneDeviceId", "external");
    const session = await createBaseMicrophoneSession({ fftSize: 2048 });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: "external" } }),
    });
    destroyMicrophoneSession(session);
  });

  test.each(["OverconstrainedError", "NotFoundError", "NotReadableError"])(
    "An unavailable saved microphone falls back to automatic without forgetting the choice (%s)",
    async (name) => {
      localStorage.setItem("voicebox.microphoneDeviceId", "external");
      navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
        new DOMException("Unavailable", name),
      );
      const session = await createBaseMicrophoneSession({ fftSize: 2048 });
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
        audio: expect.objectContaining({ deviceId: "ipad" }),
      });
      expect(localStorage.getItem("voicebox.microphoneDeviceId")).toBe("external");
      destroyMicrophoneSession(session);
    },
  );

  test("Permission denial is reported without retrying another microphone", async () => {
    localStorage.setItem("voicebox.microphoneDeviceId", "external");
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
      new DOMException("Denied", "NotAllowedError"),
    );
    await expect(createBaseMicrophoneSession({ fftSize: 2048 })).rejects.toHaveProperty(
      "name",
      "NotAllowedError",
    );
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  test("Settings remember a microphone choice and restart active capture with it", async () => {
    vi.stubGlobal(
      "AudioWorkletNode",
      class extends window.AudioWorkletNode {
        constructor() {
          super();
          this.port.postMessage = () => {};
        }
      },
    );
    window.__setForegroundForTests({ visible: true, focused: true });
    const user = userEvent.setup();
    const view = render(<AppShell />);
    const engine = globalThis.__appRecordingEngineForTests;
    await waitFor(() => expect(engine.getUiSnapshot().isAudioRunning).toBe(true));
    await user.click(screen.getByLabelText("Open settings"));
    const select = await screen.findByRole("combobox", { name: "Microphone" });
    await user.selectOptions(select, "external");
    expect(localStorage.getItem("voicebox.microphoneDeviceId")).toBe("external");
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
        audio: expect.objectContaining({ deviceId: { exact: "external" } }),
      });
      expect(engine.getUiSnapshot().isAudioRunning).toBe(true);
    });
    view.unmount();
    render(<AppShell />);
    await user.click(screen.getByLabelText("Open settings"));
    expect(await screen.findByRole("combobox", { name: "Microphone" })).toHaveValue("external");
  });

  test.each(["", "ipad", "external"])(
    "Settings hide the selector with only one microphone regardless of the saved choice (%s)",
    async (savedDeviceId) => {
      localStorage.setItem("voicebox.microphoneDeviceId", savedDeviceId);
      navigator.mediaDevices.enumerateDevices.mockResolvedValue([inputs[0]]);
      const user = userEvent.setup();
      render(<AppShell />);
      await user.click(screen.getByLabelText("Open settings"));
      // Wait for enumeration to settle before checking that nothing is shown.
      await act(async () => {});
      expect(screen.queryByRole("combobox", { name: "Microphone" })).toBeNull();
    },
  );

  test("An unavailable saved choice displays Automatic and can be replaced", async () => {
    localStorage.setItem("voicebox.microphoneDeviceId", "disconnected");
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByLabelText("Open settings"));
    const select = await screen.findByRole("combobox", { name: "Microphone" });
    expect(select).toHaveValue("");
    expect(select.options).toHaveLength(3);
    await user.selectOptions(select, "external");
    expect(localStorage.getItem("voicebox.microphoneDeviceId")).toBe("external");
    await user.selectOptions(select, "");
    expect(localStorage.getItem("voicebox.microphoneDeviceId")).toBe("");
  });

  test("Settings hide the microphone selector until device names become available", async () => {
    navigator.mediaDevices.enumerateDevices.mockResolvedValue(
      inputs.map((input) => ({ ...input, label: "" })),
    );
    const user = userEvent.setup();
    render(<AppShell />);
    await user.click(screen.getByLabelText("Open settings"));
    expect(screen.queryByRole("combobox", { name: "Microphone" })).toBeNull();
    navigator.mediaDevices.enumerateDevices.mockResolvedValue(inputs);
    const engine = globalThis.__appRecordingEngineForTests;
    await act(async () => engine.setUi({ isAudioRunning: true }));
    expect(await screen.findByRole("combobox", { name: "Microphone" })).toBeInTheDocument();
  });
});
