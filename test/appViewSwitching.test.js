import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("active view is persisted to localStorage", () => {
  assert.equal(appSource.includes("const ACTIVE_VIEW_STORAGE_KEY = \"voicebox.activeView\""), true);
  assert.equal(appSource.includes("const [activeView, setActiveView] = useState(() => safeReadActiveView())"), true);
  assert.equal(appSource.includes("window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, activeView)"), true);
});

test("render loop and audio processing read active view from ref to avoid stale closure", () => {
  assert.equal(appSource.includes("const activeViewRef = useRef(ACTIVE_VIEW_DEFAULT);"), true);
  assert.equal(appSource.includes("activeViewRef.current = activeView;"), true);
  assert.equal(appSource.includes("const currentView = activeViewRef.current;"), true);
  assert.equal(appSource.includes("const minHz = currentView === \"pitch\" ? pitchRangeRef.current.minHz : VIBRATO_MIN_HZ;"), true);
  assert.equal(appSource.includes("if (currentView === \"vibrato\") {"), true);
});

test("switching view or closing settings schedules an immediate redraw", () => {
  assert.equal(appSource.includes("const forceRedrawRef = useRef(false);"), true);
  assert.equal(appSource.includes("const shouldDrawNow = didTimelineChange || forceRedrawRef.current;"), true);
  assert.equal(appSource.includes("forceRedrawRef.current = true;"), true);
  assert.equal(appSource.includes("drawActiveChart();"), true);
  assert.equal(appSource.includes("[activeView, pitchMaxCents, pitchMinCents, settingsOpen]"), true);
});
