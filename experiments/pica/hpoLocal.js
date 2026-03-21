import { PICA_SETTING_FIELDS, PICA_SETTINGS_DEFAULTS } from "./config.js";
import { analyzePreparedActualPitchSample, loadActualPitchSample } from "./picaExperiment.js";

const STORAGE_PREFIX = "voicebox.picaPitch.";
const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const VOCAL_SAMPLER_LABEL = "vocal_sampler.wav";
const POINT_OFFSETS = [-2, -1, 0, 1, 2];
const METHOD_KEY = "carryForward";
const METHOD_LABEL = "Carry-forward";

let preparedSamplePromise = null;
let isRunningAll = false;
let currentFingerprint = "";
const chartFingerprintByKey = new Map();
const settingInputs = new Map();
const settingEnabledInputs = new Map();
const chartCards = new Map();
let sharedAccuracyRange = [0, 100];

function appendRunLog(text) {
  const runLog = document.getElementById("runLog");
  runLog.textContent += `${text}\n`;
  runLog.scrollTop = runLog.scrollHeight;
}

function clearRunLog() {
  document.getElementById("runLog").textContent = "";
}

function waitForPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function getStorageKey(settingKey) {
  return `${STORAGE_PREFIX}${settingKey}`;
}

function getEnabledStorageKey(settingKey) {
  return `${getStorageKey(settingKey)}.enabled`;
}

function readStoredNumber(key, fallback) {
  const stored = localStorage.getItem(getStorageKey(key));
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isNaN(value) ? fallback : value;
}

function writeStoredNumber(key, value) {
  localStorage.setItem(getStorageKey(key), String(value));
}

function readStoredBoolean(key, fallback) {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  if (stored === "true") return true;
  if (stored === "false") return false;
  return fallback;
}

function writeStoredBoolean(key, value) {
  localStorage.setItem(key, String(value));
}

function getPrecision(step) {
  const stepText = String(step);
  const dotIndex = stepText.indexOf(".");
  return dotIndex === -1 ? 0 : stepText.length - dotIndex - 1;
}

function getSettings() {
  return Object.fromEntries(
    PICA_SETTING_FIELDS.map((field) => [field.key, Number(settingInputs.get(field.key).value)]),
  );
}

function getSettingsFingerprint(settings) {
  return JSON.stringify(PICA_SETTING_FIELDS.map((field) => [field.key, settings[field.key]]));
}

function getSelectedFields() {
  return PICA_SETTING_FIELDS.filter((field) => settingEnabledInputs.get(field.key)?.checked);
}

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function updateDirtyState() {
  const rerunAllButton = document.getElementById("rerunAllButton");
  const isDirty = getSelectedFields().some(
    (field) => chartFingerprintByKey.get(field.key) !== currentFingerprint,
  );
  rerunAllButton.classList.toggle("dirty", isDirty);
}

function updateChartVisibility() {
  PICA_SETTING_FIELDS.forEach((field) => {
    const card = chartCards.get(field.key);
    if (!card) return;
    card.hidden = !settingEnabledInputs.get(field.key)?.checked;
  });
}

function buildPointValues(field, currentValue) {
  const precision = getPrecision(field.step);
  return POINT_OFFSETS.map((offset) =>
    Number((currentValue + offset * field.step).toFixed(precision)),
  );
}

async function getPreparedSample() {
  preparedSamplePromise ??= loadActualPitchSample(VOCAL_SAMPLER_URL);
  return preparedSamplePromise;
}

function getMethodSummary(result) {
  return {
    accuracy: result.metrics.accuracyByMethodKey?.[METHOD_KEY]?.accuracy ?? Number.NaN,
    msPerSecondAudio: result.perf?.carryForwardPipelineMsPerSecondAudio ?? Number.NaN,
  };
}

async function getPointResult(settings) {
  const preparedSample = await getPreparedSample();
  const result = await analyzePreparedActualPitchSample(preparedSample, settings, false);
  return getMethodSummary(result);
}

function getAccuracyRangeFromCharts(chartPointsByKey) {
  const accuracyValues = Array.from(chartPointsByKey.values())
    .flat()
    .map((point) => point.accuracy * 100)
    .filter((value) => Number.isFinite(value));
  if (accuracyValues.length === 0) {
    return [0, 100];
  }
  const accuracyMin = Math.min(...accuracyValues);
  const accuracyMax = Math.max(...accuracyValues);
  const accuracyPadding = Math.max(0.2, (accuracyMax - accuracyMin) * 0.15);
  return [accuracyMin - accuracyPadding, accuracyMax + accuracyPadding];
}

async function getChartPoints(field, settings) {
  const values = buildPointValues(field, settings[field.key]);
  setStatus(`Running ${field.inputLabel} around ${settings[field.key]}...`);

  const points = [];
  for (const value of values) {
    const pointSettings = {
      ...settings,
      [field.key]: value,
    };
    const result = await getPointResult(pointSettings);
    const point = {
      value,
      realtime:
        Number.isFinite(result.msPerSecondAudio) && result.msPerSecondAudio > 0
          ? 1000 / result.msPerSecondAudio
          : Number.NaN,
      accuracy: result.accuracy,
    };
    points.push(point);
    const logLine =
      `${field.inputLabel}=${point.value} -> ` +
      `x realtime ${Number.isFinite(point.realtime) ? point.realtime.toFixed(2) : "n/a"}, ` +
      `accuracy ${Number.isFinite(point.accuracy) ? (point.accuracy * 100).toFixed(1) : "n/a"}%`;
    console.log(logLine);
    appendRunLog(logLine);
    await waitForPaint();
  }

  return points;
}

