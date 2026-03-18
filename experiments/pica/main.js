import { analyzePreparedPitchSample, loadPitchSample } from "./picaExperiment.js";
import { createActualLabelEditor } from "./actualLabels.js";
import { renderPicaPitchCharts } from "./charts.js";
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
let currentResult = null;
let hasPrintedMaterializedActualPitch = false;

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

function updatePerformanceInfo(result) {
  const infoElement = document.getElementById("perfInfo");
  infoElement.innerHTML = `
    <table class="perf-table">
      <thead>
        <tr>
          <th></th>
          ${result.methods.map((method) => `<th>${method.label}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>Realtime</th>
          ${result.methods
            .map((method) => `<td>${getRealtimeLabel(method.msPerSecondAudio)}</td>`)
            .join("")}
        </tr>
        <tr>
          <th>Accuracy</th>
          ${result.methods.map((method) => `<td>${getMethodAccuracyLabel(result, method.key)}</td>`).join("")}
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

async function renderResult(result) {
  const autoFixButton = document.getElementById("autoFixButton");
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

  autoFixButton.disabled = !actualLabelEditor;
  updateActualPitchInfo();

  await renderPicaPitchCharts(result, {
    selectedWindowIndex: readStoredWindowIndex(),
    getWaveformWindow: (windowIndex) => getPicaWaveformWindow(result, windowIndex),
    actualLabelEditor,
    onLabelChange: () => {
      updateActualPitchInfo();
    },
    onWindowSelect: writeStoredWindowIndex,
  });

  // if (!hasPrintedMaterializedActualPitch) {
  //   hasPrintedMaterializedActualPitch = true;
  //   console.log("Materialized actual pitch", actualLabelEditor ? result.actualPitchHz : null);
  // }
}

function getStatusText(sourceLabel, result) {
  const settings = result.picaSettings;
  return `Loaded ${sourceLabel}. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, picaWindow=${PICA_WINDOW_SAMPLES_AT_48K} samples @ 48k, maxExtremaPerFold=${settings.maxExtremaPerFold}, maxCrossingsPerPeriod=${settings.maxCrossingsPerPeriod}, maxPatches=${settings.maxComparisonPatches}, maxWalk=${settings.maxWalkSteps}, carryThr=${settings.carryForwardCorrelationThreshold.toFixed(3)}, corrHzRatio=${settings.correlationToHzWeightRatio.toFixed(3)}`;
}

async function analyzePreparedSample(preparedSample, sourceLabel, settingInputs) {
  const settings = getSettingsFromInputs(settingInputs);
  writeStoredSettings(settings);
  const result = await analyzePreparedPitchSample(preparedSample, settings);
  currentResult = result;
  await renderResult(result);
  updatePerformanceInfo(result);
  setStatus(getStatusText(sourceLabel, result));
}

async function autoFixActuals(controls, sourceSelect) {
  if (!currentResult || !hasActuals(currentResult)) return;
  setControlsDisabled(controls, true);
  try {
    setStatus("Auto-fixing actuals...");
    const actualLabelEditor = createActualLabelEditor(
      getSelectedSource(sourceSelect).key,
      currentResult,
      (windowIndex) => getPicaWaveformWindow(currentResult, windowIndex),
    );
    actualLabelEditor.autoFixFromFft();
    await renderResult(currentResult);
    setStatus(`Auto-fixed actuals for ${getSelectedSource(sourceSelect).label}.`);
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setControlsDisabled(controls, false);
  }
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
  const sourceSelect = document.getElementById("sourceSelect");
  const recordButton = document.getElementById("recordButton");
  const autoFixButton = document.getElementById("autoFixButton");
  const candidatePanelDetails = document.getElementById("candidatePanelDetails");
  const settingInputs = Object.fromEntries(
    PICA_SETTING_FIELDS.map((field) => [field.key, document.getElementById(field.key)]),
  );
  const controls = [recordButton, autoFixButton, sourceSelect, ...Object.values(settingInputs)];
  autoFixButton.disabled = true;

  writeSettingsToInputs(settingInputs, getStoredSettings());
  const selectedSource = resolveSelectedSource(
    getAudioSources(),
    localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) || readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  renderSourceOptions(sourceSelect, selectedSource.key);
  candidatePanelDetails.open = readStoredCandidatePanelOpen();

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

  autoFixButton.addEventListener("click", () => {
    void autoFixActuals(controls, sourceSelect);
  });

  candidatePanelDetails.addEventListener("toggle", () => {
    writeStoredCandidatePanelOpen(candidatePanelDetails.open);
  });

  sourceSelect.addEventListener("change", () =>
    rerun(controls, sourceSelect, settingInputs, "Analyzing selected source...", async () =>
      loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect))),
    ),
  );

  PICA_SETTING_FIELDS.forEach((field) => {
    settingInputs[field.key].addEventListener("input", () =>
      rerun(controls, sourceSelect, settingInputs, `Applying ${field.label}...`),
    );
  });

  void rerun(controls, sourceSelect, settingInputs, "Analyzing selected source...", async () =>
    loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect))),
  );
}

main();
