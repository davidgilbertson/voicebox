import {
  analyzePreparedPitchSample,
  ensurePreparedPitchSampleFftAnalysis,
  loadPitchSample,
} from "./picaExperiment.js";
import { createActualLabelEditor } from "./actualLabels.js";
import { readStoredSelectedMethods, renderPicaPitchCharts } from "./charts.js";
import {
  DEFAULT_ASSET_URL,
  PICA_ACCURACY_CENTS,
  PICA_SETTING_FIELDS,
  PICA_SETTINGS_DEFAULTS,
  RECORD_DURATION_MS,
} from "./config.js";
import { getCurrentMethodDefinition, normalizeSelectedMethods } from "./methodRegistry.js";
import { getDetectorWindowSamples, getWaveformWindow, getWindowEndSample } from "./windowing.js";
import { getPicaPitchAnalysisFromWaveform } from "./picaPitch.js";
import { getPifsPitchHzFromWaveform } from "./pifsPitch.js";
import { getPipsPointsFromWaveform } from "./pipsPitch.js";
import { getPiraPitchHzFromWaveform } from "./piraPitch.js";
import { ensureExperimentDebugGlobals } from "./debugGlobals.js";
import { getCentsDifference } from "./utils.js";
import { recordMicrophoneAudio } from "../micCapture.js";
import {
  getAudioSources,
  loadAudioInputForSource,
  readSelectedAudioSourceKey,
  resolveSelectedSource,
  saveRecordedAudio,
  writeSelectedAudioSourceKey,
} from "../audioSource.js";

const STORAGE_PREFIX = "vb.exp.";
const SELECTED_SOURCE_STORAGE_KEY = `${STORAGE_PREFIX}selectedSourceKey`;
const SELECTED_WINDOW_STORAGE_KEY = `${STORAGE_PREFIX}selectedWindowIndex`;
const POST_PROCESSING_STORAGE_KEY = `${STORAGE_PREFIX}postProcessingEnabled`;
let currentPreparedSample = null;
let currentControls = [];
let currentSourceSelect = null;
let currentSettingInputs = null;
let pendingChartResizeToken = 0;
let hasLoggedVocalSamplerErrorSummary = false;

ensureExperimentDebugGlobals();

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

function readStoredPostProcessingEnabled() {
  const value = localStorage.getItem(POST_PROCESSING_STORAGE_KEY);
  return value === null ? true : value === "true";
}

