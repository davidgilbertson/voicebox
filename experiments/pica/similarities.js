import { loadActualPitchSample } from "./picaExperiment.js";

const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const TIMESTEPS_PER_SECOND = 80;
const TIMESTEP_STRIDE = 5;
const SELECTED_WINDOW_STORAGE_KEY = "voicebox.picaPitch.selectedWindowIndex";
const STORED_ACTUALS_KEY = "voicebox.picaPitch.actualPitchVocalSampler";
const CATEGORY_CONFIGS = [
  { key: "half", label: "Half", factor: 0.5 },
  { key: "actual", label: "Actual", factor: 1 },
  { key: "double", label: "Double", factor: 2 },
];
const METHOD_CONFIGS = [
  { key: "cosine", label: "Cosine", chartId: "cosineChart", cardId: "cosineCard" },
  {
    key: "weightedCosine",
    label: "Weighted Cosine",
    chartId: "weightedCosineChart",
    cardId: "weightedCosineCard",
  },
  { key: "mae", label: "MAE Similarity", chartId: "maeChart", cardId: "maeCard" },
  { key: "rmse", label: "RMSE Similarity", chartId: "rmseChart", cardId: "rmseCard" },
];
const SIMILARITY_BY_METHOD_KEY = {
  cosine: getCosineSimilarity,
  weightedCosine: getWeightedCosineSimilarity,
  mae: getMaeSimilarity,
  rmse: getRmseSimilarity,
};
const DEFAULT_TRACE_COLOR = "rgba(148, 163, 184, 0.22)";
const SELECTED_TRACE_COLOR = "rgba(248, 113, 113, 0.98)";
const DEFAULT_MARKER_SIZE = 6;
const SELECTED_MARKER_SIZE = 9;
const SCORE_EPSILON = 1e-9;

const state = {
  sampleRate: 0,
  samples: null,
  comparisonRows: [],
  summaryByMethod: {},
  runtimeByMethod: {},
  wrongIndicesByMethod: {},
  selectedTimestepIndex: null,
};

function setStatus(text, isError = false) {
  const statusPanel = document.getElementById("statusPanel");
  statusPanel.textContent = text;
  statusPanel.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function setLoading(isLoading) {
  document.body.classList.toggle("loading", isLoading);
}

function readStoredSelectedTimestepIndex() {
  const value = Number.parseInt(localStorage.getItem(SELECTED_WINDOW_STORAGE_KEY) ?? "", 10);
  return Number.isNaN(value) ? null : value;
}

function writeStoredSelectedTimestepIndex(timestepIndex) {
  localStorage.setItem(SELECTED_WINDOW_STORAGE_KEY, String(timestepIndex));
}

function readStoredActualLabels() {
  try {
    return JSON.parse(localStorage.getItem(STORED_ACTUALS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function getResolvedActualPitchHz(baseActualPitchHz, storedActualLabels, timestepIndex) {
  if (Object.hasOwn(storedActualLabels, String(timestepIndex))) {
    return storedActualLabels[timestepIndex];
  }
  return baseActualPitchHz[timestepIndex];
}

function getAmplitudeRange(samples) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample < min) min = sample;
    if (sample > max) max = sample;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [-1, 1];
  }
  if (min === max) {
    return [min - 0.05, max + 0.05];
  }
  const padding = Math.max(0.02, (max - min) * 0.1);
  return [min - padding, max + padding];
}

function getPatchMaxAbs(samples, start, patchSize) {
  let maxAbs = 0;
  for (let offset = 0; offset < patchSize; offset += 1) {
    maxAbs = Math.max(maxAbs, Math.abs(samples[start + offset]));
  }
  return maxAbs;
}

function getCosineSimilarity(samples, leftStart, rightStart, patchSize) {
  let dot = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let offset = 0; offset < patchSize; offset += 1) {
    const left = samples[leftStart + offset];
    const right = samples[rightStart + offset];
    dot += left * right;
    leftPower += left * left;
    rightPower += right * right;
  }
  if (leftPower <= 0 || rightPower <= 0) {
    return Number.NaN;
  }
  return dot / Math.sqrt(leftPower * rightPower);
}

function getWeightedCosineSimilarity(samples, leftStart, rightStart, patchSize) {
  let leftMaxAbs = 0;
  let rightMaxAbs = 0;
  for (let offset = 0; offset < patchSize; offset += 1) {
    leftMaxAbs = Math.max(leftMaxAbs, Math.abs(samples[leftStart + offset]));
    rightMaxAbs = Math.max(rightMaxAbs, Math.abs(samples[rightStart + offset]));
  }
  let dot = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let offset = 0; offset < patchSize; offset += 1) {
    const left = samples[leftStart + offset];
    const right = samples[rightStart + offset];
    dot += left * right;
    leftPower += left * left;
    rightPower += right * right;
  }
  if (leftPower <= 0 || rightPower <= 0) {
    return Number.NaN;
  }
  const largerPeak = Math.max(leftMaxAbs, rightMaxAbs);
  if (largerPeak <= 0) {
    return Number.NaN;
  }
  return (
    (dot / Math.sqrt(leftPower * rightPower)) * (Math.min(leftMaxAbs, rightMaxAbs) / largerPeak)
  );
}

