import { analyzePreparedPitchSample, loadPitchSample } from "./picaExperiment.js";
import { createActualLabelEditor } from "./actualLabels.js";
import { readStoredMethodVisibility, renderPicaPitchCharts } from "./charts.js";
import {
  DEFAULT_ASSET_URL,
  PICA_SETTING_FIELDS,
  PICA_SETTINGS_DEFAULTS,
  RECORD_DURATION_MS,
} from "./config.js";
import { getPicaWaveformWindow, PICA_WINDOW_SAMPLES_AT_48K } from "./windowing.js";
import { recordMicrophoneAudio } from "../micCapture.js";
import {
  getAudioSources,
  loadAudioInputForSource,
  readSelectedAudioSourceKey,
  resolveSelectedSource,
  saveRecordedAudio,
  writeSelectedAudioSourceKey,
} from "../audioSource.js";

const STORAGE_PREFIX = "voicebox.picaPitch.";
const SELECTED_SOURCE_STORAGE_KEY = `${STORAGE_PREFIX}selectedSourceKey`;
const SELECTED_WINDOW_STORAGE_KEY = `${STORAGE_PREFIX}selectedWindowIndex`;
const CANDIDATE_PANEL_OPEN_STORAGE_KEY = `${STORAGE_PREFIX}candidatePanelOpen`;

let currentPreparedSample = null;
let currentControls = [];
let currentSourceSelect = null;
let currentSettingInputs = null;
let pendingChartResizeToken = 0;

function getStorageKey(settingKey) {
  return `${STORAGE_PREFIX}${settingKey}`;
}

function readStoredNumber(key, fallback) {
  const val = localStorage.getItem(getStorageKey(key));
  if (val === null) return fallback;
  const value = Number(val);
  return Number.isNaN(value) ? fallback : value;
}

function writeStoredNumber(key, value) {
  localStorage.setItem(getStorageKey(key), String(value));
}

function readStoredWindowIndex() {
  const value = Number.parseInt(localStorage.getItem(SELECTED_WINDOW_STORAGE_KEY) ?? "", 10);
  return Number.isNaN(value) ? 0 : value;
}

function writeStoredWindowIndex(windowIndex) {
  localStorage.setItem(SELECTED_WINDOW_STORAGE_KEY, String(windowIndex));
}

function readStoredCandidatePanelOpen() {
  const stored = localStorage.getItem(CANDIDATE_PANEL_OPEN_STORAGE_KEY);
  return stored !== "false";
}

function writeStoredCandidatePanelOpen(isOpen) {
  localStorage.setItem(CANDIDATE_PANEL_OPEN_STORAGE_KEY, String(isOpen));
}

function getStoredSettings() {
  return Object.fromEntries(
    PICA_SETTING_FIELDS.map((field) => [
      field.key,
      readStoredNumber(field.key, PICA_SETTINGS_DEFAULTS[field.key]),
    ]),
  );
}

function writeStoredSettings(settings) {
  PICA_SETTING_FIELDS.forEach((field) => {
    writeStoredNumber(field.key, settings[field.key]);
  });
}

function getSettingsFromInputs(settingInputs) {
  return Object.fromEntries(
    PICA_SETTING_FIELDS.map((field) => [field.key, Number(settingInputs[field.key].value)]),
  );
}

function writeSettingsToInputs(settingInputs, settings) {
  PICA_SETTING_FIELDS.forEach((field) => {
    settingInputs[field.key].value = String(settings[field.key]);
  });
}

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function scheduleChartResize() {
  const resizeToken = ++pendingChartResizeToken;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (resizeToken !== pendingChartResizeToken) return;
      const plotly = globalThis.Plotly;
      if (!plotly?.Plots?.resize) return;
      ["pitchChart", "waveformChart", "harmonicChart"].forEach((chartId) => {
        const chart = document.getElementById(chartId);
        if (chart) {
          plotly.Plots.resize(chart);
        }
      });
    });
  });
}

function hasActuals(result) {
  return Array.isArray(result.actualPitchHz);
}

function getRealtimeLabel(msPerSecondAudio) {
  return Number.isFinite(msPerSecondAudio) && msPerSecondAudio > 0
    ? `${(1000 / msPerSecondAudio).toFixed(1)}x`
    : "n/a";
}

function getAccuracyLabel(accuracy, correctCount, comparedCount) {
  if (!(comparedCount > 0) || !Number.isFinite(accuracy)) {
    return "n/a";
  }
  return `<span class="perf-accuracy">${(accuracy * 100).toFixed(1)}%</span> (${correctCount}/${comparedCount})`;
}

function getMethodAccuracyLabel(result, methodKey) {
  const summary = result.metrics.accuracyByMethodKey?.[methodKey];
  return getAccuracyLabel(summary?.accuracy, summary?.correctCount, summary?.comparedCount);
}