function writeStoredPostProcessingEnabled(enabled) {
  localStorage.setItem(POST_PROCESSING_STORAGE_KEY, String(enabled));
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

function getMainPageFields() {
  return [...PICA_SETTING_FIELDS].sort((left, right) => {
    const leftUsesNewestExperiment =
      left.usedWith.includes("PIZA") || left.usedWith.includes("PICA2") ? 1 : 0;
    const rightUsesNewestExperiment =
      right.usedWith.includes("PIZA") || right.usedWith.includes("PICA2") ? 1 : 0;
    return leftUsesNewestExperiment - rightUsesNewestExperiment;
  });
}

function renderSettingInputs() {
  const paramsColumn = document.getElementById("paramsColumn");
  paramsColumn.innerHTML = `
    <table class="params-table">
      <thead>
        <tr>
          <th>Param</th>
          <th>Value</th>
          <th>Used With</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  const paramsTableBody = paramsColumn.querySelector("tbody");

  const settingInputs = {};
  for (const field of getMainPageFields()) {
    const row = document.createElement("tr");

    const labelCell = document.createElement("td");
    const label = document.createElement("label");
    label.htmlFor = field.key;
    label.textContent = field.key;
    labelCell.append(label);

    const input = document.createElement("input");
    input.id = field.key;
    input.className = "toolbar-number";
    input.type = "number";
    input.value = String(PICA_SETTINGS_DEFAULTS[field.key]);
    input.title = field.title;
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    const inputCell = document.createElement("td");
    inputCell.append(input);

    const usedWithCell = document.createElement("td");
    const usedWith = document.createElement("span");
    usedWith.className = "params-used-with";
    usedWith.textContent = field.usedWith.join(", ");
    usedWithCell.append(usedWith);

    row.append(labelCell, inputCell, usedWithCell);
    paramsTableBody.append(row);
    settingInputs[field.key] = input;
  }

  return settingInputs;
}

function updateSettingVisibility(settingInputs, selectedMethods) {
  const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
  PICA_SETTING_FIELDS.forEach((field) => {
    const row = settingInputs[field.key]?.closest("tr");
    if (!row) return;
    row.hidden = !field.usedWith.some((methodKey) => normalizedSelectedMethods[methodKey]);
  });
}

function getSettingsFromInputs(settingInputs) {
  return {
    ...Object.fromEntries(
      PICA_SETTING_FIELDS.map((field) => [field.key, Number(settingInputs[field.key].value)]),
    ),
    postProcessingEnabled: readStoredPostProcessingEnabled(),
  };
}

function writeSettingsToInputs(settingInputs, settings) {
  PICA_SETTING_FIELDS.forEach((field) => {
    settingInputs[field.key].value = String(settings[field.key]);
    settingInputs[field.key].dataset.appliedValue = String(settings[field.key]);
  });
}

function hasPendingSettingChange(input) {
  return input.value !== input.dataset.appliedValue;
}

async function applySettingsFromInputs(
  controls,
  sourceSelect,
  settingInputs,
  statusText,
  focusTarget = null,
) {
  const settings = getSettingsFromInputs(settingInputs);
  const wasApplied = await rerun(controls, sourceSelect, settingInputs, statusText);
  if (wasApplied) {
    PICA_SETTING_FIELDS.forEach((field) => {
      settingInputs[field.key].dataset.appliedValue = String(settings[field.key]);
    });
  }
  focusTarget?.focus({ preventScroll: true });
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
      [
        "pitchChart",
        "waveformChart",
        "harmonicChart",
        "correlationHeatmapChart",
        "slopePeakChart",
        "foldChart",
      ].forEach((chartId) => {
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

function updatePerformanceInfo(result, selectedMethods = readStoredSelectedMethods()) {
  const infoElement = document.getElementById("perfInfo");
  const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
  const visibleMethods = result.methods.filter((method) => normalizedSelectedMethods[method.key]);
  infoElement.innerHTML = `
    <table class="perf-table">
      <thead>
        <tr>
          <th></th>
          ${visibleMethods.map((method) => `<th>${method.key}</th>`).join("")}
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
  localStorage.removeItem(POST_PROCESSING_STORAGE_KEY);
  location.reload();
}

function logVocalSamplerPicaErrorSummary(preparedSample, settings) {
  const actualPitchHz = preparedSample.actualPitchHz;
  if (!Array.isArray(actualPitchHz) || actualPitchHz.length === 0) return;

  let comparedWindowCount = 0;
  let errorWindowCount = 0;
  let hadCorrectCandidateCount = 0;
  let missedCorrectCandidateCount = 0;
  let falseReportCount = 0;
  let nullActualWindowCount = 0;
  const semitoneErrorBins = {};
  let noPredictionErrorCount = 0;

  for (
    let windowIndex = 0;
    windowIndex < preparedSample.windowSequence.windowCount;
    windowIndex += 1
  ) {
    const actualHz = actualPitchHz[windowIndex];
    const windowSamples = getDetectorWindowSamples(
      preparedSample.samples,
      preparedSample.sampleRate,
      getWindowEndSample(preparedSample.windowSequence, windowIndex),
    );
    const analysis = getPicaPitchAnalysisFromWaveform(
      windowSamples,
      preparedSample.sampleRate,
      settings,
    );
    const predictedHz = analysis.hz;

    if (!Number.isFinite(actualHz)) {
      nullActualWindowCount += 1;
      if (Number.isFinite(predictedHz)) {
        falseReportCount += 1;
      }
      continue;
    }

    comparedWindowCount += 1;
    if (getCentsDifference(predictedHz, actualHz) <= PICA_ACCURACY_CENTS) {
      continue;
    }

    errorWindowCount += 1;
    const hasCorrectCandidate = analysis.candidates.some(
      (candidate) => getCentsDifference(candidate.hz, actualHz) <= PICA_ACCURACY_CENTS,
    );
    if (hasCorrectCandidate) {
      hadCorrectCandidateCount += 1;
    } else {
      missedCorrectCandidateCount += 1;
    }

    const semitoneBinLabel = Number.isFinite(predictedHz)
      ? Math.round(12 * Math.log2(predictedHz / actualHz))
      : null;
    if (semitoneBinLabel === null) {
      noPredictionErrorCount += 1;
    } else {
      semitoneErrorBins[semitoneBinLabel] = (semitoneErrorBins[semitoneBinLabel] ?? 0) + 1;
    }
  }

  const percentage = (count, total) =>
    total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "n/a";
  const semitoneErrorRows = Object.entries(semitoneErrorBins)
    .map(([bin, count]) => [Number(bin), count])
    .sort((a, b) => a[0] - b[0])
    .map(([bin, count]) => ({
      semitones: bin,
      count,
      percent: percentage(count, errorWindowCount),
    }));
  const tooHighErrorCount = semitoneErrorRows.reduce(
    (sum, row) => (row.semitones > 0 ? sum + row.count : sum),
    0,
  );
  const tooLowErrorCount = semitoneErrorRows.reduce(
    (sum, row) => (row.semitones < 0 ? sum + row.count : sum),
    0,
  );

  console.log(`Compared windows: ${comparedWindowCount}`);
  console.log(`Main PICA errors: ${errorWindowCount}`);
  console.log(
    `Errors with correct candidate present: ${hadCorrectCandidateCount} (${percentage(hadCorrectCandidateCount, errorWindowCount)})`,
  );
  console.log(
    `Errors with no correct candidate: ${missedCorrectCandidateCount} (${percentage(missedCorrectCandidateCount, errorWindowCount)})`,
  );
  console.log(
    `False reports: ${falseReportCount} (${percentage(falseReportCount, nullActualWindowCount)} of null-actual windows, ${percentage(falseReportCount, preparedSample.windowSequence.windowCount)} of all windows)`,
  );
  console.log(
    `Error: too high: ${tooHighErrorCount} (${percentage(tooHighErrorCount, errorWindowCount)})`,
  );
  console.log(
    `Error: too low: ${tooLowErrorCount} (${percentage(tooLowErrorCount, errorWindowCount)})`,
  );
  console.log(
    `Error: no prediction: ${noPredictionErrorCount} (${percentage(noPredictionErrorCount, errorWindowCount)})`,
  );
  if (semitoneErrorRows.length > 0) {
    console.table(semitoneErrorRows);
  }
}

function logPicaDebugFoldCountBins(result) {
  if (!Array.isArray(result.actualPitchHz)) return;

  const foldAnalyses = window.pizaDebug.foldAnalyses;
  if (!Array.isArray(foldAnalyses) || foldAnalyses.length === 0) return [];

  const foldCountBins = new Map();
  const foldPeriodWindows = [];

  for (
    let windowIndex = 0;
    windowIndex < Math.min(result.actualPitchHz.length, foldAnalyses.length);
    windowIndex += 1
  ) {
    const actualHz = result.actualPitchHz[windowIndex];
    if (!Number.isFinite(actualHz) || !(actualHz > 0)) continue;

    const folds = foldAnalyses[windowIndex]?.fullFolds;
    if (!Array.isArray(folds) || folds.length === 0) continue;
    const foldWidths = folds.map((fold) => fold.width);

    const actualPeriodSize = Math.round(result.sampleRate / actualHz);
    let priorDistance = 0;
    let priorFoldCount = 0;
    let cumulativeDistance = 0;
    let snappedDistance = Number.NaN;
    let snappedFoldCount = 0;
    let boundaryFoldWidth = Number.NaN;

    for (let foldIndex = foldWidths.length - 1; foldIndex >= 0; foldIndex -= 1) {
      cumulativeDistance += foldWidths[foldIndex];

      const cumulativeFoldCount = foldWidths.length - foldIndex;
      if (cumulativeDistance < actualPeriodSize) {
        priorDistance = cumulativeDistance;
        priorFoldCount = cumulativeFoldCount;
        continue;
      }

      boundaryFoldWidth = foldWidths[foldIndex];
      const canSnapLeft = priorFoldCount > 0;
      const leftIsEven = canSnapLeft && priorFoldCount % 2 === 0;
      const rightIsEven = cumulativeFoldCount % 2 === 0;
      if (leftIsEven !== rightIsEven) {
        snappedDistance = leftIsEven ? priorDistance : cumulativeDistance;
        snappedFoldCount = leftIsEven ? priorFoldCount : cumulativeFoldCount;
      } else if (
        canSnapLeft &&
        Math.abs(actualPeriodSize - priorDistance) <=
          Math.abs(cumulativeDistance - actualPeriodSize)
      ) {
        snappedDistance = priorDistance;
        snappedFoldCount = priorFoldCount;
      } else {
        snappedDistance = cumulativeDistance;
        snappedFoldCount = cumulativeFoldCount;
      }
      break;
    }

    if (!(snappedFoldCount > 0)) continue;

    const deltaToNearestZeroCrossing = actualPeriodSize - snappedDistance;
    foldCountBins.set(snappedFoldCount, (foldCountBins.get(snappedFoldCount) ?? 0) + 1);
    foldPeriodWindows.push({
      windowIndex,
      actualPeriodSize,
      snappedDistance,
      deltaToNearestZeroCrossing,
      boundaryFoldWidth,
      foldCount: snappedFoldCount,
    });
  }

  let cumulativeCount = 0;
  const totalCount = foldPeriodWindows.length;
  console.table(
    Array.from(foldCountBins.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([foldCount, count]) => {
        cumulativeCount += count;
        return {
          foldCount,
          count,
          cumulativePercent:
            totalCount > 0 ? ((cumulativeCount / totalCount) * 100).toFixed(1) : "n/a",
        };
      }),
  );
  console.log(
    "window indices with >33 folds",
    foldPeriodWindows.filter((row) => row.foldCount > 33).map((row) => row.windowIndex),
  );
  return foldPeriodWindows;
}

function applyPicaDebugFoldCountSeries(result, foldPeriodWindows) {
  result.picaFoldCount = new Array(result.timeSec.length).fill(Number.NaN);
  if (!Array.isArray(foldPeriodWindows)) return;

  for (const row of foldPeriodWindows) {
    if (!Number.isInteger(row?.windowIndex)) continue;
    result.picaFoldCount[row.windowIndex] = row.foldCount;
  }
}

async function renderResult(result) {
  const actualLabelEditor = hasActuals(result)
    ? createActualLabelEditor(
        localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) || "",
        result,
        (windowIndex) => getWaveformWindow(result, windowIndex),
      )
    : null;

  await renderPicaPitchCharts(result, {
    selectedWindowIndex: readStoredWindowIndex(),
    settings: result.settings,
    getWaveformWindow: (windowIndex) => getWaveformWindow(result, windowIndex),
    actualLabelEditor,
    onSelectWindow: (windowIndex, waveformWindow, selectedMethods) => {
      const selectedPointIndex =
        window.piraDebug.windowIndex === windowIndex ? window.piraDebug.selectedPoint?.index : null;
      const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
      if (normalizedSelectedMethods.PIFS) {
        getPifsPitchHzFromWaveform(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        );
      } else {
        window.pifsDebug.folds = [];
        window.pifsDebug.scenarioAnalyses = [];
        window.pifsDebug.predictionReason = null;
        window.pifsDebug.periodWidth = Number.NaN;
        window.pifsDebug.foldScenario = Number.NaN;
        window.pifsDebug.ampDisplacement = Number.NaN;
        window.pifsDebug.selectedRange = null;
        window.pifsDebug.global.maxAbsSample = 1;
      }
      if (normalizedSelectedMethods.PIRA) {
        getPiraPitchHzFromWaveform(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        );
      } else {
        window.piraDebug.points = normalizedSelectedMethods.PIPS
          ? getPipsPointsFromWaveform(waveformWindow.samples, result.settings)
          : [];
        window.piraDebug.predictionSpans = [];
        window.piraDebug.predictionReason = null;
        window.piraDebug.maxAbsSample = 1;
        window.piraDebug.ampPerMilli = 0.1;
        window.piraDebug.spread = Number.NaN;
        window.piraDebug.periodSamples = Number.NaN;
      }
      window.pifsDebug.global.windowIndex = windowIndex;
      window.pifsDebug.global.waveformWindow = waveformWindow;
      window.piraDebug.windowIndex = windowIndex;
      window.piraDebug.waveformWindow = waveformWindow;
      window.piraDebug.selectedPoint =
        selectedPointIndex === null
          ? null
          : (window.piraDebug.points.find((point) => point.index === selectedPointIndex) ?? null);
    },
    onWindowSelect: writeStoredWindowIndex,
    currentMethod: getCurrentMethodDefinition(),
    onSelectedMethodsChange: (selectedMethods) => {
      if (!currentSourceSelect || !currentSettingInputs) return;
      updateSettingVisibility(currentSettingInputs, selectedMethods);
      void rerun(
        currentControls,
        currentSourceSelect,
        currentSettingInputs,
        "Applying selected methods...",
      );
    },
  });
}

