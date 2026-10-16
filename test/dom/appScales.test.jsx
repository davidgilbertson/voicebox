import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect, vi } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";
import { writeActiveView } from "../../src/AppShell/config.js";
import { readScaleBpm, readScaleMinNote, SCALE_BPM_DEFAULT } from "../../src/ScalesPage/config.js";

describe("Scales page", () => {
  test("The scales page shows the scale controls", async () => {
    writeActiveView("scales");
    render(<AppShell />);

    expect(screen.getByRole("combobox", { name: "Scale pattern" })).toHaveValue("Semitones");
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable metronome" })).toBeInTheDocument();
    expect(screen.getByLabelText("Open settings")).toBeEnabled();
  });

  test("The scales BPM persists when changed", async () => {
    writeActiveView("scales");
    const user = userEvent.setup();
    render(<AppShell />);

    expect(readScaleBpm()).toBe(SCALE_BPM_DEFAULT);
    expect(screen.getByText(String(SCALE_BPM_DEFAULT))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Increase scales BPM" }));

    await waitFor(() => {
      expect(readScaleBpm()).toBe(SCALE_BPM_DEFAULT + 10);
    });
  });

  test("The scales minimum note can be changed from settings", async () => {
    writeActiveView("scales");
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));
    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Increase scales minimum" }));

    await waitFor(() => {
      expect(readScaleMinNote()).toBe("A#2");
    });
  });

  test("Settings opens directly from the scales page", async () => {
    writeActiveView("scales");
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByLabelText("Open settings"));

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  test("The gesture help panel can be dismissed and stays dismissed", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    writeActiveView("scales");
    const user = userEvent.setup();
    const { unmount } = render(<AppShell />);

    expect(
      screen.getByText(/use gestures to control what happens when the scale repeats/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(
      screen.queryByText(/use gestures to control what happens when the scale repeats/i),
    ).toBeNull();

    unmount();
    render(<AppShell />);
    expect(
      screen.queryByText(/use gestures to control what happens when the scale repeats/i),
    ).toBeNull();
  });
});
