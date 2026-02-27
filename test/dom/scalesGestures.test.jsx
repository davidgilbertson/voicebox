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

function swipe(area, {startX, startY, endX, endY, pointerId = 1}) {
  fireEvent.pointerDown(area, {pointerId, clientX: startX, clientY: startY});
  fireEvent.pointerMove(area, {pointerId, clientX: endX, clientY: endY});
  fireEvent.pointerUp(area, {pointerId, clientX: endX, clientY: endY});
}

function tap(area, {x = 200, y = 200, pointerId = 1} = {}) {
  fireEvent.pointerDown(area, {pointerId, clientX: x, clientY: y});
  fireEvent.pointerUp(area, {pointerId, clientX: x, clientY: y});
}

beforeEach(() => {
  window.__setForegroundForTests({visible: true, focused: true});
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

test("right swipe shows right-direction gesture feedback", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");
  fireEvent.click(screen.getByRole("button", {name: "Got it"}));

  swipe(area, {startX: 100, startY: 200, endX: 320, endY: 200});
  expect(area.querySelector("svg.lucide-arrow-right")).not.toBeNull();
});

test("up swipe shows up-direction gesture feedback", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");
  fireEvent.click(screen.getByRole("button", {name: "Got it"}));

  swipe(area, {startX: 220, startY: 360, endX: 220, endY: 120});
  expect(area.querySelector("svg.lucide-arrow-up")).not.toBeNull();
});

test("down swipe shows down-direction gesture feedback", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");
  fireEvent.click(screen.getByRole("button", {name: "Got it"}));

  swipe(area, {startX: 220, startY: 120, endX: 220, endY: 360});
  expect(area.querySelector("svg.lucide-arrow-down")).not.toBeNull();
});

test("auto reversal at top of range shows down-direction gesture feedback", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="C#3"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");
  fireEvent.click(screen.getByRole("button", {name: "Got it"}));
  fireEvent.click(screen.getByRole("button", {name: "Play"}));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(11000);
  });
  expect(area.querySelector("svg.lucide-arrow-down")).not.toBeNull();
});

test("left swipe does nothing and tap on empty area toggles play/pause", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");

  swipe(area, {startX: 320, startY: 220, endX: 80, endY: 220});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  tap(area);
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(playNoteMock.mock.calls.length).toBeGreaterThan(0);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(25000);
  });
  expect(playNoteMock.mock.calls.length).toBeGreaterThan(18);
  expect(playNoteMock.mock.calls[18][0]).toBe(49);

  tap(area);
  const pausedCalls = playNoteMock.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(playNoteMock.mock.calls.length).toBe(pausedCalls);
});

test("swiping the same vertical direction twice mid-set starts a new set immediately", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");
  fireEvent.click(screen.getByRole("button", {name: "Play"}));
  await act(async () => {
    await Promise.resolve();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
  const callsBeforeSwipe = playNoteMock.mock.calls.length;

  swipe(area, {startX: 220, startY: 360, endX: 220, endY: 120});
  const callsAfterFirstUp = playNoteMock.mock.calls.length;

  swipe(area, {startX: 220, startY: 360, endX: 220, endY: 120});
  const callsAfterSecondUp = playNoteMock.mock.calls.length;

  expect(callsAfterFirstUp).toBe(callsBeforeSwipe);
  expect(callsAfterSecondUp).toBe(callsAfterFirstUp + 1);
  expect(playNoteMock.mock.calls[callsAfterSecondUp - 1][0]).toBe(49);
});

test("fast pointer swipe without move event does not toggle play", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();
  const area = screen.getByTestId("scales-gesture-area");

  fireEvent.pointerDown(area, {pointerId: 1, clientX: 100, clientY: 200});
  fireEvent.pointerUp(area, {pointerId: 1, clientX: 340, clientY: 200});
  fireEvent.click(area);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });

  expect(playNoteMock).not.toHaveBeenCalled();
});

test("tap on help button does not toggle play", async () => {
  render(<ScalesPage scaleMinNote="C3" scaleMaxNote="E4"/>);
  await waitForReady();

  fireEvent.pointerDown(screen.getByRole("button", {name: "Got it"}), {pointerId: 1, clientX: 100, clientY: 200});
  fireEvent.pointerUp(screen.getByRole("button", {name: "Got it"}), {pointerId: 1, clientX: 100, clientY: 200});
  fireEvent.click(screen.getByRole("button", {name: "Got it"}));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });

  expect(playNoteMock).not.toHaveBeenCalled();
});
