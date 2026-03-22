import { PICA_SETTING_FIELDS, PICA_SETTINGS_DEFAULTS } from "./config.js";
import { analyzePreparedActualPitchSample, loadActualPitchSample } from "./picaExperiment.js";

const STORAGE_PREFIX = "voicebox.picaPitch.";
const VOCAL_SAMPLER_URL = "../../.private/assets/vocal_sampler.wav";
const VOCAL_SAMPLER_LABEL = "vocal_sampler.wav";
const METHOD_KEY = "carryForward";
const METHOD_LABEL = "Carry-forward";
const DEFAULT_STEP_COUNT = 5;

let preparedSamplePromise = null;
let isRunningAll = false;
let currentFingerprint = "";
const chartFingerprintByKey = new Map();
const settingMidpointInputs = new Map();
const settingStepInputs = new Map();
const settingStepCountInputs = new Map();
const settingEnabledInputs = new Map();
const settingValuePreviews = new Map();
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

function getStepStorageKey(settingKey) {
  return `${getStorageKey(settingKey)}.step`;
}

function getStepsStorageKey(settingKey) {
  return `${getStorageKey(settingKey)}.steps`;
}

function readStoredNumber(key, fallback) {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isNaN(value) ? fallback : value;
}

function writeStoredNumber(key, value) {
  localStorage.setItem(key, String(value));
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

function isIntegerField(field) {
  return Number.isInteger(field.step);
}

function isValueWithinSensibleRange(field, value) {
  if (field.min !== undefined && value < field.min) return false;
  if (field.max !== undefined && value > field.max) return false;
  return true;
}

function getStepCount(field) {
  const steps = Math.trunc(Number(settingStepCountInputs.get(field.key).value));
  return Number.isFinite(steps) ? Math.max(1, steps) : DEFAULT_STEP_COUNT;
}

function getFieldInputValues(field) {
  const midpoint = Number(settingMidpointInputs.get(field.key).value);
  const step = Number(settingStepInputs.get(field.key).value);
  const steps = getStepCount(field);
  return { midpoint, step, steps };
}

function getSettings() {
  return Object.fromEntries(
    PICA_SETTING_FIELDS.map((field) => [field.key, getFieldInputValues(field).midpoint]),
  );
}

function getSettingsFingerprint(settings) {
  return JSON.stringify(
    PICA_SETTING_FIELDS.map((field) => {
      const { midpoint, step, steps } = getFieldInputValues(field);
      return [field.key, settings[field.key], midpoint, step, steps];
    }),
  );
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

function buildPointValues(field) {
  const { midpoint, step, steps } = getFieldInputValues(field);
  const offsetRadius = Math.floor(steps / 2);
  const values = Array.from({ length: steps }, (_, index) =>
    isIntegerField(field)
      ? Math.round(midpoint + (index - offsetRadius) * step)
      : midpoint + (index - offsetRadius) * step,
  ).filter((value) => isValueWithinSensibleRange(field, value));
  return [...new Set(values)];
}

function updateValuePreview(field) {
  const preview = settingValuePreviews.get(field.key);
  if (!preview) return;
  const values = buildPointValues(field);
  preview.textContent = values.length === 0 ? "No in-range values" : values.join(", ");
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
  const values = buildPointValues(field);
  if (values.length === 0) {
    setStatus(`No in-range values for ${field.inputLabel}.`, true);
    return [];
  }
  setStatus(`Running ${field.inputLabel} from ${values[0]} to ${values.at(-1)}...`);

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
          color: points.map((point, pointIndex) => {
            if (point.value === settings[field.key]) return "#22c55e";
            const alpha = points.length <= 1 ? 1 : 0.5 + (pointIndex / (points.length - 1)) * 0.5;
            return `rgba(96, 165, 250, ${alpha})`;
          }),
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
  const nextMidpoint = value;
  settingMidpointInputs.get(field.key).value = String(nextMidpoint);
  writeStoredNumber(getStorageKey(field.key), nextMidpoint);
  updateValuePreview(field);
  const settings = getSettings();
  currentFingerprint = getSettingsFingerprint(settings);
  updateDirtyState();
  const points = await getChartPoints(field, settings);
  const chartPointsByKey = new Map();
  chartPointsByKey.set(field.key, points);
  sharedAccuracyRange = getAccuracyRangeFromCharts(chartPointsByKey);
  await renderChart(field, settings, points);
}

async function rerunChart(field) {
  if (isRunningAll) return;
  const settings = getSettings();
  currentFingerprint = getSettingsFingerprint(settings);
  try {
    const points = await getChartPoints(field, settings);
    const chartPointsByKey = new Map();
    chartPointsByKey.set(field.key, points);
    sharedAccuracyRange = getAccuracyRangeFromCharts(chartPointsByKey);
    await renderChart(field, settings, points);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    updateDirtyState();
  }
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
    const totalRuns = selectedFields.reduce(
      (count, field) => count + buildPointValues(field).length,
      0,
    );
    setStatus(`Done. ${totalRuns} runs.`);
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
  const row = document.createElement("div");
  row.className = "settings-grid settings-row";

  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.className = "settings-checkbox";
  enabledInput.checked = readStoredBoolean(getEnabledStorageKey(field.key), true);
  enabledInput.title = `Include ${field.inputLabel} when running all charts`;
  enabledInput.addEventListener("input", () => {
    writeStoredBoolean(getEnabledStorageKey(field.key), enabledInput.checked);
    updateChartVisibility();
    updateDirtyState();
  });

  const currentValue = readStoredNumber(
    getStorageKey(field.key),
    PICA_SETTINGS_DEFAULTS[field.key],
  );
  const midpointInput = document.createElement("input");
  midpointInput.className = "toolbar-number";
  midpointInput.type = "number";
  midpointInput.step = "any";
  midpointInput.title = `${field.title} Midpoint value`;
  midpointInput.value = String(readStoredNumber(getStorageKey(field.key), currentValue));
  midpointInput.addEventListener("input", () => {
    const value = Number(midpointInput.value);
    if (Number.isNaN(value)) return;
    writeStoredNumber(getStorageKey(field.key), value);
    currentFingerprint = getSettingsFingerprint(getSettings());
    updateValuePreview(field);
    updateDirtyState();
  });

  const stepInput = document.createElement("input");
  stepInput.className = "toolbar-number";
  stepInput.type = "number";
  stepInput.step = "any";
  stepInput.title = `${field.title} Step size`;
  stepInput.value = String(readStoredNumber(getStepStorageKey(field.key), field.step));
  stepInput.addEventListener("input", () => {
    const value = Number(stepInput.value);
    if (Number.isNaN(value)) return;
    writeStoredNumber(getStepStorageKey(field.key), value);
    currentFingerprint = getSettingsFingerprint(getSettings());
    updateValuePreview(field);
    updateDirtyState();
  });

  const stepsInput = document.createElement("input");
  stepsInput.className = "toolbar-number settings-steps";
  stepsInput.type = "number";
  stepsInput.min = "1";
  stepsInput.step = "1";
  stepsInput.title = `Number of points to sample for ${field.inputLabel}`;
  stepsInput.value = String(readStoredNumber(getStepsStorageKey(field.key), DEFAULT_STEP_COUNT));
  stepsInput.addEventListener("input", () => {
    const value = Number(stepsInput.value);
    if (Number.isNaN(value)) return;
    writeStoredNumber(getStepsStorageKey(field.key), value);
    currentFingerprint = getSettingsFingerprint(getSettings());
    updateValuePreview(field);
    updateDirtyState();
  });

  const rerunButton = document.createElement("button");
  rerunButton.className = "toolbar-btn";
  rerunButton.type = "button";
  rerunButton.textContent = "Re-run";
  rerunButton.addEventListener("click", () => {
    void rerunChart(field);
  });

  const valuesPreview = document.createElement("div");
  valuesPreview.className = "settings-values";

  row.innerHTML = `<div class="settings-label" title="${field.title}">${field.inputLabel}</div>`;
  row.append(enabledInput, midpointInput, stepInput, stepsInput, rerunButton, valuesPreview);

  settingMidpointInputs.set(field.key, midpointInput);
  settingStepInputs.set(field.key, stepInput);
  settingStepCountInputs.set(field.key, stepsInput);
  settingEnabledInputs.set(field.key, enabledInput);
  settingValuePreviews.set(field.key, valuesPreview);
  updateValuePreview(field);
  return row;
}

function main() {
  const inputsContainer = document.getElementById("settingInputs");
  const rows = document.createElement("div");
  rows.className = "settings-body";
  rows.setAttribute("role", "rowgroup");
  PICA_SETTING_FIELDS.forEach((field) => {
    rows.append(createSettingInput(field));
  });
  inputsContainer.append(rows);

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
