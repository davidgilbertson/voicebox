import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { writeActiveView } from "../../src/AppShell/config.js";

const { playNoteMock } = vi.hoisted(() => ({
  playNoteMock: vi.fn(async () => ({ stop: vi.fn() })),
}));

vi.mock("../../src/ScalesPage/piano.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ensurePianoLoaded: vi.fn(async () => ({})),
    ensureMetronomeTickLoaded: vi.fn(async () => null),
    playNote: (...args) => playNoteMock(...args),
  };
});

import AppShell from "../../src/AppShell.jsx";

beforeEach(() => {
  playNoteMock.mockClear();
  vi.useFakeTimers();
});

test("scales playback continues while viewing recorder pages", async () => {
  window.__setForegroundForTests({ visible: true, focused: true });
  writeActiveView("scales");
  render(<AppShell />);

  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(playNoteMock.mock.calls.length).toBeGreaterThan(0);
  const callsBeforeSwitch = playNoteMock.mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "Pitch" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });

  expect(playNoteMock.mock.calls.length).toBeGreaterThan(callsBeforeSwitch);
});
