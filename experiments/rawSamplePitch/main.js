import {
  analyzePreparedPitchSample,
  getHigherCandidateDiagnosticForWindow,
  getSampleMaxHigherCandidateDiagnostic,
  loadPitchSample,
} from "./analysis.js";
import { renderRawSamplePitchCharts } from "./charts.js";
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

const SELECTED_WINDOW_STORAGE_KEY = "voicebox.rawSamplePitch.selectedWindowIndex";
const TOP_PEAK_COUNT_STORAGE_KEY = "voicebox.rawSamplePitch.topPeakCount";
const LOG_CORRELATION_CUTOFF_STORAGE_KEY = "voicebox.rawSamplePitch.logCorrelationCutoff";
const MAX_COMPARISON_PATCHES_STORAGE_KEY = "voicebox.rawSamplePitch.maxComparisonPatches";
const MAX_WALK_STEPS_STORAGE_KEY = "voicebox.rawSamplePitch.maxWalkSteps";
const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
const RECORD_DURATION_MS = 5000;
const DEFAULT_TOP_PEAK_COUNT = 8;
const DEFAULT_LOG_CORRELATION_CUTOFF = 2;
const DEFAULT_MAX_COMPARISON_PATCHES = 3;
const DEFAULT_MAX_WALK_STEPS = 10;

function exposeResultForDebug(result) {
  window.rawSamplePitchDebug = {
    result,
    getHigherCandidateDiagnostic(windowIndex, minRatio = 1.2) {
      return getHigherCandidateDiagnosticForWindow(result, windowIndex, minRatio);
    },
    getSampleMaxHigherCandidateDiagnostic(minRatio = 1.2) {
      return getSampleMaxHigherCandidateDiagnostic(result, minRatio);
    },
    getAllHigherCandidateDiagnostics(minRatio = 1.2) {
      return result.timeSec
        .map((_, windowIndex) => getHigherCandidateDiagnosticForWindow(result, windowIndex, minRatio))
        .filter(Boolean);
    },
  };
}

