import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("Audio worklet", () => {
  test("Stays self-contained for production loading", () => {
    const source = readFileSync("src/Recorder/worklets/audioWorklet.js", "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
