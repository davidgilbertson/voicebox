import { analyzePreparedActualPitchSample, loadActualPitchSample } from "./picaExperiment.js";
import { PICA_SETTINGS_DEFAULTS } from "./config.js";

const CARRY_THRESHOLD_VALUES = [
  4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6,
];
const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const VOCAL_SAMPLER_LABEL = "vocal_sampler.wav";
const FIXED_SETTINGS = {
  ...PICA_SETTINGS_DEFAULTS,
  correlationToHzWeightRatio: 0.5,
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
    `Sweep against actuals for ${VOCAL_SAMPLER_LABEL}: carryThr=${CARRY_THRESHOLD_VALUES.join(", ")} | fixed: corrHzRatio=${FIXED_SETTINGS.correlationToHzWeightRatio}, maxExtremaPerFold=${FIXED_SETTINGS.maxExtremaPerFold}, maxCrossingsPerPeriod=${FIXED_SETTINGS.maxCrossingsPerPeriod}, maxPatches=${FIXED_SETTINGS.maxComparisonPatches}, maxWalk=${FIXED_SETTINGS.maxWalkSteps}`;
}

function createGrid(fill = Number.NaN) {
  return [CARRY_THRESHOLD_VALUES.map(() => fill)];
}

async function runSweepForSample(preparedSample) {
  const picaAccuracy = createGrid();
  const picaCorrectCounts = createGrid(0);
  const picaComparedCounts = createGrid(0);
  const carryForwardAccuracy = createGrid();
  const carryForwardCorrectCounts = createGrid(0);
  const carryForwardComparedCounts = createGrid(0);
  const totalRuns = CARRY_THRESHOLD_VALUES.length;
  let runNumber = 0;

  for (
    let thresholdIndex = 0;
    thresholdIndex < CARRY_THRESHOLD_VALUES.length;
    thresholdIndex += 1
  ) {
    const carryForwardCorrelationThreshold = CARRY_THRESHOLD_VALUES[thresholdIndex];
    runNumber += 1;
    const message =
      `Run ${runNumber}/${totalRuns}: ${VOCAL_SAMPLER_LABEL} | ` +
      `carryThr=${carryForwardCorrelationThreshold}`;
    setStatus(message);

    const startMs = performance.now();
    const result = await analyzePreparedActualPitchSample(preparedSample, {
      ...FIXED_SETTINGS,
      carryForwardCorrelationThreshold,
    });
    const elapsedMs = performance.now() - startMs;

    console.log(
      `${message} -> pica ${(result.metrics.picaAccuracy * 100).toFixed(1)}% (${result.metrics.picaCorrectCount}/${result.metrics.actualComparedCount}), carry ${(result.metrics.carryForwardAccuracy * 100).toFixed(1)}% (${result.metrics.carryForwardCorrectCount}/${result.metrics.carryForwardComparedCount}), ${elapsedMs.toFixed(1)}ms`,
    );

    picaAccuracy[0][thresholdIndex] = result.metrics.picaAccuracy;
    picaCorrectCounts[0][thresholdIndex] = result.metrics.picaCorrectCount;
    picaComparedCounts[0][thresholdIndex] = result.metrics.actualComparedCount;
    carryForwardAccuracy[0][thresholdIndex] = result.metrics.carryForwardAccuracy;
    carryForwardCorrectCounts[0][thresholdIndex] = result.metrics.carryForwardCorrectCount;
    carryForwardComparedCounts[0][thresholdIndex] = result.metrics.carryForwardComparedCount;
  }

  return {
    picaAccuracy,
    picaCorrectCounts,
    picaComparedCounts,
    carryForwardAccuracy,
    carryForwardCorrectCounts,
    carryForwardComparedCounts,
  };
}

