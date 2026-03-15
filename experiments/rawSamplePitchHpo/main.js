import {
  analyzePreparedActualPitchSample,
  loadActualPitchSample,
} from "../rawSamplePitch/analysis.js";

const RAW_CUTOFF_VALUES = [0, 0.1, 0.2];
const MAX_CROSSINGS_VALUES = [18, 24, 30];
const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const VOCAL_SAMPLER_LABEL = "vocal_sampler.wav";
const FIXED_SETTINGS = {
  maxExtremaPerFold: 5,
  maxComparisonPatches: 3,
  maxWalkSteps: 10,
  octaveBias: 0.15,
  peakinessBias: 0,
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
    `Sweep against actuals for ${VOCAL_SAMPLER_LABEL}: minLogCorr=${RAW_CUTOFF_VALUES.join(", ")} | maxCrossingsPerPeriod=${MAX_CROSSINGS_VALUES.join(", ")} | fixed: maxExtremaPerFold=${FIXED_SETTINGS.maxExtremaPerFold}, maxComparisonPatches=${FIXED_SETTINGS.maxComparisonPatches}, maxWalkSteps=${FIXED_SETTINGS.maxWalkSteps}, octaveBias=${FIXED_SETTINGS.octaveBias}, peakinessBias=${FIXED_SETTINGS.peakinessBias}`;
}

function createGrid(fill = Number.NaN) {
  return MAX_CROSSINGS_VALUES.map(() => RAW_CUTOFF_VALUES.map(() => fill));
}

async function runSingleSweep(preparedSample) {
  const accuracy = createGrid();
  const correctCounts = createGrid(0);
  const comparedCounts = createGrid(0);

  for (let rowIndex = 0; rowIndex < MAX_CROSSINGS_VALUES.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < RAW_CUTOFF_VALUES.length; columnIndex += 1) {
      const maxCrossingsPerPeriod = MAX_CROSSINGS_VALUES[rowIndex];
      const rawGlobalLogCorrelationCutoff = RAW_CUTOFF_VALUES[columnIndex];
      const runNumber = rowIndex * RAW_CUTOFF_VALUES.length + columnIndex + 1;
      const totalRuns = MAX_CROSSINGS_VALUES.length * RAW_CUTOFF_VALUES.length;
      const message = `Run ${runNumber}/${totalRuns}: ${VOCAL_SAMPLER_LABEL} | maxCrossingsPerPeriod=${maxCrossingsPerPeriod} | minLogCorr=${rawGlobalLogCorrelationCutoff.toFixed(1)}`;
      setStatus(message);

      const startMs = performance.now();
      const result = await analyzePreparedActualPitchSample(preparedSample, {
        ...FIXED_SETTINGS,
        maxCrossingsPerPeriod,
        rawGlobalLogCorrelationCutoff,
      });
      const elapsedMs = performance.now() - startMs;

      console.log(
        `${message} -> raw accuracy ${(result.metrics.rawAccuracy * 100).toFixed(1)}% (${result.metrics.rawCorrectCount}/${result.metrics.actualComparedCount}), ${elapsedMs.toFixed(1)}ms`,
      );

      accuracy[rowIndex][columnIndex] = result.metrics.rawAccuracy;
      correctCounts[rowIndex][columnIndex] = result.metrics.rawCorrectCount;
      comparedCounts[rowIndex][columnIndex] = result.metrics.actualComparedCount;
    }
  }

  return {
    source: { label: VOCAL_SAMPLER_LABEL },
    accuracy,
    correctCounts,
    comparedCounts,
  };
}

function buildAggregateHeatmap(fileResults) {
  const accuracy = createGrid();
  const totalCorrectCounts = createGrid(0);
  const totalComparedCounts = createGrid(0);

  for (let rowIndex = 0; rowIndex < MAX_CROSSINGS_VALUES.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < RAW_CUTOFF_VALUES.length; columnIndex += 1) {
      let correct = 0;
      let compared = 0;
      for (const fileResult of fileResults) {
        correct += fileResult.correctCounts[rowIndex][columnIndex];
        compared += fileResult.comparedCounts[rowIndex][columnIndex];
      }
      totalCorrectCounts[rowIndex][columnIndex] = correct;
      totalComparedCounts[rowIndex][columnIndex] = compared;
      accuracy[rowIndex][columnIndex] = compared > 0 ? correct / compared : Number.NaN;
    }
  }

  return {
    accuracy,
    totalCorrectCounts,
    totalComparedCounts,
  };
}

