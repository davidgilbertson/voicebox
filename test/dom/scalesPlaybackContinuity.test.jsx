import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import ScalesPage from "../../src/ScalesPage/ScalesPage.jsx";
import { PlaybackEngine } from "../../src/ScalesPage/PlaybackEngine.js";
import { createPlaybackEngineConfig } from "../utils/engineConfig.js";

const playNoteMock = vi.fn(async () => ({ stop: vi.fn() }));
const playMetronomeTickMock = vi.fn(async () => {});

vi.mock("../../src/ScalesPage/piano.js", () => ({
  ensurePianoLoaded: vi.fn(async () => ({})),
  ensureMetronomeTickLoaded: vi.fn(async () => null),
  ensurePianoReadyForPlayback: vi.fn(async () => true),
  playNote: (...args) => playNoteMock(...args),
  playMetronomeTick: (...args) => playMetronomeTickMock(...args),
  subscribeToPlayedNotes: () => () => {},
}));

beforeEach(() => {
  window.__setForegroundForTests({ visible: true, focused: true });
  playNoteMock.mockClear();
  playMetronomeTickMock.mockClear();
  vi.useFakeTimers();
});

async function waitForReady() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  act(() => {
    vi.advanceTimersByTime(0);
  });
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
}

function renderScales(props) {
  const { scaleMinNote, scaleMaxNote, keepRunningInBackground, isForeground, ...pageProps } = props ?? {};
  const engine = new PlaybackEngine({
    ...createPlaybackEngineConfig(),
    ...(scaleMinNote ? { scaleMinNote } : {}),
    ...(scaleMaxNote ? { scaleMaxNote } : {}),
    ...(typeof keepRunningInBackground === "boolean" ? { keepRunningInBackground } : {}),
    ...(typeof isForeground === "boolean" ? { isForeground } : {}),
  });
  return render(
    <ScalesPage
      engine={engine}
      scaleMinNote={scaleMinNote}
      scaleMaxNote={scaleMaxNote}
      keepRunningInBackground={keepRunningInBackground}
      isForeground={isForeground}
      {...pageProps}
    />,
  );
}

test("changing BPM while playing applies on the next pulse", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(260);
  });
  expect(playNoteMock).toHaveBeenCalledTimes(1);
  expect(playNoteMock.mock.calls[0][0]).toBe(48);

  for (let i = 0; i < 30; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: "Increase scales BPM" }));
  }

  await act(async () => {
    await vi.advanceTimersByTimeAsync(430);
  });
  expect(playNoteMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(playNoteMock.mock.calls[1][0]).toBe(48);
});

test("pause and resume restarts the current set from the cue note", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(playNoteMock.mock.calls.slice(0, 3).map((args) => args[0])).toEqual([48, 48, 49]);

  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(playNoteMock.mock.calls[3][0]).toBe(48);
});

test("pressing a piano key while playing restarts the set from that root", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  const callsBeforePress = playNoteMock.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "C4" }));

  expect(playNoteMock.mock.calls.length).toBe(callsBeforePress + 2);
  expect(playNoteMock.mock.calls[callsBeforePress][0]).toBe("C4");
  expect(playNoteMock.mock.calls[callsBeforePress + 1][0]).toBe(60);
});

test("pressing a piano key too high for the selected pattern is ignored for set restart", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  const callsBeforePress = playNoteMock.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "E4" }));

  expect(playNoteMock.mock.calls.length).toBe(callsBeforePress + 1);
  expect(playNoteMock.mock.calls[callsBeforePress][0]).toBe("E4");
});

test("metronome ticks while scales playback is stopped", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Enable metronome" }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });

  expect(playMetronomeTickMock.mock.calls.length).toBeGreaterThan(0);
  expect(playNoteMock).not.toHaveBeenCalled();
  for (const call of playMetronomeTickMock.mock.calls) {
    expect(call).toHaveLength(0);
  }
});

test("slow first metronome tick does not trigger immediate catch-up tick", async () => {
  playMetronomeTickMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        window.setTimeout(resolve, 500);
      }),
  );
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Enable metronome" }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(playMetronomeTickMock).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(playMetronomeTickMock.mock.calls.length).toBeGreaterThan(1);
});

test("metronome shares the scales pulse loop and ducks on simultaneous notes", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  fireEvent.click(screen.getByRole("button", { name: "Enable metronome" }));
  expect(playMetronomeTickMock).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(playNoteMock).toHaveBeenCalledTimes(1);
  expect(playMetronomeTickMock.mock.calls.length).toBeGreaterThan(0);
  expect(playMetronomeTickMock.mock.calls[0][0]).toEqual({ duck: true });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  expect(playMetronomeTickMock.mock.calls.length).toBeGreaterThan(1);
  expect(playMetronomeTickMock.mock.calls.some((call) => call.length === 0)).toBe(true);
});

test("scales playback and metronome pause in background and resume in foreground", async () => {
  const engine = new PlaybackEngine(createPlaybackEngineConfig());
  render(
    <ScalesPage
      engine={engine}
      scaleMinNote="C3"
      scaleMaxNote="E4"
      keepRunningInBackground={false}
      isForeground={true}
    />,
  );
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Enable metronome" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  const notesBeforeBackground = playNoteMock.mock.calls.length;
  const ticksBeforeBackground = playMetronomeTickMock.mock.calls.length;
  expect(notesBeforeBackground).toBeGreaterThan(0);
  expect(ticksBeforeBackground).toBeGreaterThan(0);

  engine.updateSettings({ keepRunningInBackground: false, isForeground: false });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  expect(playNoteMock.mock.calls.length).toBe(notesBeforeBackground);
  expect(playMetronomeTickMock.mock.calls.length).toBe(ticksBeforeBackground);

  engine.updateSettings({ keepRunningInBackground: false, isForeground: true });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  expect(playNoteMock.mock.calls.length).toBeGreaterThan(notesBeforeBackground);
  expect(playMetronomeTickMock.mock.calls.length).toBeGreaterThan(ticksBeforeBackground);
});

test("repeat-up bounces before a set would exceed the top note", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "E3" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(16000);
  });

  const cueRoots = playNoteMock.mock.calls
    .filter(([, duration]) => duration > 0.4)
    .map(([midi]) => midi);

  expect(cueRoots.length).toBeGreaterThanOrEqual(3);
  expect(cueRoots.slice(0, 3)).toEqual([48, 48, 48]);
});

test("changing to a taller scale lowers the root enough to keep the pattern in range", async () => {
  renderScales({ scaleMinNote: "C3", scaleMaxNote: "C4" });
  await waitForReady();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });

  fireEvent.click(screen.getByRole("button", { name: "A3" }));

  const cueRootsBeforeSwitch = playNoteMock.mock.calls
    .filter(([, duration]) => duration > 0.4)
    .map(([midi]) => midi);

  fireEvent.change(screen.getByRole("combobox", { name: "Scale pattern" }), {
    target: { value: "Major" },
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1300);
  });

  const cueRoots = playNoteMock.mock.calls
    .filter(([, duration]) => duration > 0.4)
    .map(([midi]) => midi);
  const cueRootsAfterSwitch = cueRoots.slice(cueRootsBeforeSwitch.length);

  expect(cueRootsAfterSwitch[0]).toBe(48);
});
