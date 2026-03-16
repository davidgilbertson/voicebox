import { analyzePreparedActualPitchSample, loadActualPitchSample } from "./picaExperiment.js";
import { PICA_SETTINGS_DEFAULTS } from "./config.js";

const MAX_PATCHES_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];
const MAX_WALK_VALUES = [5, 10, 15, 20, 30, 40, 50, 65, 80, 100];
const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const VOCAL_SAMPLER_LABEL = "vocal_sampler.wav";
const FIXED_SETTINGS = {
  ...PICA_SETTINGS_DEFAULTS,
};

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function setSummary(text) {
  document.getElementById("summary").textContent = text;
}

function setSweepInfo() {
  document.getElementById("sweepInfo").textContent =
    `Sweep against actuals for ${VOCAL_SAMPLER_LABEL}: maxPatches=${MAX_PATCHES_VALUES.join(", ")} | maxWalk=${MAX_WALK_VALUES.join(", ")} | fixed: maxExtremaPerFold=${FIXED_SETTINGS.maxExtremaPerFold}, maxCrossingsPerPeriod=${FIXED_SETTINGS.maxCrossingsPerPeriod}, minLogCorr=${FIXED_SETTINGS.picaGlobalLogCorrelationCutoff}, hzWeight=${FIXED_SETTINGS.hzWeight}, corrWeight=${FIXED_SETTINGS.correlationWeight}`;
}

function createGrid(fill = Number.NaN) {
  return MAX_WALK_VALUES.map(() => MAX_PATCHES_VALUES.map(() => fill));
}

async function runSweepForSample(preparedSample) {
  const accuracy = createGrid();
  const correctCounts = createGrid(0);
  const comparedCounts = createGrid(0);
  const totalRuns = MAX_PATCHES_VALUES.length * MAX_WALK_VALUES.length;

  for (let walkIndex = 0; walkIndex < MAX_WALK_VALUES.length; walkIndex += 1) {
    for (let patchIndex = 0; patchIndex < MAX_PATCHES_VALUES.length; patchIndex += 1) {
      const maxWalkSteps = MAX_WALK_VALUES[walkIndex];
      const maxComparisonPatches = MAX_PATCHES_VALUES[patchIndex];
      const runNumber = walkIndex * MAX_PATCHES_VALUES.length + patchIndex + 1;
      const message =
        `Run ${runNumber}/${totalRuns}: ${VOCAL_SAMPLER_LABEL} | ` +
        `maxPatches=${maxComparisonPatches} | maxWalk=${maxWalkSteps}`;
      setStatus(message);

      const startMs = performance.now();
      const result = await analyzePreparedActualPitchSample(preparedSample, {
        ...FIXED_SETTINGS,
        maxComparisonPatches,
        maxWalkSteps,
      });
      const elapsedMs = performance.now() - startMs;

      console.log(
        `${message} -> pica accuracy ${(result.metrics.picaAccuracy * 100).toFixed(1)}% (${result.metrics.picaCorrectCount}/${result.metrics.actualComparedCount}), ${elapsedMs.toFixed(1)}ms`,
      );

      accuracy[walkIndex][patchIndex] = result.metrics.picaAccuracy;
      correctCounts[walkIndex][patchIndex] = result.metrics.picaCorrectCount;
      comparedCounts[walkIndex][patchIndex] = result.metrics.actualComparedCount;
    }
  }

  return {
    accuracy,
    correctCounts,
    comparedCounts,
  };
}

function getHeatmapAnnotations(accuracy, correctCounts, comparedCounts) {
  return accuracy.flatMap((row, rowIndex) =>
    row.map((value, columnIndex) => ({
      x: MAX_PATCHES_VALUES[columnIndex],
      y: MAX_WALK_VALUES[rowIndex],
      text: Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a",
      showarrow: false,
      font: { color: "#ffffff", size: 12 },
      bgcolor: "rgba(0, 0, 0, 0.72)",
      bordercolor: "rgba(255, 255, 255, 0.22)",
      borderpad: 1,
    })),
  );
}

