import React from "react";
import {render, waitFor} from "@testing-library/react";
import {expect, test, vi} from "vitest";
import {writeActiveView} from "../../src/AppShell/config.js";

const {ensurePianoLoadedMock} = vi.hoisted(() => ({
  ensurePianoLoadedMock: vi.fn(async () => null),
}));

vi.mock("../../src/ScalesPage/piano.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ensurePianoLoaded: ensurePianoLoadedMock,
  };
});

import AppShell from "../../src/AppShell.jsx";

test("instrument warmup starts on app load even when opening on a non-scales page", async () => {
  writeActiveView("pitch");
  render(<AppShell/>);

  await waitFor(() => {
    expect(ensurePianoLoadedMock).toHaveBeenCalledTimes(1);
  });
});
