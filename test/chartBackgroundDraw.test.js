import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const chartSource = readFileSync(new URL("../src/Chart.jsx", import.meta.url), "utf8");

test("chart draw does not early return when count is zero so background can render", () => {
  const backgroundCallIndex = chartSource.indexOf("drawBackground(ctx, cssWidth, cssHeight)");
  const noDataReturnIndex = chartSource.indexOf("if (!values || count <= 0)");
  assert.notEqual(backgroundCallIndex, -1);
  assert.notEqual(noDataReturnIndex, -1);
  assert.equal(backgroundCallIndex < noDataReturnIndex, true);
});