async function analyzePreparedSample(preparedSample, source, settingInputs) {
  const settings = getSettingsFromInputs(settingInputs);
  writeStoredSettings(settings);
  const result = await analyzePreparedPitchSample(
    preparedSample,
    settings,
    readStoredSelectedMethods(),
  );
  if (
    !hasLoggedVocalSamplerErrorSummary &&
    source?.type === "asset" &&
    source.url?.endsWith("vocal_sampler.wav")
  ) {
    hasLoggedVocalSamplerErrorSummary = true;
    // logVocalSamplerPicaErrorSummary(preparedSample, settings);
  }
  const foldPeriodWindows = logPicaDebugFoldCountBins(result);
  applyPicaDebugFoldCountSeries(result, foldPeriodWindows);
  window.expDebug.currentSource = source ?? null;
  window.expDebug.currentResult = result;
  await renderResult(result);
  updatePerformanceInfo(result, readStoredSelectedMethods());
  setStatus("Done.");
  scheduleChartResize();
}

async function rerun(controls, sourceSelect, settingInputs, statusText, getPreparedSample) {
  setControlsDisabled(controls, true);
  try {
    setStatus(statusText);
    const selectedSource = getSelectedSource(sourceSelect);
    const selectedMethods = readStoredSelectedMethods();
    currentPreparedSample = getPreparedSample
      ? await getPreparedSample(selectedMethods)
      : (currentPreparedSample ??
        (await loadPitchSample(loadAudioInputForSource(selectedSource), selectedMethods)));
    if (normalizeSelectedMethods(selectedMethods).FFT) {
      currentPreparedSample = await ensurePreparedPitchSampleFftAnalysis(currentPreparedSample);
    }
    const resolvedSource = getSelectedSource(sourceSelect);
    await analyzePreparedSample(currentPreparedSample, resolvedSource, settingInputs);
    return true;
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), true);
    return false;
  } finally {
    setControlsDisabled(controls, false);
  }
}

