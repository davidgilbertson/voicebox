import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("foreground tracking listens to visibility and focus lifecycle events", () => {
  assert.equal(appSource.includes("function computeIsForeground()"), true);
  assert.equal(appSource.includes("document.visibilityState === \"hidden\""), true);
  assert.equal(appSource.includes("document.hasFocus"), true);

  assert.equal(appSource.includes("document.addEventListener(\"visibilitychange\", updateForeground)"), true);
  assert.equal(appSource.includes("window.addEventListener(\"focus\", updateForeground)"), true);
  assert.equal(appSource.includes("window.addEventListener(\"blur\", updateForeground)"), true);
  assert.equal(appSource.includes("window.addEventListener(\"pageshow\", updateForeground)"), true);
  assert.equal(appSource.includes("window.addEventListener(\"pagehide\", updateForeground)"), true);

  assert.equal(appSource.includes("document.removeEventListener(\"visibilitychange\", updateForeground)"), true);
  assert.equal(appSource.includes("window.removeEventListener(\"focus\", updateForeground)"), true);
  assert.equal(appSource.includes("window.removeEventListener(\"blur\", updateForeground)"), true);
  assert.equal(appSource.includes("window.removeEventListener(\"pageshow\", updateForeground)"), true);
  assert.equal(appSource.includes("window.removeEventListener(\"pagehide\", updateForeground)"), true);
});