function readSelectedWindowIndex() {
  const raw = localStorage.getItem(SELECTED_WINDOW_STORAGE_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function writeSelectedWindowIndex(windowIndex) {
  if (Number.isInteger(windowIndex) && windowIndex >= 0) {
    localStorage.setItem(SELECTED_WINDOW_STORAGE_KEY, String(windowIndex));
  }
}

function readTopPeakCount() {
  const raw = localStorage.getItem(TOP_PEAK_COUNT_STORAGE_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 2 ? parsed : DEFAULT_TOP_PEAK_COUNT;
}

function writeTopPeakCount(topPeakCount) {
  if (Number.isInteger(topPeakCount) && topPeakCount >= 2) {
    localStorage.setItem(TOP_PEAK_COUNT_STORAGE_KEY, String(topPeakCount));
  }
}

function readLogCorrelationCutoff() {
  const raw = Number(localStorage.getItem(LOG_CORRELATION_CUTOFF_STORAGE_KEY));
  return Number.isFinite(raw)
    ? Math.max(0, Math.min(2, raw))
    : DEFAULT_LOG_CORRELATION_CUTOFF;
}

function writeLogCorrelationCutoff(logCorrelationCutoff) {
  if (Number.isFinite(logCorrelationCutoff)) {
    localStorage.setItem(
      LOG_CORRELATION_CUTOFF_STORAGE_KEY,
      String(Math.max(0, Math.min(2, logCorrelationCutoff))),
    );
  }
}

function readMaxComparisonPatches() {
  const raw = Number.parseInt(localStorage.getItem(MAX_COMPARISON_PATCHES_STORAGE_KEY) ?? "", 10);
  return Number.isInteger(raw) && raw >= 2 ? raw : DEFAULT_MAX_COMPARISON_PATCHES;
}

function writeMaxComparisonPatches(maxComparisonPatches) {
  if (Number.isInteger(maxComparisonPatches) && maxComparisonPatches >= 2) {
    localStorage.setItem(MAX_COMPARISON_PATCHES_STORAGE_KEY, String(maxComparisonPatches));
  }
}

function readMaxWalkSteps() {
  const raw = Number.parseInt(localStorage.getItem(MAX_WALK_STEPS_STORAGE_KEY) ?? "", 10);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_MAX_WALK_STEPS;
}

function writeMaxWalkSteps(maxWalkSteps) {
  if (Number.isInteger(maxWalkSteps) && maxWalkSteps >= 0) {
    localStorage.setItem(MAX_WALK_STEPS_STORAGE_KEY, String(maxWalkSteps));
  }
}

function readRawOptions(
  topPeakCountInput,
  logCorrelationCutoffInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
) {
  const topPeakCount = Number(topPeakCountInput?.value);
  const logCorrelationCutoff = Number(logCorrelationCutoffInput?.value);
  const maxComparisonPatches = Number(maxComparisonPatchesInput?.value);
  const maxWalkSteps = Number(maxWalkStepsInput?.value);
  return {
    peakCount: Number.isFinite(topPeakCount)
      ? Math.max(2, Math.floor(topPeakCount))
      : DEFAULT_TOP_PEAK_COUNT,
    logCorrelationCutoff: Number.isFinite(logCorrelationCutoff)
      ? Math.max(0, Math.min(2, logCorrelationCutoff))
      : DEFAULT_LOG_CORRELATION_CUTOFF,
    maxComparisonPatches: Number.isFinite(maxComparisonPatches)
      ? Math.max(2, Math.floor(maxComparisonPatches))
      : DEFAULT_MAX_COMPARISON_PATCHES,
    maxWalkSteps: Number.isFinite(maxWalkSteps)
      ? Math.max(0, Math.floor(maxWalkSteps))
      : DEFAULT_MAX_WALK_STEPS,
  };
}

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function updatePerformanceInfo(result) {
  const infoElement = document.getElementById("perfInfo");
  if (!infoElement || !result?.perf) return;
  const { voiceboxPipelineMsPerSecondAudio, rawPipelineMsPerSecondAudio } = result.perf;
  const accuracy = result.metrics?.rawAccuracy;
  const correctCount = result.metrics?.rawCorrectCount;
  const comparedCount = result.metrics?.rawComparedCount;
  const accuracyText =
    Number.isFinite(accuracy) && Number.isFinite(correctCount) && Number.isFinite(comparedCount)
      ? `, accuracy ${(accuracy * 100).toFixed(1)}% (${correctCount}/${comparedCount})`
      : "";
  if (
    !Number.isFinite(voiceboxPipelineMsPerSecondAudio) ||
    !Number.isFinite(rawPipelineMsPerSecondAudio)
  ) {
    infoElement.textContent = `Speed: n/a${accuracyText}`;
    return;
  }
  const voiceboxRealtime = 1000 / voiceboxPipelineMsPerSecondAudio;
  const rawRealtime = 1000 / rawPipelineMsPerSecondAudio;
  const ratio =
    rawPipelineMsPerSecondAudio > 0
      ? rawPipelineMsPerSecondAudio / voiceboxPipelineMsPerSecondAudio
      : Number.NaN;
  const ratioText = Number.isFinite(ratio) ? ` (${ratio.toFixed(2)}x cost)` : "";
  infoElement.textContent = `Realtime - Voicebox FFT pipeline ${voiceboxRealtime.toFixed(1)}x, Voicebox Raw pipeline ${rawRealtime.toFixed(1)}x${ratioText}${accuracyText}`;
}

function renderSourceOptions(sourceSelect, sources, selectedKey) {
  sourceSelect.innerHTML = "";
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.key;
    option.textContent = source.label;
    sourceSelect.append(option);
  }
  sourceSelect.value = selectedKey;
}

function getCurrentSelection(sourceSelect) {
  const sources = getAudioSources();
  const selected = resolveSelectedSource(
    sources,
    sourceSelect.value || readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  if (!selected) {
    throw new Error("No audio sources available.");
  }
  renderSourceOptions(sourceSelect, sources, selected.key);
  writeSelectedAudioSourceKey(selected.key);
  return selected;
}

async function renderResult(result, selectedWindowIndex) {
  exposeResultForDebug(result);
  await renderRawSamplePitchCharts(result, {
    selectedWindowIndex,
    getWaveformWindow: (windowIndex) => getRawWaveformWindow(result, windowIndex),
    onWindowSelect: writeSelectedWindowIndex,
  });
  const selectedDiagnostic = getHigherCandidateDiagnosticForWindow(result, selectedWindowIndex, 1.2);
  const sampleDiagnostic = getSampleMaxHigherCandidateDiagnostic(result, 1.2);
  console.log("rawSamplePitch:higherCandidateSelected", selectedDiagnostic);
  console.log("rawSamplePitch:higherCandidateSampleMax", sampleDiagnostic);
}

async function analyzeSelectedSource(
  sourceSelect,
  topPeakCountInput,
  logCorrelationCutoffInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
) {
  const source = getCurrentSelection(sourceSelect);
  const input = loadAudioInputForSource(source);
  if (!input) {
    throw new Error("Selected source is unavailable.");
  }
  const preparedSample = await loadPitchSample(input);
  const rawOptions = readRawOptions(
    topPeakCountInput,
    logCorrelationCutoffInput,
    maxComparisonPatchesInput,
    maxWalkStepsInput,
  );
  const result = await analyzePreparedPitchSample(preparedSample, rawOptions);
  await renderResult(result, readSelectedWindowIndex());
  updatePerformanceInfo(result);
  writeTopPeakCount(rawOptions.peakCount);
  writeLogCorrelationCutoff(rawOptions.logCorrelationCutoff);
  writeMaxComparisonPatches(rawOptions.maxComparisonPatches);
  writeMaxWalkSteps(rawOptions.maxWalkSteps);
  setStatus(
    `Loaded ${source.label}. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, rawWindow=${RAW_SAMPLE_WINDOW_SAMPLES_AT_48K} samples @ 48k, topPeaks=${rawOptions.peakCount}, logCutoff=${rawOptions.logCorrelationCutoff.toFixed(2)}, maxPatches=${rawOptions.maxComparisonPatches}, maxWalk=${rawOptions.maxWalkSteps}`,
  );
  return result;
}

async function analyzeFromMicrophone(
  recordButton,
  sourceSelect,
  topPeakCountInput,
  logCorrelationCutoffInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
) {
  recordButton.disabled = true;
  sourceSelect.disabled = true;
  topPeakCountInput.disabled = true;
  logCorrelationCutoffInput.disabled = true;
  maxComparisonPatchesInput.disabled = true;
  maxWalkStepsInput.disabled = true;
  document.body.classList.add("loading");
  try {
    setStatus("Recording from microphone...");
    const capturedAudio = await recordMicrophoneAudio({ maxDurationMs: RECORD_DURATION_MS });
    const saveResult = saveRecordedAudio(capturedAudio);
    if (saveResult.stored) {
      const sources = getAudioSources();
      const recordedSource = sources.find((source) => source.type === "recorded");
      if (recordedSource) {
        writeSelectedAudioSourceKey(recordedSource.key);
        renderSourceOptions(sourceSelect, sources, recordedSource.key);
      }
    }
    setStatus("Analyzing recorded audio...");
    const rawOptions = readRawOptions(
      topPeakCountInput,
      logCorrelationCutoffInput,
      maxComparisonPatchesInput,
      maxWalkStepsInput,
    );
    const preparedSample = await loadPitchSample(capturedAudio);
    const result = await analyzePreparedPitchSample(preparedSample, rawOptions);
    await renderResult(result, readSelectedWindowIndex());
    updatePerformanceInfo(result);
    writeTopPeakCount(rawOptions.peakCount);
    writeLogCorrelationCutoff(rawOptions.logCorrelationCutoff);
    writeMaxComparisonPatches(rawOptions.maxComparisonPatches);
    writeMaxWalkSteps(rawOptions.maxWalkSteps);
    setStatus(
      `Done. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, rawWindow=${RAW_SAMPLE_WINDOW_SAMPLES_AT_48K} samples @ 48k, topPeaks=${rawOptions.peakCount}, logCutoff=${rawOptions.logCorrelationCutoff.toFixed(2)}, maxPatches=${rawOptions.maxComparisonPatches}, maxWalk=${rawOptions.maxWalkSteps}`,
    );
    return result;
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed: ${message}`, true);
    return null;
  } finally {
    document.body.classList.remove("loading");
    recordButton.disabled = false;
    sourceSelect.disabled = false;
    topPeakCountInput.disabled = false;
    logCorrelationCutoffInput.disabled = false;
    maxComparisonPatchesInput.disabled = false;
    maxWalkStepsInput.disabled = false;
  }
}

async function analyzeInitialSelection(
  sourceSelect,
  topPeakCountInput,
  logCorrelationCutoffInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
) {
  document.body.classList.add("loading");
  try {
    setStatus("Analyzing selected source...");
    return await analyzeSelectedSource(
      sourceSelect,
      topPeakCountInput,
      logCorrelationCutoffInput,
      maxComparisonPatchesInput,
      maxWalkStepsInput,
    );
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed: ${message}`, true);
    return null;
  } finally {
    document.body.classList.remove("loading");
  }
}

function main() {
  const recordButton = document.getElementById("recordButton");
  const sourceSelect = document.getElementById("sourceSelect");
  const topPeakCountInput = document.getElementById("topPeakCount");
  const logCorrelationCutoffInput = document.getElementById("logCorrelationCutoff");
  const maxComparisonPatchesInput = document.getElementById("maxComparisonPatches");
  const maxWalkStepsInput = document.getElementById("maxWalkSteps");
  topPeakCountInput.value = String(readTopPeakCount());
  logCorrelationCutoffInput.value = readLogCorrelationCutoff().toFixed(2);
  maxComparisonPatchesInput.value = String(readMaxComparisonPatches());
  maxWalkStepsInput.value = String(readMaxWalkSteps());
  const selectedSource = resolveSelectedSource(
    getAudioSources(),
    readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  if (selectedSource) {
    renderSourceOptions(sourceSelect, getAudioSources(), selectedSource.key);
    writeSelectedAudioSourceKey(selectedSource.key);
  }

  recordButton.addEventListener("click", async () => {
    await analyzeFromMicrophone(
      recordButton,
      sourceSelect,
      topPeakCountInput,
      logCorrelationCutoffInput,
      maxComparisonPatchesInput,
      maxWalkStepsInput,
    );
  });

  sourceSelect.addEventListener("change", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    topPeakCountInput.disabled = true;
    logCorrelationCutoffInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    try {
      setStatus("Analyzing selected source...");
      await analyzeSelectedSource(
        sourceSelect,
        topPeakCountInput,
        logCorrelationCutoffInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      topPeakCountInput.disabled = false;
      logCorrelationCutoffInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  topPeakCountInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    topPeakCountInput.disabled = true;
    logCorrelationCutoffInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    try {
      setStatus("Applying top peak count...");
      await analyzeSelectedSource(
        sourceSelect,
        topPeakCountInput,
        logCorrelationCutoffInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      topPeakCountInput.disabled = false;
      logCorrelationCutoffInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  logCorrelationCutoffInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    topPeakCountInput.disabled = true;
    logCorrelationCutoffInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    try {
      setStatus("Applying log cutoff...");
      await analyzeSelectedSource(
        sourceSelect,
        topPeakCountInput,
        logCorrelationCutoffInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      topPeakCountInput.disabled = false;
      logCorrelationCutoffInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  maxComparisonPatchesInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    topPeakCountInput.disabled = true;
    logCorrelationCutoffInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    try {
      setStatus("Applying max comparison patches...");
      await analyzeSelectedSource(
        sourceSelect,
        topPeakCountInput,
        logCorrelationCutoffInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      topPeakCountInput.disabled = false;
      logCorrelationCutoffInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  maxWalkStepsInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    topPeakCountInput.disabled = true;
    logCorrelationCutoffInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    try {
      setStatus("Applying max walk...");
      await analyzeSelectedSource(
        sourceSelect,
        topPeakCountInput,
        logCorrelationCutoffInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      topPeakCountInput.disabled = false;
      logCorrelationCutoffInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  analyzeInitialSelection(
    sourceSelect,
    topPeakCountInput,
    logCorrelationCutoffInput,
    maxComparisonPatchesInput,
    maxWalkStepsInput,
  );
}

main();
