import React from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {beforeEach, expect, test, vi} from "vitest";
import ScalesPage from "../../src/ScalesPage/ScalesPage.jsx";

const playNoteMock = vi.fn(async () => ({stop: vi.fn()}));
const playMetronomeTickMock = vi.fn(async () => {});

vi.mock("../../src/ScalesPage/piano.js", () => ({
  ensurePianoLoaded: vi.fn(async () => ({})),
  ensurePianoReadyForPlayback: vi.fn(async () => true),
  playNote: (...args) => playNoteMock(...args),
  playMetronomeTick: (...args) => playMetronomeTickMock(...args),
  subscribeToPlayedNotes: () => () => {
  },
}));

beforeEach(() => {
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
  expect(screen.getByRole("button", {name: "Play"})).toBeEnabled();
}

test("changing BPM while playing does not restart at the base note", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();

  fireEvent.click(screen.getByRole("button", {name: "Play"}));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  expect(playNoteMock.mock.calls.slice(0, 2).map((args) => args[0])).toEqual([48, 48]);

  fireEvent.click(screen.getByRole("button", {name: "Increase scales BPM"}));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(playNoteMock.mock.calls[2][0]).toBe(49);
});

test("pause and resume restarts the current set from the cue note", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();

  fireEvent.click(screen.getByRole("button", {name: "Play"}));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(playNoteMock.mock.calls.slice(0, 3).map((args) => args[0])).toEqual([48, 48, 49]);

  fireEvent.click(screen.getByRole("button", {name: "Pause"}));
  fireEvent.click(screen.getByRole("button", {name: "Play"}));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(playNoteMock.mock.calls[3][0]).toBe(48);
});

test("metronome ticks while scales playback is stopped", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();

  fireEvent.click(screen.getByRole("button", {name: "Enable metronome"}));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });

  expect(playMetronomeTickMock.mock.calls.length).toBeGreaterThan(0);
  expect(playNoteMock).not.toHaveBeenCalled();
  for (const call of playMetronomeTickMock.mock.calls) {
    expect(call).toHaveLength(0);
  }
});