function getMaeSimilarity(samples, leftStart, rightStart, patchSize) {
  const maxAbs = getPatchMaxAbs(samples, leftStart, patchSize * 2);
  if (maxAbs <= 0) {
    return Number.NaN;
  }
  let absError = 0;
  for (let offset = 0; offset < patchSize; offset += 1) {
    const left = samples[leftStart + offset] / maxAbs;
    const right = samples[rightStart + offset] / maxAbs;
    absError += Math.abs(left - right);
  }
  return 1 - absError / patchSize;
}

function getRmseSimilarity(samples, leftStart, rightStart, patchSize) {
  const maxAbs = getPatchMaxAbs(samples, leftStart, patchSize * 2);
  if (maxAbs <= 0) {
    return Number.NaN;
  }
  let squaredError = 0;
  for (let offset = 0; offset < patchSize; offset += 1) {
    const error = samples[leftStart + offset] / maxAbs - samples[rightStart + offset] / maxAbs;
    squaredError += error * error;
  }
  return 1 - Math.sqrt(squaredError / patchSize);
}

function buildComparisonRow(samples, sampleRate, timestepIndex, actualHz, runtimeByMethod) {
  if (!Number.isFinite(actualHz) || !(actualHz > 0)) {
    return null;
  }

  const actualPeriodSamples = Math.max(1, Math.round(sampleRate / actualHz));
  const endSample = Math.min(
    samples.length,
    Math.max(0, Math.round((timestepIndex / TIMESTEPS_PER_SECOND) * sampleRate)),
  );
  if (endSample < actualPeriodSamples * 4) {
    return null;
  }

  const scoresByMethod = {};
  for (const method of METHOD_CONFIGS) {
    const compare = SIMILARITY_BY_METHOD_KEY[method.key];
    const startTime = performance.now();
    scoresByMethod[method.key] = CATEGORY_CONFIGS.map((category) => {
      const patchSize = Math.max(1, Math.round(actualPeriodSamples * category.factor));
      const rightStart = endSample - patchSize;
      const leftStart = rightStart - patchSize;
      return compare(samples, leftStart, rightStart, patchSize);
    });
    runtimeByMethod[method.key].runtimeMs += performance.now() - startTime;
    runtimeByMethod[method.key].comparisonCount += CATEGORY_CONFIGS.length;
  }

  return {
    timestepIndex,
    timeSec: timestepIndex / TIMESTEPS_PER_SECOND,
    actualHz,
    actualPeriodSamples,
    endSample,
    scoresByMethod,
  };
}

function getSelectedRow() {
  return (
    state.comparisonRows.find((row) => row.timestepIndex === state.selectedTimestepIndex) ?? null
  );
}

function getNearestSampledTimestepIndex(timestepIndex) {
  if (!Number.isInteger(timestepIndex) || state.comparisonRows.length === 0) {
    return state.comparisonRows[0]?.timestepIndex ?? null;
  }

  let nearestIndex = state.comparisonRows[0].timestepIndex;
  let nearestDistance = Math.abs(nearestIndex - timestepIndex);
  for (const row of state.comparisonRows) {
    const distance = Math.abs(row.timestepIndex - timestepIndex);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = row.timestepIndex;
    }
  }
  return nearestIndex;
}

