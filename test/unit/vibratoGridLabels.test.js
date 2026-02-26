import {expect, test, vi} from "vitest";
import {drawSemitoneLabels} from "../../src/Recorder/VibratoChart.jsx";

function createLabelContext() {
  return {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "middle",
    fillText: vi.fn(),
  };
}

test("vibrato labels expand to +/-4 when range is 405 cents", () => {
  const ctx = createLabelContext();

  drawSemitoneLabels(ctx, 200, 120, 405);

  const labels = ctx.fillText.mock.calls.map(([label]) => label);
  expect(labels).toContain("-4");
  expect(labels).toContain("+4");
});

test("vibrato labels stay at +/-3 when range is 305 cents", () => {
  const ctx = createLabelContext();

  drawSemitoneLabels(ctx, 200, 120, 305);

  const labels = ctx.fillText.mock.calls.map(([label]) => label);
  expect(labels).toContain("-3");
  expect(labels).toContain("+3");
  expect(labels).not.toContain("-4");
  expect(labels).not.toContain("+4");
});
