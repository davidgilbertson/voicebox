import { analyzePreparedActualPitchSample, loadActualPitchSample } from "./picaExperiment.js";
import { PICA_SETTINGS_DEFAULTS, SIMILARITY_FUNC } from "./config.js";

const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const VOCAL_SAMPLER_LABEL = "vocal_sampler.wav";
const FIXED_SETTINGS = {
  ...PICA_SETTINGS_DEFAULTS,
};

const CARRY_THRESHOLD_VALUES = [0.4, 0.5, 0.6, 0.7, 0.8];
const CORRELATION_TO_HZ_RATIO_VALUES = [4, 4.75, 5.5, 6.25, 7];
const TOTAL_RUNS = CARRY_THRESHOLD_VALUES.length * CORRELATION_TO_HZ_RATIO_VALUES.length;

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
    `Sweep against actuals for ${VOCAL_SAMPLER_LABEL}: mode=${SIMILARITY_FUNC}, minCarryCorr=${CARRY_THRESHOLD_VALUES.join(", ")}, corrHzRatio=${CORRELATION_TO_HZ_RATIO_VALUES.join(", ")} | fixed: maxCrossingsPerPeriod=${FIXED_SETTINGS.maxCrossingsPerPeriod}, maxPatches=${FIXED_SETTINGS.maxComparisonPatches}, maxWalk=${FIXED_SETTINGS.maxWalkSteps}`;
}

function createGrid(fill = Number.NaN) {
  return CARRY_THRESHOLD_VALUES.map(() => CORRELATION_TO_HZ_RATIO_VALUES.map(() => fill));
}

function getMethodAccuracy(metrics, methodKey) {
  return (
    metrics.accuracyByMethodKey?.[methodKey] ?? {
      accuracy: Number.NaN,
      correctCount: 0,
      comparedCount: 0,
    }
  );
}

async function runSweepForSample(preparedSample) {
  const picaAccuracy = createGrid();
  const carryForwardAccuracy = createGrid();
  let runNumber = 0;

  for (
    let thresholdIndex = 0;
    thresholdIndex < CARRY_THRESHOLD_VALUES.length;
    thresholdIndex += 1
  ) {
    const minCarryCorr = CARRY_THRESHOLD_VALUES[thresholdIndex];
    for (let ratioIndex = 0; ratioIndex < CORRELATION_TO_HZ_RATIO_VALUES.length; ratioIndex += 1) {
      const correlationToHzWeightRatio = CORRELATION_TO_HZ_RATIO_VALUES[ratioIndex];
      runNumber += 1;
      const message =
        `Run ${runNumber}/${TOTAL_RUNS}: ${VOCAL_SAMPLER_LABEL} | ` +
        `minCarryCorr=${minCarryCorr} | ` +
        `corrHzRatio=${correlationToHzWeightRatio}`;
      setStatus(message);

      const startMs = performance.now();
      const result = await analyzePreparedActualPitchSample(
        preparedSample,
        {
          ...FIXED_SETTINGS,
          minCarryCorr,
          correlationToHzWeightRatio,
        },
        false,
      );
      const elapsedMs = performance.now() - startMs;
      const picaMetrics = getMethodAccuracy(result.metrics, "pica");
      const carryMetrics = getMethodAccuracy(result.metrics, "carryForward");

      console.log(
        `${message} -> pica ${(picaMetrics.accuracy * 100).toFixed(1)}% (${picaMetrics.correctCount}/${picaMetrics.comparedCount}), carry ${(carryMetrics.accuracy * 100).toFixed(1)}% (${carryMetrics.correctCount}/${carryMetrics.comparedCount}), ${elapsedMs.toFixed(1)}ms`,
      );

      picaAccuracy[thresholdIndex][ratioIndex] = picaMetrics.accuracy;
      carryForwardAccuracy[thresholdIndex][ratioIndex] = carryMetrics.accuracy;
    }
  }

  return {
    picaAccuracy,
    carryForwardAccuracy,
  };
}