function getMethodSummary(rows, methodKey) {
  let comparableCount = 0;
  let actualLargestCount = 0;
  const wrongIndices = [];

  for (const row of rows) {
    const [halfScore, actualScore, doubleScore] = row.scoresByMethod[methodKey];
    if (
      !Number.isFinite(halfScore) ||
      !Number.isFinite(actualScore) ||
      !Number.isFinite(doubleScore)
    ) {
      continue;
    }

    comparableCount += 1;
    if (actualScore > halfScore + SCORE_EPSILON) {
      actualLargestCount += 1;
    } else {
      wrongIndices.push(row.timestepIndex);
    }
  }

  return {
    comparableCount,
    actualLargestCount,
    wrongIndices,
    actualLargestPct:
      comparableCount > 0 ? (actualLargestCount / comparableCount) * 100 : Number.NaN,
  };
}

function formatMethodScore(methodKey) {
  const summary = state.summaryByMethod[methodKey];
  if (!(summary?.comparableCount > 0) || !Number.isFinite(summary.actualLargestPct)) {
    return "n/a";
  }
  return `${summary.actualLargestPct.toFixed(1)}%`;
}

function formatMethodRuntime(methodKey) {
  const runtime = state.runtimeByMethod[methodKey];
  if (!(runtime?.comparisonCount > 0) || !Number.isFinite(runtime.runtimeMs)) {
    return "n/a";
  }

  const microsecondsPerComparison = (runtime.runtimeMs * 1000) / runtime.comparisonCount;
  return `${runtime.runtimeMs.toFixed(2)} ms total | ${microsecondsPerComparison.toFixed(2)} us/compare`;
}

function renderScorePanel() {
  METHOD_CONFIGS.forEach((method) => {
    const cardElement = document.getElementById(method.cardId);
    const summary = state.summaryByMethod[method.key];
    if (!cardElement) {
      return;
    }

    cardElement.innerHTML = `
      <div class="score-label">${method.label}</div>
      <div class="score-value">${formatMethodScore(method.key)}</div>
      <div class="score-detail">Actual beat half on ${summary?.actualLargestCount ?? 0}/${summary?.comparableCount ?? 0} sampled steps</div>
      <div class="score-detail">${formatMethodRuntime(method.key)}</div>
      <button class="score-button" type="button" ${summary?.wrongIndices?.length ? "" : "disabled"}>Next wrong</button>
    `;
    cardElement.querySelector(".score-button")?.addEventListener("click", () => {
      void selectNextWrongForMethod(method.key);
    });
  });
}

function createTrace(row, methodKey) {
  const isSelected = row.timestepIndex === state.selectedTimestepIndex;
  return {
    x: CATEGORY_CONFIGS.map((category) => category.label),
    y: row.scoresByMethod[methodKey],
    type: "scatter",
    mode: "lines+markers",
    customdata: CATEGORY_CONFIGS.map(() => [
      row.timestepIndex,
      row.timeSec,
      row.actualHz,
      row.actualPeriodSamples,
    ]),
    hovertemplate:
      "Index=%{customdata[0]}<br>Time=%{customdata[1]:.3f}s<br>Actual=%{customdata[2]:.2f} Hz<br>Period=%{customdata[3]} samples<br>%{x}: %{y:.4f}<extra></extra>",
    line: {
      color: isSelected ? SELECTED_TRACE_COLOR : DEFAULT_TRACE_COLOR,
      width: isSelected ? 2.5 : 1,
    },
    marker: {
      color: isSelected ? SELECTED_TRACE_COLOR : DEFAULT_TRACE_COLOR,
      size: isSelected ? SELECTED_MARKER_SIZE : DEFAULT_MARKER_SIZE,
    },
    showlegend: false,
  };
}

function getOrderedTraces(methodKey) {
  const selectedRow = getSelectedRow();
  const traces = state.comparisonRows
    .filter((row) => row.timestepIndex !== selectedRow?.timestepIndex)
    .map((row) => createTrace(row, methodKey));
  if (selectedRow) {
    traces.push(createTrace(selectedRow, methodKey));
  }
  return traces;
}

