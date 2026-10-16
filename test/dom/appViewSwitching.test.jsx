import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, test, expect } from "vitest";
import { AppShell } from "../../src/AppShell.jsx";
import { readActiveView, writeActiveView } from "../../src/AppShell/config.js";

describe("App shell", () => {
  describe("Navigation", () => {
    test("The active view is restored from localStorage and saved on switch", async () => {
      writeActiveView("spectrogram");
      const user = userEvent.setup();
      render(<AppShell />);

      const scalesButton = screen.getByRole("button", { name: "Scales" });
      const pitchButton = screen.getByRole("button", { name: "Pitch" });
      const vibratoButton = screen.getByRole("button", { name: "Vibrato" });
      const spectrogramButton = screen.getByRole("button", { name: "Spectrogram" });
      expect(spectrogramButton).toHaveAttribute("aria-pressed", "true");
      expect(scalesButton).toHaveAttribute("aria-pressed", "false");
      expect(pitchButton).toHaveAttribute("aria-pressed", "false");
      expect(vibratoButton).toHaveAttribute("aria-pressed", "false");

      await user.click(vibratoButton);
      expect(vibratoButton).toHaveAttribute("aria-pressed", "true");
      expect(pitchButton).toHaveAttribute("aria-pressed", "false");
      expect(spectrogramButton).toHaveAttribute("aria-pressed", "false");

      await waitFor(() => {
        expect(readActiveView()).toBe("vibrato");
      });
    });

    test("Switching to a recorder view shows that chart and hides the others", async () => {
      const user = userEvent.setup();
      render(<AppShell />);

      // The recorder mounts all three charts at once and toggles which is visible
      // via a `hidden` class, so switching views should swap which chart is shown.
      const expectOnlyVisible = (visibleView) => {
        for (const view of ["vibrato", "spectrogram", "pitch"]) {
          const wrapper = screen.getByTestId(`recorder-view-${view}`);
          if (view === visibleView) {
            expect(wrapper).not.toHaveClass("hidden");
          } else {
            expect(wrapper).toHaveClass("hidden");
          }
        }
      };

      await user.click(screen.getByRole("button", { name: "Spectrogram" }));
      expectOnlyVisible("spectrogram");

      await user.click(screen.getByRole("button", { name: "Pitch" }));
      expectOnlyVisible("pitch");

      await user.click(screen.getByRole("button", { name: "Vibrato" }));
      expectOnlyVisible("vibrato");
    });
  });
});