function getHeatmapAnnotations(accuracy) {
  return accuracy.flatMap((row, rowIndex) =>
    row.map((value, columnIndex) => ({
      x: CORRELATION_TO_HZ_RATIO_VALUES[columnIndex],
      y: CARRY_THRESHOLD_VALUES[rowIndex],
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

async function renderHeatmap(elementId, title, accuracy, bounds) {
  await globalThis.Plotly.newPlot(
    elementId,
    [
      {
        type: "heatmap",
        x: CORRELATION_TO_HZ_RATIO_VALUES,
        y: CARRY_THRESHOLD_VALUES,
        z: accuracy.map((row) =>
          row.map((value) => (Number.isFinite(value) ? value * 100 : Number.NaN)),
        ),
        hovertemplate: "minCarryCorr=%{y}<br>corrHzRatio=%{x}<br>accuracy=%{z:.1f}%<extra></extra>",
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
      annotations: getHeatmapAnnotations(accuracy),
      xaxis: {
        title: "corrHzRatio",
        tickmode: "array",
        tickvals: CORRELATION_TO_HZ_RATIO_VALUES,
      },
      yaxis: {
        title: "minCarryCorr",
        tickmode: "array",
        tickvals: CARRY_THRESHOLD_VALUES,
      },
    },
    { responsive: true },
  );
}

function getBestCell(sweepResult) {
  let bestPicaAccuracy = Number.NEGATIVE_INFINITY;
  let bestPicaCarryThreshold = CARRY_THRESHOLD_VALUES[0];
  let bestPicaCorrelationToHzWeightRatio = CORRELATION_TO_HZ_RATIO_VALUES[0];
  let bestCarryForwardAccuracy = Number.NEGATIVE_INFINITY;
  let bestCarryForwardThreshold = CARRY_THRESHOLD_VALUES[0];
  let bestCarryForwardCorrelationToHzWeightRatio = CORRELATION_TO_HZ_RATIO_VALUES[0];

  for (
    let thresholdIndex = 0;
    thresholdIndex < CARRY_THRESHOLD_VALUES.length;
    thresholdIndex += 1
  ) {
    for (let ratioIndex = 0; ratioIndex < CORRELATION_TO_HZ_RATIO_VALUES.length; ratioIndex += 1) {
      const picaAccuracy = sweepResult.picaAccuracy[thresholdIndex][ratioIndex];
      if (Number.isFinite(picaAccuracy) && picaAccuracy > bestPicaAccuracy) {
        bestPicaAccuracy = picaAccuracy;
        bestPicaCarryThreshold = CARRY_THRESHOLD_VALUES[thresholdIndex];
        bestPicaCorrelationToHzWeightRatio = CORRELATION_TO_HZ_RATIO_VALUES[ratioIndex];
      }

      const carryForwardAccuracy = sweepResult.carryForwardAccuracy[thresholdIndex][ratioIndex];
      if (
        Number.isFinite(carryForwardAccuracy) &&
        carryForwardAccuracy > bestCarryForwardAccuracy
      ) {
        bestCarryForwardAccuracy = carryForwardAccuracy;
        bestCarryForwardThreshold = CARRY_THRESHOLD_VALUES[thresholdIndex];
        bestCarryForwardCorrelationToHzWeightRatio = CORRELATION_TO_HZ_RATIO_VALUES[ratioIndex];
      }
    }
  }

  return {
    bestPicaAccuracy,
    bestPicaCarryThreshold,
    bestPicaCorrelationToHzWeightRatio,
    bestCarryForwardAccuracy,
    bestCarryForwardThreshold,
    bestCarryForwardCorrelationToHzWeightRatio,
  };
}

async function renderResults(sweepResult) {
  const heatmaps = document.getElementById("heatmaps");
  heatmaps.innerHTML = `
    <div id="heatmap0" class="heatmap-chart"></div>
    <div id="heatmap1" class="heatmap-chart"></div>
  `;

  const bounds = getHeatmapBounds(sweepResult);
  await renderHeatmap("heatmap0", "PICA accuracy", sweepResult.picaAccuracy, bounds);
  await renderHeatmap(
    "heatmap1",
    "Carry-forward accuracy",
    sweepResult.carryForwardAccuracy,
    bounds,
  );

  const {
    bestPicaAccuracy,
    bestPicaCarryThreshold,
    bestPicaCorrelationToHzWeightRatio,
    bestCarryForwardAccuracy,
    bestCarryForwardThreshold,
    bestCarryForwardCorrelationToHzWeightRatio,
  } = getBestCell(sweepResult);

  setSummary(
    Number.isFinite(bestPicaAccuracy) || Number.isFinite(bestCarryForwardAccuracy)
      ? `Best PICA: minCarryCorr=${bestPicaCarryThreshold}, corrHzRatio=${bestPicaCorrelationToHzWeightRatio}, accuracy=${(bestPicaAccuracy * 100).toFixed(1)}% | Best carry-forward: minCarryCorr=${bestCarryForwardThreshold}, corrHzRatio=${bestCarryForwardCorrelationToHzWeightRatio}, accuracy=${(bestCarryForwardAccuracy * 100).toFixed(1)}%`
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
    setStatus(`Done. ${TOTAL_RUNS} runs.`);
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
