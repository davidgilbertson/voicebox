import { getAssetSources } from "../audioSource.js";
import { analyzePreparedPitchSample, loadPitchSample } from "../rawSamplePitch/analysis.js";

const TOP_PEAKS = 8;
const MAX_PATCHES = 3;
const LOG_CUTOFF_VALUES = [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2];

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function setSummary(text) {
  const summary = document.getElementById("summary");
  summary.textContent = text;
}

function createEmptyRow() {
  return Array.from({ length: LOG_CUTOFF_VALUES.length }, () => Number.NaN);
}

async function runSingleSweep(preparedSample, source, runOffset, totalRuns) {
  const accuracy = createEmptyRow();
  const correctCounts = createEmptyRow();
  const comparedCounts = createEmptyRow();
  for (let cutoffIndex = 0; cutoffIndex < LOG_CUTOFF_VALUES.length; cutoffIndex += 1) {
    const runNumber = runOffset + cutoffIndex + 1;
    const logCutoff = LOG_CUTOFF_VALUES[cutoffIndex];
    const message = `Run ${runNumber}/${totalRuns}: ${source.label} | topPeaks=${TOP_PEAKS} | maxPatches=${MAX_PATCHES} | logCutoff=${logCutoff.toFixed(1)}`;
    console.log(message);
    setStatus(message);
    const result = await analyzePreparedPitchSample(preparedSample, {
      peakCount: TOP_PEAKS,
      maxComparisonPatches: MAX_PATCHES,
      logCorrelationCutoff: logCutoff,
    });
    accuracy[cutoffIndex] = result.metrics?.rawAccuracy ?? Number.NaN;
    correctCounts[cutoffIndex] = result.metrics?.rawCorrectCount ?? 0;
    comparedCounts[cutoffIndex] = result.metrics?.rawComparedCount ?? 0;
  }
  return {
    source,
    accuracy,
    correctCounts,
    comparedCounts,
  };
}

function buildAggregateHeatmap(fileResults) {
  const accuracy = createEmptyRow();
  const totalCorrectCounts = createEmptyRow();
  const totalComparedCounts = createEmptyRow();
  for (let cutoffIndex = 0; cutoffIndex < LOG_CUTOFF_VALUES.length; cutoffIndex += 1) {
    let correct = 0;
    let compared = 0;
    for (const fileResult of fileResults) {
      correct += fileResult.correctCounts[cutoffIndex] || 0;
      compared += fileResult.comparedCounts[cutoffIndex] || 0;
    }
    totalCorrectCounts[cutoffIndex] = correct;
    totalComparedCounts[cutoffIndex] = compared;
    accuracy[cutoffIndex] = compared > 0 ? correct / compared : Number.NaN;
  }
  return {
    accuracy,
    totalCorrectCounts,
    totalComparedCounts,
  };
}

async function renderHeatmap(elementId, title, accuracy, correctCounts, comparedCounts) {
  await globalThis.Plotly.newPlot(
    elementId,
    [
      {
        type: "heatmap",
        x: LOG_CUTOFF_VALUES,
        y: ["accuracy"],
        z: [
          accuracy.map((value) => (Number.isFinite(value) ? value * 100 : Number.NaN)),
        ],
        text: [
          accuracy.map((value, columnIndex) =>
            Number.isFinite(value)
              ? `${(value * 100).toFixed(1)}%<br>${correctCounts[columnIndex]}/${comparedCounts[columnIndex]}`
              : "n/a",
          ),
        ],
        texttemplate: "%{text}",
        textfont: { color: "#e2e8f0", size: 11 },
        hovertemplate: `topPeaks=${TOP_PEAKS}<br>maxPatches=${MAX_PATCHES}<br>logCutoff=%{x}<br>accuracy=%{z:.1f}%<extra></extra>`,
        colorscale: "Viridis",
        zmin: 0,
        zmax: 100,
      },
    ],
    {
      title,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 56, r: 24, t: 52, b: 44 },
      xaxis: { title: "logCutoff", tickmode: "array", tickvals: LOG_CUTOFF_VALUES },
      yaxis: { title: "", showticklabels: false },
    },
    { responsive: true },
  );
}

async function renderResults(fileResults) {
  const aggregate = buildAggregateHeatmap(fileResults);
  await renderHeatmap(
    "overallChart",
    "Aggregate Accuracy Across All Files",
    aggregate.accuracy,
    aggregate.totalCorrectCounts,
    aggregate.totalComparedCounts,
  );

  const perFileCharts = document.getElementById("perFileCharts");
  perFileCharts.innerHTML = fileResults
    .map((fileResult, index) => `<div id="fileChart${index}" class="file-chart"></div>`)
    .join("");

  for (let index = 0; index < fileResults.length; index += 1) {
    const fileResult = fileResults[index];
    await renderHeatmap(
      `fileChart${index}`,
      fileResult.source.label,
      fileResult.accuracy,
      fileResult.correctCounts,
      fileResult.comparedCounts,
    );
  }

  let bestAccuracy = Number.NEGATIVE_INFINITY;
  let bestLogCutoff = LOG_CUTOFF_VALUES[0];
  for (let cutoffIndex = 0; cutoffIndex < LOG_CUTOFF_VALUES.length; cutoffIndex += 1) {
    const value = aggregate.accuracy[cutoffIndex];
    if (!Number.isFinite(value) || value <= bestAccuracy) continue;
    bestAccuracy = value;
    bestLogCutoff = LOG_CUTOFF_VALUES[cutoffIndex];
  }
  setSummary(
    Number.isFinite(bestAccuracy)
      ? `Best aggregate cell: topPeaks=${TOP_PEAKS}, maxPatches=${MAX_PATCHES}, logCutoff=${bestLogCutoff.toFixed(1)}, accuracy=${(bestAccuracy * 100).toFixed(1)}%`
      : "No valid results.",
  );
}

async function runSweep() {
  const runButton = document.getElementById("runButton");
  runButton.disabled = true;
  try {
    const sources = getAssetSources();
    const fileResults = [];
    const totalRuns = sources.length * LOG_CUTOFF_VALUES.length;
    let completedRuns = 0;
    for (const source of sources) {
      const loadMessage = `Loading ${source.label}...`;
      console.log(loadMessage);
      setStatus(loadMessage);
      const preparedSample = await loadPitchSample(source.url);
      const fileResult = await runSingleSweep(preparedSample, source, completedRuns, totalRuns);
      fileResults.push(fileResult);
      completedRuns += LOG_CUTOFF_VALUES.length;
      setStatus(`Completed ${completedRuns}/${totalRuns} runs`);
    }
    await renderResults(fileResults);
    setStatus(`Done. ${sources.length} files, ${totalRuns} runs.`);
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

void runSweep();