async function selectNextWrongForMethod(methodKey) {
  const wrongIndices = state.summaryByMethod[methodKey]?.wrongIndices ?? [];
  if (wrongIndices.length === 0) {
    return;
  }

  const currentIndex = wrongIndices.indexOf(state.selectedTimestepIndex);
  const nextWrongIndex =
    currentIndex >= 0
      ? wrongIndices[(currentIndex + 1) % wrongIndices.length]
      : (wrongIndices.find((index) => index > (state.selectedTimestepIndex ?? -1)) ??
        wrongIndices[0]);
  await selectTimestep(nextWrongIndex);
}

async function renderSimilarityCharts() {
  const plotly = globalThis.Plotly;
  const selectedRow = getSelectedRow();

  for (const method of METHOD_CONFIGS) {
    const chartElement = document.getElementById(method.chartId);
    const scoreLabel = formatMethodScore(method.key);
    await plotly.react(
      chartElement,
      getOrderedTraces(method.key),
      {
        title: selectedRow
          ? `${method.label} (${scoreLabel} actual > half, selected index ${selectedRow.timestepIndex})`
          : `${method.label} (${scoreLabel} actual > half)`,
        paper_bgcolor: "#0b0b0b",
        plot_bgcolor: "#0b0b0b",
        font: { color: "#e2e8f0" },
        margin: { l: 56, r: 18, t: 56, b: 56 },
        xaxis: {
          title: "Patch Length",
          type: "category",
          categoryorder: "array",
          categoryarray: CATEGORY_CONFIGS.map((category) => category.label),
          gridcolor: "#1f2937",
        },
        yaxis: {
          title: "Similarity Score",
          gridcolor: "#1f2937",
          zerolinecolor: "#334155",
        },
      },
      { responsive: true },
    );

    if (!chartElement.dataset.clickBound) {
      chartElement.on("plotly_click", (event) => {
        const timestepIndex = Number(event.points?.[0]?.customdata?.[0]);
        if (!Number.isInteger(timestepIndex)) {
          return;
        }
        void selectTimestep(timestepIndex);
      });
      chartElement.dataset.clickBound = "true";
    }
  }
}

async function renderWaveform() {
  const plotly = globalThis.Plotly;
  const selectedRow = getSelectedRow();
  const waveformChart = document.getElementById("waveformChart");

  if (!selectedRow) {
    await plotly.react(
      waveformChart,
      [],
      {
        title: "Waveform",
        paper_bgcolor: "#0b0b0b",
        plot_bgcolor: "#0b0b0b",
        font: { color: "#e2e8f0" },
        margin: { l: 56, r: 18, t: 56, b: 56 },
        xaxis: { visible: false },
        yaxis: { visible: false },
      },
      { responsive: true },
    );
    return;
  }

  const startSample = selectedRow.endSample - selectedRow.actualPeriodSamples * 4;
  const waveformSamples = state.samples.subarray(startSample, selectedRow.endSample);
  const sampleOffsets = Array.from({ length: waveformSamples.length }, (_, index) => index);
  const halfPeriodSamples = selectedRow.actualPeriodSamples / 2;

  await plotly.react(
    waveformChart,
    [
      {
        x: sampleOffsets,
        y: Array.from(waveformSamples),
        type: "scatter",
        mode: "lines",
        line: { width: 1.8, color: "rgba(74, 222, 128, 0.95)" },
        hovertemplate: "Offset=%{x}<br>Amp=%{y:.4f}<extra></extra>",
        showlegend: false,
      },
    ],
    {
      title: `Waveform for index ${selectedRow.timestepIndex} (${selectedRow.actualHz.toFixed(2)} Hz, ${selectedRow.actualPeriodSamples} samples per period, showing 4 periods)`,
      paper_bgcolor: "#0b0b0b",
      plot_bgcolor: "#0b0b0b",
      font: { color: "#e2e8f0" },
      margin: { l: 56, r: 18, t: 56, b: 56 },
      xaxis: {
        title: "Samples in displayed 4-period window",
        gridcolor: "#1f2937",
      },
      yaxis: {
        title: "Amplitude",
        range: getAmplitudeRange(waveformSamples),
        gridcolor: "#1f2937",
      },
      shapes: Array.from({ length: 7 }, (_, index) => index + 1).map((multiple) => ({
        type: "line",
        xref: "x",
        yref: "paper",
        x0: halfPeriodSamples * multiple,
        x1: halfPeriodSamples * multiple,
        y0: 0,
        y1: 1,
        line: {
          color: multiple % 2 === 0 ? "rgba(248, 250, 252, 0.9)" : "rgba(148, 163, 184, 0.6)",
          width: multiple % 2 === 0 ? 2.5 : 1,
          dash: multiple % 2 === 0 ? "solid" : "dot",
        },
      })),
      annotations: Array.from({ length: 4 }, (_, index) => ({
        x: selectedRow.actualPeriodSamples * (index + 0.5),
        y: 1,
        xref: "x",
        yref: "paper",
        yanchor: "bottom",
        text: `P${index + 1}`,
        showarrow: false,
        font: { color: "#cbd5e1", size: 11 },
      })),
    },
    { responsive: true },
  );
}