function main() {
  const resetStorageButton = document.getElementById("resetStorageButton");
  const sourceSelect = document.getElementById("sourceSelect");
  const recordButton = document.getElementById("recordButton");
  const postProcessingEnabledInput = document.getElementById("postProcessingEnabled");
  const settingInputs = renderSettingInputs();
  postProcessingEnabledInput.checked = readStoredPostProcessingEnabled();
  const controls = [
    resetStorageButton,
    recordButton,
    sourceSelect,
    postProcessingEnabledInput,
    ...Object.values(settingInputs),
  ];
  currentControls = controls;
  currentSourceSelect = sourceSelect;
  currentSettingInputs = settingInputs;

  writeSettingsToInputs(settingInputs, getStoredSettings());
  updateSettingVisibility(settingInputs, readStoredSelectedMethods());
  const selectedSource = resolveSelectedSource(
    getAudioSources(),
    localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) || readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  renderSourceOptions(sourceSelect, selectedSource.key);

  resetStorageButton.addEventListener("click", () => {
    resetStoredState();
  });

  recordButton.addEventListener("click", () =>
    rerun(
      controls,
      sourceSelect,
      settingInputs,
      "Recording from microphone...",
      async (selectedMethods) => {
        const capturedAudio = await recordMicrophoneAudio({ maxDurationMs: RECORD_DURATION_MS });
        saveRecordedAudio(capturedAudio);
        const recordedSource = getAudioSources().find((source) => source.type === "recorded");
        if (recordedSource) {
          sourceSelect.value = recordedSource.key;
        }
        return loadPitchSample(capturedAudio, selectedMethods);
      },
    ),
  );

  sourceSelect.addEventListener("change", () =>
    rerun(controls, sourceSelect, settingInputs, "", async (selectedMethods) =>
      loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect)), selectedMethods),
    ),
  );

  postProcessingEnabledInput.addEventListener("change", () => {
    writeStoredPostProcessingEnabled(postProcessingEnabledInput.checked);
    void rerun(
      controls,
      sourceSelect,
      settingInputs,
      postProcessingEnabledInput.checked
        ? "Applying post processing..."
        : "Removing post processing...",
    );
  });

  PICA_SETTING_FIELDS.forEach((field) => {
    const input = settingInputs[field.key];
    let isApplying = false;

    input.addEventListener("blur", async () => {
      if (isApplying || !hasPendingSettingChange(input)) return;
      isApplying = true;
      try {
        await applySettingsFromInputs(
          controls,
          sourceSelect,
          settingInputs,
          `Applying ${field.label}...`,
        );
      } finally {
        isApplying = false;
      }
    });

    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || isApplying || !hasPendingSettingChange(input)) return;
      event.preventDefault();
      isApplying = true;
      try {
        await applySettingsFromInputs(
          controls,
          sourceSelect,
          settingInputs,
          `Applying ${field.label}...`,
          input,
        );
      } finally {
        isApplying = false;
      }
    });
  });

  void rerun(controls, sourceSelect, settingInputs, "", async (selectedMethods) =>
    loadPitchSample(loadAudioInputForSource(getSelectedSource(sourceSelect)), selectedMethods),
  );
}

main();
