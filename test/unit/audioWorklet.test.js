import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("audio worklet stays self-contained for production loading", () => {
  const source = readFileSync("src/Recorder/worklets/audioWorklet.js", "utf8");

  expect(source).not.toMatch(/^\s*import\s/m);
});