function updatePerformanceInfo(result, methodVisibility = readStoredMethodVisibility()) {
  const infoElement = document.getElementById("perfInfo");
  const visibleMethods = result.methods.filter((method) => methodVisibility[method.key]);
  infoElement.innerHTML = `
    <table class="perf-table">
      <thead>
        <tr>
          <th></th>
          ${visibleMethods.map((method) => `<th>${method.label}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Realtime</th>
          ${visibleMethods
            .map((method) => `<td>${getRealtimeLabel(method.msPerSecondAudio)}</td>`)
            .join("")}
        </tr>
        <tr>
          <th>Accuracy</th>
          ${visibleMethods.map((method) => `<td>${getMethodAccuracyLabel(result, method.key)}</td>`).join("")}
        </tr>
      </tbody>
    </table>
  `;
}

function renderSourceOptions(sourceSelect, selectedKey) {
  const sources = getAudioSources();
  sourceSelect.innerHTML = "";
  sources.forEach((source) => {
    const option = document.createElement("option");
    option.value = source.key;
    option.textContent = source.label;
    sourceSelect.append(option);
  });
  sourceSelect.value = selectedKey;
}

function getSelectedSource(sourceSelect) {
  const sources = getAudioSources();
  const selected = resolveSelectedSource(
    sources,
    sourceSelect.value ||
      localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) ||
      readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  renderSourceOptions(sourceSelect, selected.key);
  localStorage.setItem(SELECTED_SOURCE_STORAGE_KEY, selected.key);
  writeSelectedAudioSourceKey(selected.key);
  return selected;
}

function setControlsDisabled(controls, disabled) {
  controls.forEach((control) => {
    control.disabled = disabled;
  });
  document.body.classList.toggle("loading", disabled);
}

function resetStoredState() {
  PICA_SETTING_FIELDS.forEach((field) => {
    localStorage.removeItem(getStorageKey(field.key));
  });
  location.reload();
}

async function renderResult(result) {
  const actualLabelEditor = hasActuals(result)
    ? createActualLabelEditor(
        localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) || "",
        result,
        (windowIndex) => getPicaWaveformWindow(result, windowIndex),
      )
    : null;

  function updateActualPitchInfo() {
    document.getElementById("actualPitchInfo").textContent = actualLabelEditor
      ? `Actual labels ${actualLabelEditor.getLabelCount()}. Shortcuts: A/D move always. Q/E copy, W null + next, S forget + next in labeling mode.`
      : "No actual labels for this source. Shortcuts: A/D move.";
  }

  updateActualPitchInfo();

  await renderPicaPitchCharts(result, {
    selectedWindowIndex: readStoredWindowIndex(),
    getWaveformWindow: (windowIndex) => getPicaWaveformWindow(result, windowIndex),
    actualLabelEditor,
    onLabelChange: () => {
      updateActualPitchInfo();
    },
    onWindowSelect: writeStoredWindowIndex,
    onMethodVisibilityChange: () => {
      if (!currentSourceSelect || !currentSettingInputs) return;
      void rerun(
        currentControls,
        currentSourceSelect,
        currentSettingInputs,
        "Applying method filters...",
      );
    },
  });
}

async function analyzePreparedSample(preparedSample, sourceLabel, settingInputs) {
  const settings = getSettingsFromInputs(settingInputs);
  writeStoredSettings(settings);
  const result = await analyzePreparedPitchSample(
    preparedSample,
    settings,
    readStoredMethodVisibility(),
  );
  await renderResult(result);
  updatePerformanceInfo(result, readStoredMethodVisibility());
  setStatus("Done.");
  scheduleChartResize();
}

async function rerun(controls, sourceSelect, settingInputs, statusText, getPreparedSample) {
  setControlsDisabled(controls, true);
  try {
    setStatus(statusText);
    currentPreparedSample = getPreparedSample
      ? await getPreparedSample()
      : (currentPreparedSample ??
        (await loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect)))));
    await analyzePreparedSample(
      currentPreparedSample,
      getSelectedSource(sourceSelect).label,
      settingInputs,
    );
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setControlsDisabled(controls, false);
  }
}

function main() {
  const resetStorageButton = document.getElementById("resetStorageButton");
  const sourceSelect = document.getElementById("sourceSelect");
  const recordButton = document.getElementById("recordButton");
  const candidatePanelDetails = document.getElementById("candidatePanelDetails");
  const settingInputs = Object.fromEntries(
    PICA_SETTING_FIELDS.map((field) => [field.key, document.getElementById(field.key)]),
  );
  const controls = [
    resetStorageButton,
    recordButton,
    sourceSelect,
    ...Object.values(settingInputs),
  ];
  currentControls = controls;
  currentSourceSelect = sourceSelect;
  currentSettingInputs = settingInputs;

  writeSettingsToInputs(settingInputs, getStoredSettings());
  const selectedSource = resolveSelectedSource(
    getAudioSources(),
    localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) || readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  renderSourceOptions(sourceSelect, selectedSource.key);
  candidatePanelDetails.open = readStoredCandidatePanelOpen();

  resetStorageButton.addEventListener("click", () => {
    resetStoredState();
  });

  recordButton.addEventListener("click", () =>
    rerun(controls, sourceSelect, settingInputs, "Recording from microphone...", async () => {
      const capturedAudio = await recordMicrophoneAudio({ maxDurationMs: RECORD_DURATION_MS });
      saveRecordedAudio(capturedAudio);
      const recordedSource = getAudioSources().find((source) => source.type === "recorded");
      if (recordedSource) {
        sourceSelect.value = recordedSource.key;
      }
      return loadPitchSample(capturedAudio);
    }),
  );

  candidatePanelDetails.addEventListener("toggle", () => {
    writeStoredCandidatePanelOpen(candidatePanelDetails.open);
  });

  sourceSelect.addEventListener("change", () =>
    rerun(controls, sourceSelect, settingInputs, "", async () =>
      loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect))),
    ),
  );

  PICA_SETTING_FIELDS.forEach((field) => {
    settingInputs[field.key].addEventListener("input", () =>
      rerun(controls, sourceSelect, settingInputs, `Applying ${field.label}...`),
    );
  });

  void rerun(controls, sourceSelect, settingInputs, "", async () =>
    loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect))),
  );
}

main();