function getHeatmapBounds(sweepResult) {
  const values = sweepResult.accuracy
    .flat()
    .filter(Number.isFinite)
    .map((value) => value * 100);
  if (values.length === 0) {
    return { zmin: 0, zmax: 100 };
  }
  const zmin = Math.min(...values);
  const zmax = Math.max(...values);
  return zmin === zmax ? { zmin: zmin - 1, zmax: zmax + 1 } : { zmin, zmax };
}

async function renderHeatmap(elementId, title, accuracy, correctCounts, comparedCounts, bounds) {
  await globalThis.Plotly.newPlot(
    elementId,
    [
      {
        type: "heatmap",
        x: MAX_PATCHES_VALUES,
        y: MAX_WALK_VALUES,
        z: accuracy.map((row) =>
          row.map((value) => (Number.isFinite(value) ? value * 100 : Number.NaN)),
        ),
        hovertemplate: "maxWalk=%{y}<br>maxPatches=%{x}<br>accuracy=%{z:.1f}%<extra></extra>",
        colorscale: "Viridis",
        zmin: bounds.zmin,
        zmax: bounds.zmax,
      },
    ],
    {
      title,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 56, r: 24, t: 52, b: 44 },
      annotations: getHeatmapAnnotations(accuracy, correctCounts, comparedCounts),
      xaxis: {
        title: "maxPatches",
        tickmode: "array",
        tickvals: MAX_PATCHES_VALUES,
      },
      yaxis: {
        title: "maxWalk",
        tickmode: "array",
        tickvals: MAX_WALK_VALUES,
      },
    },
    { responsive: true },
  );
}

function getBestCell(sweepResult) {
  let bestAccuracy = Number.NEGATIVE_INFINITY;
  let bestMaxPatches = MAX_PATCHES_VALUES[0];
  let bestMaxWalk = MAX_WALK_VALUES[0];

  for (let walkIndex = 0; walkIndex < MAX_WALK_VALUES.length; walkIndex += 1) {
    for (let patchIndex = 0; patchIndex < MAX_PATCHES_VALUES.length; patchIndex += 1) {
      const accuracy = sweepResult.accuracy[walkIndex][patchIndex];
      if (!Number.isFinite(accuracy) || accuracy <= bestAccuracy) continue;
      bestAccuracy = accuracy;
      bestMaxPatches = MAX_PATCHES_VALUES[patchIndex];
      bestMaxWalk = MAX_WALK_VALUES[walkIndex];
    }
  }

  return {
    bestAccuracy,
    bestMaxPatches,
    bestMaxWalk,
  };
}

async function renderResults(sweepResult) {
  const heatmaps = document.getElementById("heatmaps");
  heatmaps.innerHTML = `<div id="heatmap0" class="heatmap-chart"></div>`;

  const bounds = getHeatmapBounds(sweepResult);
  await renderHeatmap(
    "heatmap0",
    "Pica accuracy",
    sweepResult.accuracy,
    sweepResult.correctCounts,
    sweepResult.comparedCounts,
    bounds,
  );

  const { bestAccuracy, bestMaxPatches, bestMaxWalk } = getBestCell(sweepResult);

  setSummary(
    Number.isFinite(bestAccuracy)
      ? `Best cell: maxPatches=${bestMaxPatches}, maxWalk=${bestMaxWalk}, accuracy=${(bestAccuracy * 100).toFixed(1)}%`
      : "No valid results.",
  );
}

async function runSweep() {
  const runButton = document.getElementById("runButton");
  runButton.disabled = true;
  try {
    const loadMessage = `Loading ${VOCAL_SAMPLER_LABEL}...`;
    console.log(loadMessage);
    setStatus(loadMessage);
    const preparedSample = await loadActualPitchSample(VOCAL_SAMPLER_URL);
    const sweepResult = await runSweepForSample(preparedSample);

    await renderResults(sweepResult);
    setStatus(`Done. ${MAX_PATCHES_VALUES.length * MAX_WALK_VALUES.length} runs.`);
  } catch (error) {
    console.error(error);
    setSummary("");
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    runButton.disabled = false;
  }
}

document.getElementById("runButton").addEventListener("click", () => {
  void runSweep();
});

setSweepInfo();
void runSweep();
