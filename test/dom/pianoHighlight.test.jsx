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

test("pressing a key does not trigger sustained playback highlight", async () => {
  render(<Piano/>);
  const c4Key = screen.getByRole("button", {name: "C4"});

  expect(c4Key).not.toHaveClass("bg-sky-400");

  act(() => {
    fireEvent.pointerDown(c4Key);
  });

  expect(playNoteMock).toHaveBeenCalledWith("C4", 0.8, {emitHighlight: false});
  expect(c4Key).not.toHaveClass("bg-sky-400");

  act(() => {
    vi.advanceTimersByTime(1200);
  });
  expect(c4Key).not.toHaveClass("bg-sky-400");
});

test("programmatic played MIDI notes highlight matching piano keys", async () => {
  render(<Piano/>);
  const d2Key = screen.getByRole("button", {name: "D2"});

  expect(d2Key).not.toHaveClass("bg-sky-400");

  await act(async () => {
    await playNote(38, 0.25);
  });

  expect(d2Key).toHaveClass("bg-sky-400");

  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(d2Key).not.toHaveClass("bg-sky-400");
});