function getHeatmapText(accuracy, correctCounts, comparedCounts) {
  return accuracy.map((row, rowIndex) =>
    row.map((value, columnIndex) =>
      Number.isFinite(value)
        ? `${(value * 100).toFixed(1)}%<br>${correctCounts[rowIndex][columnIndex]}/${comparedCounts[rowIndex][columnIndex]}`
        : "n/a",
    ),
  );
}

function getHeatmapBounds(accuracy) {
  const values = accuracy
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

async function renderHeatmap(elementId, title, accuracy, correctCounts, comparedCounts) {
  const { zmin, zmax } = getHeatmapBounds(accuracy);
  await globalThis.Plotly.newPlot(
    elementId,
    [
      {
        type: "heatmap",
        x: RAW_CUTOFF_VALUES,
        y: MAX_CROSSINGS_VALUES,
        z: accuracy.map((row) =>
          row.map((value) => (Number.isFinite(value) ? value * 100 : Number.NaN)),
        ),
        text: getHeatmapText(accuracy, correctCounts, comparedCounts),
        texttemplate: "%{text}",
        textfont: { color: "#020617", size: 11 },
        hovertemplate:
          "maxCrossingsPerPeriod=%{y}<br>minLogCorr=%{x}<br>accuracy=%{z:.1f}%<extra></extra>",
        colorscale: "Viridis",
        zmin,
        zmax,
      },
    ],
    {
      title,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 56, r: 24, t: 52, b: 44 },
      xaxis: { title: "minLogCorr", tickmode: "array", tickvals: RAW_CUTOFF_VALUES },
      yaxis: {
        title: "maxCrossingsPerPeriod",
        tickmode: "array",
        tickvals: MAX_CROSSINGS_VALUES,
      },
    },
    { responsive: true },
  );
}

function getBestAccuracy(accuracy) {
  let bestAccuracy = Number.NEGATIVE_INFINITY;
  for (const row of accuracy) {
    for (const value of row) {
      if (Number.isFinite(value) && value > bestAccuracy) {
        bestAccuracy = value;
      }
    }
  }
  return bestAccuracy;
}

async function renderResults(fileResults) {
  const aggregate = buildAggregateHeatmap(fileResults);
  await renderHeatmap(
    "overallChart",
    `Raw Accuracy Against Actuals: ${VOCAL_SAMPLER_LABEL}`,
    aggregate.accuracy,
    aggregate.totalCorrectCounts,
    aggregate.totalComparedCounts,
  );

  const perFileCharts = document.getElementById("perFileCharts");
  perFileCharts.innerHTML = fileResults
    .map((_, index) => `<div id="fileChart${index}" class="file-chart"></div>`)
    .join("");

  for (let index = 0; index < fileResults.length; index += 1) {
    const fileResult = fileResults[index];
    const bestAccuracy = getBestAccuracy(fileResult.accuracy);
    await renderHeatmap(
      `fileChart${index}`,
      `${fileResult.source.label}<br><sup>best ${(bestAccuracy * 100).toFixed(1)}%</sup>`,
      fileResult.accuracy,
      fileResult.correctCounts,
      fileResult.comparedCounts,
    );
  }

  let bestAccuracy = Number.NEGATIVE_INFINITY;
  let bestMaxCrossings = MAX_CROSSINGS_VALUES[0];
  let bestRawCutoff = RAW_CUTOFF_VALUES[0];
  for (let rowIndex = 0; rowIndex < MAX_CROSSINGS_VALUES.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < RAW_CUTOFF_VALUES.length; columnIndex += 1) {
      const accuracy = aggregate.accuracy[rowIndex][columnIndex];
      if (!Number.isFinite(accuracy) || accuracy <= bestAccuracy) continue;
      bestAccuracy = accuracy;
      bestMaxCrossings = MAX_CROSSINGS_VALUES[rowIndex];
      bestRawCutoff = RAW_CUTOFF_VALUES[columnIndex];
    }
  }

  setSummary(
    Number.isFinite(bestAccuracy)
      ? `Best aggregate cell: maxCrossingsPerPeriod=${bestMaxCrossings}, minLogCorr=${bestRawCutoff.toFixed(1)}, accuracy=${(bestAccuracy * 100).toFixed(1)}%`
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
    const fileResults = [await runSingleSweep(preparedSample)];

    await renderResults(fileResults);
    setStatus(`Done. ${MAX_CROSSINGS_VALUES.length * RAW_CUTOFF_VALUES.length} runs.`);
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
