import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("auto pause on silence setting defaults to enabled and is persisted", () => {
  assert.equal(appSource.includes("const AUTO_PAUSE_ON_SILENCE_DEFAULT = true;"), true);
  assert.equal(appSource.includes("const [autoPauseOnSilence, setAutoPauseOnSilence] = useState(() => {"), true);
  assert.equal(appSource.includes("timelineRef.current.autoPauseOnSilence = autoPauseOnSilence;"), true);
  assert.equal(appSource.includes("AUTO_PAUSE_ON_SILENCE_STORAGE_KEY"), true);
});

test("stats visibility setting defaults to hidden and controls stats render", () => {
  assert.equal(appSource.includes("const SHOW_STATS_DEFAULT = false;"), true);
  assert.equal(appSource.includes("const [showStats, setShowStats] = useState(() => {"), true);
  assert.equal(appSource.includes("const [stats, setStats] = useState({"), true);
  assert.equal(appSource.includes("setStats({"), true);
  assert.equal(appSource.includes("if (didDisplayRateChange) {"), true);
  assert.equal(appSource.includes("{showStats ? ("), true);
  assert.equal(appSource.includes("SHOW_STATS_STORAGE_KEY"), true);
});

test("both charts share a named max jump threshold", () => {
  assert.equal(appSource.includes("const MAX_DRAW_JUMP_CENTS = "), true);
  const usageCount = (appSource.match(/maxDrawJumpCents=\{MAX_DRAW_JUMP_CENTS\}/g) ?? []).length;
  assert.equal(usageCount, 2);
});
