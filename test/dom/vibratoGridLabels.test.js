import { describe, expect, test, vi } from "vitest";
import { drawSemitoneLabels } from "../../src/Recorder/Vibrato/vibratoTools.js";

describe("Vibrato", () => {
  test("Grid labels expand with the cents range", () => {
    function labelsForRange(rangeCents) {
      const ctx = {
        fillStyle: "",
        font: "",
        textAlign: "left",
        textBaseline: "middle",
        fillText: vi.fn(),
      };
      drawSemitoneLabels(ctx, 200, 120, rangeCents, {
        labelX: 8,
        labelTop: 0,
        labelBottom: 120,
      });
      return ctx.fillText.mock.calls.map(([label]) => label);
    }

    // A 405-cent range reaches the +/-4 semitone labels.
    const wideLabels = labelsForRange(405);
    expect(wideLabels).toContain("-4");
    expect(wideLabels).toContain("+4");

    // A narrower 305-cent range stops at +/-3.
    const narrowLabels = labelsForRange(305);
    expect(narrowLabels).toContain("-3");
    expect(narrowLabels).toContain("+3");
    expect(narrowLabels).not.toContain("-4");
    expect(narrowLabels).not.toContain("+4");
  });
});