async function renderChart(field, settings, points) {
  const chartId = `chart-${field.key}`;
  await globalThis.Plotly.newPlot(
    chartId,
    [
      {
        type: "scatter",
        mode: "lines+markers",
        x: points.map((point) => point.realtime),
        y: points.map((point) => point.accuracy * 100),
        text: points.map((point) => `${field.inputLabel}=${point.value}`),
        customdata: points.map((point) => point.value),
        line: { color: "#60a5fa", width: 2 },
        marker: {
          size: 18,
          color: points.map((_, pointIndex) => (pointIndex === 2 ? "#22c55e" : "#60a5fa")),
          line: { color: "#020617", width: 1.5 },
        },
        hovertemplate: `${field.inputLabel}=%{customdata}<br>x realtime=%{x:.2f}<br>accuracy=%{y:.1f}%<extra></extra>`,
        showlegend: false,
      },
    ],
    {
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 64, r: 24, t: 24, b: 58 },
      xaxis: { title: "x realtime", gridcolor: "#1f2937" },
      yaxis: {
        title: "accuracy",
        gridcolor: "#1f2937",
        range: sharedAccuracyRange,
      },
    },
    { responsive: true },
  );

  const chartElement = document.getElementById(chartId);
  chartElement.on("plotly_click", (event) => {
    const value = event.points?.[0]?.customdata;
    if (value === undefined) return;
    void setCurrentValueAndRerun(field, value);
  });

  chartFingerprintByKey.set(field.key, currentFingerprint);
  updateDirtyState();
  setStatus(
    `Loaded ${VOCAL_SAMPLER_LABEL}. ${METHOD_LABEL} local sensitivity updated for ${field.inputLabel}.`,
  );
}

async function setCurrentValueAndRerun(field, value) {
  const input = settingInputs.get(field.key);
  input.value = String(value);
  writeStoredNumber(field.key, value);
  const settings = getSettings();
  currentFingerprint = getSettingsFingerprint(settings);
  updateDirtyState();
  const points = await getChartPoints(field, settings);
  const chartPointsByKey = new Map();
  chartPointsByKey.set(field.key, points);
  sharedAccuracyRange = getAccuracyRangeFromCharts(chartPointsByKey);
  await renderChart(field, settings, points);
}

async function rerunAllCharts() {
  if (isRunningAll) return;
  isRunningAll = true;
  const rerunAllButton = document.getElementById("rerunAllButton");
  rerunAllButton.disabled = true;
  const selectedFields = getSelectedFields();
  const settings = getSettings();
  currentFingerprint = getSettingsFingerprint(settings);
  clearRunLog();
  try {
    if (selectedFields.length === 0) {
      setStatus("Select at least one parameter to run.", true);
      return;
    }
    const chartPointsByKey = new Map();
    for (let index = 0; index < selectedFields.length; index += 1) {
      const field = selectedFields[index];
      setStatus(`Running ${index + 1}/${selectedFields.length}: ${field.inputLabel}`);
      chartPointsByKey.set(field.key, await getChartPoints(field, settings));
    }
    sharedAccuracyRange = getAccuracyRangeFromCharts(chartPointsByKey);
    for (const field of selectedFields) {
      await renderChart(field, settings, chartPointsByKey.get(field.key));
    }
    setStatus(`Done. ${selectedFields.length * POINT_OFFSETS.length} runs.`);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    isRunningAll = false;
    rerunAllButton.disabled = false;
    updateDirtyState();
  }
}

function createSettingInput(field) {
  const label = document.createElement("label");
  label.className = "toolbar-field";

  const text = document.createElement("span");
  text.textContent = field.inputLabel;

  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = readStoredBoolean(getEnabledStorageKey(field.key), true);
  enabledInput.title = `Include ${field.inputLabel} when running all charts`;
  enabledInput.addEventListener("input", () => {
    writeStoredBoolean(getEnabledStorageKey(field.key), enabledInput.checked);
    updateChartVisibility();
    updateDirtyState();
  });

  const input = document.createElement("input");
  input.id = field.key;
  input.className = "toolbar-number";
  input.type = "number";
  input.min = String(field.min);
  input.max = String(field.max);
  input.step = String(field.step);
  input.title = field.title;
  input.value = String(readStoredNumber(field.key, PICA_SETTINGS_DEFAULTS[field.key]));
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (Number.isNaN(value)) return;
    writeStoredNumber(field.key, value);
    currentFingerprint = getSettingsFingerprint(getSettings());
    updateDirtyState();
  });

  label.append(text, enabledInput, input);
  settingInputs.set(field.key, input);
  settingEnabledInputs.set(field.key, enabledInput);
  return label;
}

function main() {
  const inputsContainer = document.getElementById("settingInputs");
  inputsContainer.style.display = "contents";
  PICA_SETTING_FIELDS.forEach((field) => {
    inputsContainer.append(createSettingInput(field));
  });

  const charts = document.getElementById("charts");
  PICA_SETTING_FIELDS.forEach((field) => {
    const card = document.createElement("section");
    card.className = "chart-card";
    card.innerHTML = `
      <div class="chart-title">${field.inputLabel}</div>
      <div id="chart-${field.key}" class="chart-plot"></div>
    `;
    charts.append(card);
    chartCards.set(field.key, card);
  });

  updateChartVisibility();

  document.getElementById("rerunAllButton").addEventListener("click", () => {
    void rerunAllCharts();
  });
}

main();
