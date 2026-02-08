import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

function extractBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Could not find marker: ${startMarker}`);
  const openBraceIndex = source.indexOf("{", start);
  assert.notEqual(openBraceIndex, -1, `Could not find opening brace for: ${startMarker}`);
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, i);
      }
    }
  }
  assert.fail(`Could not find closing brace for: ${startMarker}`);
}

test("timeline reset is not called inside startAudio or stopAudio", () => {
  const startAudioBlock = extractBlock(appSource, "const startAudio = async () =>");
  const stopAudioBlock = extractBlock(appSource, "const stopAudio = () =>");
  assert.equal(startAudioBlock.includes("resetPitchTimeline("), false);
  assert.equal(stopAudioBlock.includes("resetPitchTimeline("), false);
});

test("app does not reset timeline after initialization", () => {
  assert.equal(appSource.includes("resetPitchTimeline("), false);
});
