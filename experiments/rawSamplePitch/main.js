import { analyzePreparedPitchSample, loadPitchSample } from "./analysis.js";
import { createActualLabelEditor } from "./actualLabels.js";
import { renderRawSamplePitchCharts } from "./charts.js";
import {
  DEFAULT_ASSET_URL,
  RAW_SETTING_FIELDS,
  RAW_SETTINGS_DEFAULTS,
  RAW_TOGGLE_FIELDS,
  RECORD_DURATION_MS,
} from "./config.js";
import { getRawWaveformWindow, RAW_SAMPLE_WINDOW_SAMPLES_AT_48K } from "./windowing.js";
import { recordMicrophoneAudio } from "../micCapture.js";
import {
  getAudioSources,
  loadAudioInputForSource,
  readSelectedAudioSourceKey,
  resolveSelectedSource,
  saveRecordedAudio,
  writeSelectedAudioSourceKey,
} from "../audioSource.js";

const STORAGE_PREFIX = "voicebox.rawSamplePitch.";
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
  const raw = localStorage.getItem(getStorageKey(key));
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isNaN(value) ? fallback : value;
}

function writeStoredNumber(key, value) {
  localStorage.setItem(getStorageKey(key), String(value));
}

function readStoredBoolean(key, fallback) {
  const raw = localStorage.getItem(getStorageKey(key));
  if (raw === null) return fallback;
  return raw === "true";
}

function writeStoredBoolean(key, value) {
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
  return {
    ...Object.fromEntries(
      RAW_SETTING_FIELDS.map((field) => [
        field.key,
        readStoredNumber(field.key, RAW_SETTINGS_DEFAULTS[field.key]),
      ]),
    ),
    ...Object.fromEntries(
      RAW_TOGGLE_FIELDS.map((field) => [
        field.key,
        readStoredBoolean(field.key, RAW_SETTINGS_DEFAULTS[field.key]),
      ]),
    ),
  };
}

function writeStoredSettings(settings) {
  RAW_SETTING_FIELDS.forEach((field) => {
    writeStoredNumber(field.key, settings[field.key]);
  });
  RAW_TOGGLE_FIELDS.forEach((field) => {
    writeStoredBoolean(field.key, settings[field.key]);
  });
}

function getSettingsFromInputs(settingInputs) {
  return {
    ...Object.fromEntries(
      RAW_SETTING_FIELDS.map((field) => [field.key, Number(settingInputs[field.key].value)]),
    ),
    ...Object.fromEntries(
      RAW_TOGGLE_FIELDS.map((field) => [field.key, settingInputs[field.key].checked]),
    ),
  };
}

function writeSettingsToInputs(settingInputs, settings) {
  RAW_SETTING_FIELDS.forEach((field) => {
    settingInputs[field.key].value = String(settings[field.key]);
  });
  RAW_TOGGLE_FIELDS.forEach((field) => {
    settingInputs[field.key].checked = settings[field.key];
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

function updatePerformanceInfo(result) {
  const infoElement = document.getElementById("perfInfo");
  const fftRealtime = 1000 / result.perf.voiceboxPipelineMsPerSecondAudio;
  const rawRealtime = 1000 / result.perf.rawPipelineMsPerSecondAudio;
  if (result.metrics.actualComparedCount > 0) {
    infoElement.textContent =
      `Realtime - Voicebox FFT ${fftRealtime.toFixed(1)}x, Voicebox Raw ${rawRealtime.toFixed(1)}x, ` +
      `FFT accuracy ${(result.metrics.fftAccuracy * 100).toFixed(1)}% (${result.metrics.fftCorrectCount}/${result.metrics.actualComparedCount}), ` +
      `Raw accuracy ${(result.metrics.rawAccuracy * 100).toFixed(1)}% (${result.metrics.rawCorrectCount}/${result.metrics.actualComparedCount})`;
    return;
  }
  infoElement.textContent = `Realtime - Voicebox FFT ${fftRealtime.toFixed(1)}x, Voicebox Raw ${rawRealtime.toFixed(1)}x`;
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
        (windowIndex) => getRawWaveformWindow(result, windowIndex),
      )
    : null;

  function updateActualPitchInfo() {
    document.getElementById("actualPitchInfo").textContent = actualLabelEditor
      ? `Actual labels ${actualLabelEditor.getLabelCount()}. Shortcuts: A/D move, Q/E copy, W null + next, S forget + next.`
      : "No actual labels for this source.";
  }

  autoFixButton.disabled = !actualLabelEditor;
  updateActualPitchInfo();

  await renderRawSamplePitchCharts(result, {
    selectedWindowIndex: readStoredWindowIndex(),
    getWaveformWindow: (windowIndex) => getRawWaveformWindow(result, windowIndex),
    actualLabelEditor,
    onLabelChange: () => {
      updateActualPitchInfo();
    },
    onWindowSelect: writeStoredWindowIndex,
  });

  if (!hasPrintedMaterializedActualPitch) {
    hasPrintedMaterializedActualPitch = true;
    console.log("Materialized actual pitch", actualLabelEditor ? result.actualPitchHz : null);
  }
}

function getStatusText(sourceLabel, result) {
  const settings = result.rawSettings;
  return `Loaded ${sourceLabel}. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, rawWindow=${RAW_SAMPLE_WINDOW_SAMPLES_AT_48K} samples @ 48k, maxExtremaPerFold=${settings.maxExtremaPerFold}, maxCrossingsPerPeriod=${settings.maxCrossingsPerPeriod}, maxPatches=${settings.maxComparisonPatches}, maxWalk=${settings.maxWalkSteps}, minLogCorr=${settings.rawGlobalLogCorrelationCutoff.toFixed(2)}, hzWeight=${settings.hzWeight.toFixed(2)}, corrWeight=${settings.correlationWeight.toFixed(2)}, peakinessWeight=${settings.peakinessWeight.toFixed(2)}, normHz=${settings.normalizeHz}, normCorr=${settings.normalizeCorrelation}, normPeak=${settings.normalizePeakiness}`;
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
      (windowIndex) => getRawWaveformWindow(currentResult, windowIndex),
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
    [...RAW_SETTING_FIELDS, ...RAW_TOGGLE_FIELDS].map((field) => [
      field.key,
      document.getElementById(field.key),
    ]),
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

  RAW_SETTING_FIELDS.forEach((field) => {
    settingInputs[field.key].addEventListener("input", () =>
      rerun(controls, sourceSelect, settingInputs, `Applying ${field.label}...`),
    );
  });
  RAW_TOGGLE_FIELDS.forEach((field) => {
    settingInputs[field.key].addEventListener("change", () =>
      rerun(controls, sourceSelect, settingInputs, `Applying ${field.label}...`),
    );
  });

  void rerun(controls, sourceSelect, settingInputs, "Analyzing selected source...", async () =>
    loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect))),
  );
}

main();
