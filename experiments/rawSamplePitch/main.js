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
const MAX_EXTREMA_PER_FOLD_STORAGE_KEY = "voicebox.rawSamplePitch.maxExtremaPerFold";
const MAX_CROSSINGS_PER_PERIOD_STORAGE_KEY = "voicebox.rawSamplePitch.maxCrossingsPerPeriod";
const MAX_COMPARISON_PATCHES_STORAGE_KEY = "voicebox.rawSamplePitch.maxComparisonPatches";
const MAX_WALK_STEPS_STORAGE_KEY = "voicebox.rawSamplePitch.maxWalkSteps";
const RAW_GLOBAL_LOG_CORRELATION_CUTOFF_STORAGE_KEY =
  "voicebox.rawSamplePitch.rawGlobalLogCorrelationCutoff";
const OCTAVE_BIAS_STORAGE_KEY = "voicebox.rawSamplePitch.octaveBias";
const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
const RECORD_DURATION_MS = 5000;
const DEFAULT_MAX_EXTREMA_PER_FOLD = 2;
const DEFAULT_MAX_CROSSINGS_PER_PERIOD = 20;
const DEFAULT_MAX_COMPARISON_PATCHES = 3;
const DEFAULT_MAX_WALK_STEPS = 10;
const DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF = 0;
const DEFAULT_OCTAVE_BIAS = 0;

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