function getHeatmapAnnotations(accuracy, correctCounts, comparedCounts) {
  return accuracy.flatMap((row, rowIndex) =>
    row.map((value, columnIndex) => ({
      x: CARRY_THRESHOLD_VALUES[columnIndex],
      y: rowIndex,
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
  const values = [sweepResult.picaAccuracy, sweepResult.carryForwardAccuracy]
    .flat()
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
        x: CARRY_THRESHOLD_VALUES,
        y: [0],
        z: accuracy.map((row) =>
          row.map((value) => (Number.isFinite(value) ? value * 100 : Number.NaN)),
        ),
        hovertemplate: "carryThr=%{x}<br>accuracy=%{z:.1f}%<extra></extra>",
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
        title: "carryThr",
        tickmode: "array",
        tickvals: CARRY_THRESHOLD_VALUES,
      },
      yaxis: {
        title: "",
        tickmode: "array",
        tickvals: [0],
        ticktext: [""],
      },
    },
    { responsive: true },
  );
}

function getBestCell(sweepResult) {
  let bestPicaAccuracy = Number.NEGATIVE_INFINITY;
  let bestPicaCarryThreshold = CARRY_THRESHOLD_VALUES[0];
  let bestCarryForwardAccuracy = Number.NEGATIVE_INFINITY;
  let bestCarryForwardThreshold = CARRY_THRESHOLD_VALUES[0];

  for (
    let thresholdIndex = 0;
    thresholdIndex < CARRY_THRESHOLD_VALUES.length;
    thresholdIndex += 1
  ) {
    const picaAccuracy = sweepResult.picaAccuracy[0][thresholdIndex];
    if (Number.isFinite(picaAccuracy) && picaAccuracy > bestPicaAccuracy) {
      bestPicaAccuracy = picaAccuracy;
      bestPicaCarryThreshold = CARRY_THRESHOLD_VALUES[thresholdIndex];
    }
    const carryForwardAccuracy = sweepResult.carryForwardAccuracy[0][thresholdIndex];
    if (Number.isFinite(carryForwardAccuracy) && carryForwardAccuracy > bestCarryForwardAccuracy) {
      bestCarryForwardAccuracy = carryForwardAccuracy;
      bestCarryForwardThreshold = CARRY_THRESHOLD_VALUES[thresholdIndex];
    }
  }

  return {
    bestPicaAccuracy,
    bestPicaCarryThreshold,
    bestCarryForwardAccuracy,
    bestCarryForwardThreshold,
  };
}

async function renderResults(sweepResult) {
  const heatmaps = document.getElementById("heatmaps");
  heatmaps.innerHTML = `
    <div id="heatmap0" class="heatmap-chart"></div>
    <div id="heatmap1" class="heatmap-chart"></div>
  `;

  const bounds = getHeatmapBounds(sweepResult);
  await renderHeatmap(
    "heatmap0",
    "PICA accuracy vs carry threshold",
    sweepResult.picaAccuracy,
    sweepResult.picaCorrectCounts,
    sweepResult.picaComparedCounts,
    bounds,
  );
  await renderHeatmap(
    "heatmap1",
    "Carry-forward accuracy vs carry threshold",
    sweepResult.carryForwardAccuracy,
    sweepResult.carryForwardCorrectCounts,
    sweepResult.carryForwardComparedCounts,
    bounds,
  );

  const {
    bestPicaAccuracy,
    bestPicaCarryThreshold,
    bestCarryForwardAccuracy,
    bestCarryForwardThreshold,
  } = getBestCell(sweepResult);

  setSummary(
    Number.isFinite(bestPicaAccuracy) || Number.isFinite(bestCarryForwardAccuracy)
      ? `Best PICA carryThr: ${bestPicaCarryThreshold}, accuracy=${(bestPicaAccuracy * 100).toFixed(1)}% | Best carry-forward carryThr: ${bestCarryForwardThreshold}, accuracy=${(bestCarryForwardAccuracy * 100).toFixed(1)}%`
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
    setStatus(`Done. ${CARRY_THRESHOLD_VALUES.length} runs.`);
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