function renderSelectionInfo() {
  const selectedRow = getSelectedRow();
  const selectionInfo = document.getElementById("selectionInfo");
  if (!selectedRow) {
    selectionInfo.textContent = `Loaded ${state.comparisonRows.length} sampled timesteps at stride ${TIMESTEP_STRIDE}.`;
    return;
  }

  selectionInfo.textContent =
    `Selected timestep index ${selectedRow.timestepIndex} | ` +
    `time ${selectedRow.timeSec.toFixed(3)} s | ` +
    `actual ${selectedRow.actualHz.toFixed(2)} Hz | ` +
    `period ${selectedRow.actualPeriodSamples} samples | ` +
    `stride ${TIMESTEP_STRIDE}`;
}

async function selectTimestep(timestepIndex) {
  state.selectedTimestepIndex = getNearestSampledTimestepIndex(timestepIndex);
  if (state.selectedTimestepIndex !== null) {
    writeStoredSelectedTimestepIndex(state.selectedTimestepIndex);
  }
  renderSelectionInfo();
  await renderSimilarityCharts();
  await renderWaveform();
}

async function main() {
  setLoading(true);
  setStatus("Loading vocal sampler actuals...");

  try {
    const preparedSample = await loadActualPitchSample(VOCAL_SAMPLER_URL);
    if (!Array.isArray(preparedSample.actualPitchHz)) {
      throw new Error("Expected vocal_sampler_actual.json to load actual pitch values.");
    }
    const storedActualLabels = readStoredActualLabels();
    const resolvedActualPitchHz = preparedSample.actualPitchHz.map((actualHz, timestepIndex) =>
      getResolvedActualPitchHz(preparedSample.actualPitchHz, storedActualLabels, timestepIndex),
    );

    state.sampleRate = preparedSample.sampleRate;
    state.samples = preparedSample.samples;
    state.runtimeByMethod = Object.fromEntries(
      METHOD_CONFIGS.map((method) => [
        method.key,
        {
          runtimeMs: 0,
          comparisonCount: 0,
        },
      ]),
    );
    state.comparisonRows = [];
    for (
      let timestepIndex = 0;
      timestepIndex < resolvedActualPitchHz.length;
      timestepIndex += TIMESTEP_STRIDE
    ) {
      const row = buildComparisonRow(
        preparedSample.samples,
        preparedSample.sampleRate,
        timestepIndex,
        resolvedActualPitchHz[timestepIndex],
        state.runtimeByMethod,
      );
      if (row) {
        state.comparisonRows.push(row);
      }
    }
    state.summaryByMethod = Object.fromEntries(
      METHOD_CONFIGS.map((method) => [
        method.key,
        getMethodSummary(state.comparisonRows, method.key),
      ]),
    );
    state.wrongIndicesByMethod = Object.fromEntries(
      METHOD_CONFIGS.map((method) => [method.key, state.summaryByMethod[method.key].wrongIndices]),
    );
    state.selectedTimestepIndex = getNearestSampledTimestepIndex(readStoredSelectedTimestepIndex());

    renderScorePanel();
    await selectTimestep(state.selectedTimestepIndex);

    const storedOverrideCount = Object.keys(storedActualLabels).length;
    setStatus(
      `Loaded vocal_sampler.wav at ${preparedSample.sampleRate} Hz. ` +
        `${state.comparisonRows.length} sampled timesteps from ${resolvedActualPitchHz.length} ` +
        `using stride ${TIMESTEP_STRIDE}. Stored actual overrides: ${storedOverrideCount}. ` +
        `Click any line in the top row to sync all three charts and inspect the waveform below.`,
    );
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setLoading(false);
  }
}

void main();
