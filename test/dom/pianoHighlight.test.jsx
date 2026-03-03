import React from "react";
import {act, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, expect, test, vi} from "vitest";
import Piano from "../../src/ScalesPage/Piano.jsx";
import {playNote} from "../../src/ScalesPage/piano.js";

const listeners = new Set();
const playNoteMock = vi.fn(async (note, durationSeconds, options = {}) => {
  if (options.emitHighlight !== false) {
    for (const listener of listeners) {
      listener({note, durationSeconds});
    }
  }
  return {stop: vi.fn()};
});

vi.mock("../../src/ScalesPage/piano.js", () => ({
  playNote: (...args) => playNoteMock(...args),
  subscribeToPlayedNotes: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
}));

beforeEach(() => {
  playNoteMock.mockClear();
  listeners.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("pressing a key triggers playback highlight while the note sounds", async () => {
  render(<Piano/>);
  const c4Key = screen.getByRole("button", {name: "C4"});
  const c4Overlay = document.getElementById("piano-key-C4");
  expect(c4Overlay).toBeTruthy();
  const overlayAnimate = vi.fn();
  c4Overlay.animate = overlayAnimate;

  act(() => {
    fireEvent.click(c4Key);
  });

  expect(playNoteMock).toHaveBeenCalledWith("C4", 0.8);
  expect(overlayAnimate).toHaveBeenCalledWith(
      [
        {opacity: 1, offset: 0},
        {opacity: 0, offset: 0.05},
        {opacity: 0.5, offset: 0.95},
        {opacity: 1, offset: 1},
      ],
      {
        duration: 800,
        easing: "linear",
        fill: "none",
      },
  );
});

test("programmatic played MIDI notes highlight matching piano keys", async () => {
  render(<Piano/>);
  const d2Overlay = document.getElementById("piano-key-D2");
  expect(d2Overlay).toBeTruthy();
  const overlayAnimate = vi.fn();
  d2Overlay.animate = overlayAnimate;

  await act(async () => {
    await playNote(38, 0.25);
  });

  expect(overlayAnimate).toHaveBeenCalledWith(
      [
        {opacity: 1, offset: 0},
        {opacity: 0, offset: 0.05},
        {opacity: 0.5, offset: 0.95},
        {opacity: 1, offset: 1},
      ],
      {
        duration: 250,
        easing: "linear",
        fill: "none",
      },
  );
});