function readMaxExtremaPerFold() {
  const raw = localStorage.getItem(MAX_EXTREMA_PER_FOLD_STORAGE_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_EXTREMA_PER_FOLD;
}

function writeMaxExtremaPerFold(maxExtremaPerFold) {
  if (Number.isInteger(maxExtremaPerFold) && maxExtremaPerFold >= 1) {
    localStorage.setItem(MAX_EXTREMA_PER_FOLD_STORAGE_KEY, String(maxExtremaPerFold));
  }
}

function readMaxCrossingsPerPeriod() {
  const raw = localStorage.getItem(MAX_CROSSINGS_PER_PERIOD_STORAGE_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 2 ? parsed : DEFAULT_MAX_CROSSINGS_PER_PERIOD;
}

function writeMaxCrossingsPerPeriod(maxCrossingsPerPeriod) {
  if (Number.isInteger(maxCrossingsPerPeriod) && maxCrossingsPerPeriod >= 2) {
    localStorage.setItem(MAX_CROSSINGS_PER_PERIOD_STORAGE_KEY, String(maxCrossingsPerPeriod));
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

function readRawGlobalLogCorrelationCutoff() {
  const raw = Number(localStorage.getItem(RAW_GLOBAL_LOG_CORRELATION_CUTOFF_STORAGE_KEY));
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF;
}

function writeRawGlobalLogCorrelationCutoff(rawGlobalLogCorrelationCutoff) {
  if (Number.isFinite(rawGlobalLogCorrelationCutoff) && rawGlobalLogCorrelationCutoff >= 0) {
    localStorage.setItem(
      RAW_GLOBAL_LOG_CORRELATION_CUTOFF_STORAGE_KEY,
      String(rawGlobalLogCorrelationCutoff),
    );
  }
}

function readOctaveBias() {
  const raw = Number(localStorage.getItem(OCTAVE_BIAS_STORAGE_KEY));
  return Number.isFinite(raw) ? raw : DEFAULT_OCTAVE_BIAS;
}

function writeOctaveBias(octaveBias) {
  if (Number.isFinite(octaveBias)) {
    localStorage.setItem(OCTAVE_BIAS_STORAGE_KEY, String(octaveBias));
  }
}

function readRawOptions(
  maxExtremaPerFoldInput,
  maxCrossingsPerPeriodInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
  rawGlobalLogCorrelationCutoffInput,
  octaveBiasInput,
) {
  const maxExtremaPerFold = Number(maxExtremaPerFoldInput?.value);
  const maxCrossingsPerPeriod = Number(maxCrossingsPerPeriodInput?.value);
  const maxComparisonPatches = Number(maxComparisonPatchesInput?.value);
  const maxWalkSteps = Number(maxWalkStepsInput?.value);
  const rawGlobalLogCorrelationCutoff = Number(rawGlobalLogCorrelationCutoffInput?.value);
  const octaveBias = Number(octaveBiasInput?.value);
  return {
    maxExtremaPerFold: Number.isFinite(maxExtremaPerFold)
      ? Math.max(1, Math.floor(maxExtremaPerFold))
      : DEFAULT_MAX_EXTREMA_PER_FOLD,
    maxCrossingsPerPeriod: Number.isFinite(maxCrossingsPerPeriod)
      ? Math.max(2, Math.floor(maxCrossingsPerPeriod))
      : DEFAULT_MAX_CROSSINGS_PER_PERIOD,
    maxComparisonPatches: Number.isFinite(maxComparisonPatches)
      ? Math.max(2, Math.floor(maxComparisonPatches))
      : DEFAULT_MAX_COMPARISON_PATCHES,
    maxWalkSteps: Number.isFinite(maxWalkSteps)
      ? Math.max(0, Math.floor(maxWalkSteps))
      : DEFAULT_MAX_WALK_STEPS,
    rawGlobalLogCorrelationCutoff:
      Number.isFinite(rawGlobalLogCorrelationCutoff) && rawGlobalLogCorrelationCutoff >= 0
        ? rawGlobalLogCorrelationCutoff
        : DEFAULT_RAW_GLOBAL_LOG_CORRELATION_CUTOFF,
    octaveBias: Number.isFinite(octaveBias) ? octaveBias : DEFAULT_OCTAVE_BIAS,
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
}

async function analyzeSelectedSource(
  sourceSelect,
  maxExtremaPerFoldInput,
  maxCrossingsPerPeriodInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
  rawGlobalLogCorrelationCutoffInput,
  octaveBiasInput,
) {
  const source = getCurrentSelection(sourceSelect);
  const input = loadAudioInputForSource(source);
  if (!input) {
    throw new Error("Selected source is unavailable.");
  }
  const preparedSample = await loadPitchSample(input);
  const rawOptions = readRawOptions(
    maxExtremaPerFoldInput,
    maxCrossingsPerPeriodInput,
    maxComparisonPatchesInput,
    maxWalkStepsInput,
    rawGlobalLogCorrelationCutoffInput,
    octaveBiasInput,
  );
  const result = await analyzePreparedPitchSample(preparedSample, rawOptions);
  await renderResult(result, readSelectedWindowIndex());
  updatePerformanceInfo(result);
  writeMaxExtremaPerFold(rawOptions.maxExtremaPerFold);
  writeMaxCrossingsPerPeriod(rawOptions.maxCrossingsPerPeriod);
  writeMaxComparisonPatches(rawOptions.maxComparisonPatches);
  writeMaxWalkSteps(rawOptions.maxWalkSteps);
  writeRawGlobalLogCorrelationCutoff(rawOptions.rawGlobalLogCorrelationCutoff);
  writeOctaveBias(rawOptions.octaveBias);
  setStatus(
    `Loaded ${source.label}. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, rawWindow=${RAW_SAMPLE_WINDOW_SAMPLES_AT_48K} samples @ 48k, maxExtremaPerFold=${rawOptions.maxExtremaPerFold}, maxCrossingsPerPeriod=${rawOptions.maxCrossingsPerPeriod}, maxPatches=${rawOptions.maxComparisonPatches}, maxWalk=${rawOptions.maxWalkSteps}, rawCutoff=${rawOptions.rawGlobalLogCorrelationCutoff.toFixed(2)}, octaveBias=${rawOptions.octaveBias.toFixed(2)}`,
  );
  return result;
}

async function analyzeFromMicrophone(
  recordButton,
  sourceSelect,
  maxExtremaPerFoldInput,
  maxCrossingsPerPeriodInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
  rawGlobalLogCorrelationCutoffInput,
  octaveBiasInput,
) {
  recordButton.disabled = true;
  sourceSelect.disabled = true;
  maxExtremaPerFoldInput.disabled = true;
  maxCrossingsPerPeriodInput.disabled = true;
  maxComparisonPatchesInput.disabled = true;
  maxWalkStepsInput.disabled = true;
  rawGlobalLogCorrelationCutoffInput.disabled = true;
  octaveBiasInput.disabled = true;
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
      maxExtremaPerFoldInput,
      maxCrossingsPerPeriodInput,
      maxComparisonPatchesInput,
      maxWalkStepsInput,
      rawGlobalLogCorrelationCutoffInput,
      octaveBiasInput,
    );
    const preparedSample = await loadPitchSample(capturedAudio);
    const result = await analyzePreparedPitchSample(preparedSample, rawOptions);
    await renderResult(result, readSelectedWindowIndex());
    updatePerformanceInfo(result);
    writeMaxExtremaPerFold(rawOptions.maxExtremaPerFold);
    writeMaxCrossingsPerPeriod(rawOptions.maxCrossingsPerPeriod);
    writeMaxComparisonPatches(rawOptions.maxComparisonPatches);
    writeMaxWalkSteps(rawOptions.maxWalkSteps);
    writeRawGlobalLogCorrelationCutoff(rawOptions.rawGlobalLogCorrelationCutoff);
    writeOctaveBias(rawOptions.octaveBias);
    setStatus(
      `Done. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, rawWindow=${RAW_SAMPLE_WINDOW_SAMPLES_AT_48K} samples @ 48k, maxExtremaPerFold=${rawOptions.maxExtremaPerFold}, maxCrossingsPerPeriod=${rawOptions.maxCrossingsPerPeriod}, maxPatches=${rawOptions.maxComparisonPatches}, maxWalk=${rawOptions.maxWalkSteps}, rawCutoff=${rawOptions.rawGlobalLogCorrelationCutoff.toFixed(2)}, octaveBias=${rawOptions.octaveBias.toFixed(2)}`,
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
    maxExtremaPerFoldInput.disabled = false;
    maxCrossingsPerPeriodInput.disabled = false;
    maxComparisonPatchesInput.disabled = false;
    maxWalkStepsInput.disabled = false;
    rawGlobalLogCorrelationCutoffInput.disabled = false;
    octaveBiasInput.disabled = false;
  }
}

async function analyzeInitialSelection(
  sourceSelect,
  maxExtremaPerFoldInput,
  maxCrossingsPerPeriodInput,
  maxComparisonPatchesInput,
  maxWalkStepsInput,
  rawGlobalLogCorrelationCutoffInput,
  octaveBiasInput,
) {
  document.body.classList.add("loading");
  try {
    setStatus("Analyzing selected source...");
    return await analyzeSelectedSource(
      sourceSelect,
      maxExtremaPerFoldInput,
      maxCrossingsPerPeriodInput,
      maxComparisonPatchesInput,
      maxWalkStepsInput,
      rawGlobalLogCorrelationCutoffInput,
      octaveBiasInput,
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
  const maxExtremaPerFoldInput = document.getElementById("maxExtremaPerFold");
  const maxCrossingsPerPeriodInput = document.getElementById("maxCrossingsPerPeriod");
  const maxComparisonPatchesInput = document.getElementById("maxComparisonPatches");
  const maxWalkStepsInput = document.getElementById("maxWalkSteps");
  const rawGlobalLogCorrelationCutoffInput = document.getElementById(
    "rawGlobalLogCorrelationCutoff",
  );
  const octaveBiasInput = document.getElementById("octaveBias");
  maxExtremaPerFoldInput.value = String(readMaxExtremaPerFold());
  maxCrossingsPerPeriodInput.value = String(readMaxCrossingsPerPeriod());
  maxComparisonPatchesInput.value = String(readMaxComparisonPatches());
  maxWalkStepsInput.value = String(readMaxWalkSteps());
  rawGlobalLogCorrelationCutoffInput.value = String(readRawGlobalLogCorrelationCutoff());
  octaveBiasInput.value = String(readOctaveBias());
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
      maxExtremaPerFoldInput,
      maxCrossingsPerPeriodInput,
      maxComparisonPatchesInput,
      maxWalkStepsInput,
      rawGlobalLogCorrelationCutoffInput,
      octaveBiasInput,
    );
  });

  sourceSelect.addEventListener("change", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Analyzing selected source...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  maxExtremaPerFoldInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Applying extrema-per-fold...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  maxCrossingsPerPeriodInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Applying crossings-per-period...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  maxComparisonPatchesInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Applying max comparison patches...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  maxWalkStepsInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Applying max walk...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  rawGlobalLogCorrelationCutoffInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Applying raw cutoff...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  octaveBiasInput.addEventListener("input", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    maxExtremaPerFoldInput.disabled = true;
    maxCrossingsPerPeriodInput.disabled = true;
    maxComparisonPatchesInput.disabled = true;
    maxWalkStepsInput.disabled = true;
    rawGlobalLogCorrelationCutoffInput.disabled = true;
    octaveBiasInput.disabled = true;
    try {
      setStatus("Applying octave bias...");
      await analyzeSelectedSource(
        sourceSelect,
        maxExtremaPerFoldInput,
        maxCrossingsPerPeriodInput,
        maxComparisonPatchesInput,
        maxWalkStepsInput,
        rawGlobalLogCorrelationCutoffInput,
        octaveBiasInput,
      );
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      maxExtremaPerFoldInput.disabled = false;
      maxCrossingsPerPeriodInput.disabled = false;
      maxComparisonPatchesInput.disabled = false;
      maxWalkStepsInput.disabled = false;
      rawGlobalLogCorrelationCutoffInput.disabled = false;
      octaveBiasInput.disabled = false;
      document.body.classList.remove("loading");
    }
  });

  analyzeInitialSelection(
    sourceSelect,
    maxExtremaPerFoldInput,
    maxCrossingsPerPeriodInput,
    maxComparisonPatchesInput,
    maxWalkStepsInput,
    rawGlobalLogCorrelationCutoffInput,
    octaveBiasInput,
  );
}

main();
