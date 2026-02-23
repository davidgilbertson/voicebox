import React from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {beforeEach, expect, test, vi} from "vitest";
import ScalesPage from "../../src/ScalesPage/ScalesPage.jsx";

const playNoteMock = vi.fn(async () => ({stop: vi.fn()}));

vi.mock("../../src/ScalesPage/piano.js", () => ({
  ensurePianoLoaded: vi.fn(async () => ({})),
  ensurePianoReadyForPlayback: vi.fn(async () => true),
  playNote: (...args) => playNoteMock(...args),
  playMetronomeTick: vi.fn(async () => {}),
  subscribeToPlayedNotes: () => () => {},
}));

beforeEach(() => {
  playNoteMock.mockClear();
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

test.each([
  {pattern: "Semitones", firstNotes: [48, 48, 49, 50, 51, 52]},
  {pattern: "Pentatonic", firstNotes: [48, 48, 50, 52, 55, 57]},
  {pattern: "Major", firstNotes: [48, 48, 50, 52, 53, 55]},
  {pattern: "2 Up 1 Down", firstNotes: [48, 48, 50, 49, 51, 50]},
])("plays expected opening notes for $pattern pattern", async ({pattern, firstNotes}) => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();

  fireEvent.change(screen.getByRole("combobox", {name: "Scale pattern"}), {
    target: {value: pattern},
  });
  fireEvent.click(screen.getByRole("button", {name: "Play"}));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2200);
  });

  expect(playNoteMock.mock.calls.length).toBeGreaterThanOrEqual(firstNotes.length);
  expect(playNoteMock.mock.calls.slice(0, firstNotes.length).map((args) => args[0])).toEqual(firstNotes);
});
