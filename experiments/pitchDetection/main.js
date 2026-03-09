import {analyzePitchSample, buildWindowDebugObject, DEFAULT_PEAKINESS_CUTOFF, DEFAULT_PITCH_TUNING} from "./analysis.js";
import {renderPitchCharts} from "./charts.js";
import {recordMicrophoneAudio} from "../micCapture.js";
import {
  getAudioSources,
  loadAudioInputForSource,
  readSelectedAudioSourceKey,
  resolveSelectedSource,
  saveRecordedAudio,
  writeSelectedAudioSourceKey,
} from "../audioSource.js";

const SELECTED_WINDOW_STORAGE_KEY = "voicebox.pitchExperiments.selectedWindowIndex";
const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
const RECORD_DURATION_MS = 5000;

function readWhiteHypothesisP(whiteHypothesisInput) {
  const value = Number(whiteHypothesisInput?.value);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.floor(value));
}

function getSourcePeakBinFromDebug(debug) {
  if (Array.isArray(debug?.seedPeakBins) && Number.isFinite(debug.seedPeakBins[0])) {
    return debug.seedPeakBins[0];
  }
  if (Number.isFinite(debug?.strongestPeakBin)) {
    return debug.strongestPeakBin;
  }
  return Number.NaN;
}

function updateWhiteHypothesisInfo(result, whiteHypothesisInput, windowIndex) {
  const infoElement = document.getElementById("whiteHypothesisInfo");
  if (!infoElement || !result) return;
  const p = readWhiteHypothesisP(whiteHypothesisInput);
  if (!Number.isFinite(p) || p <= 0) {
    infoElement.textContent = "white f0: n/a";
    return;
  }
  const clampedWindowIndex = Math.max(0, Math.min(result.timeSec.length - 1, windowIndex));
  const debug = result.windowDebug[clampedWindowIndex] ?? null;
  const sourcePeakBin = getSourcePeakBinFromDebug(debug);
  if (!Number.isFinite(sourcePeakBin)) {
    infoElement.textContent = "white f0: n/a";
    return;
  }
  const f0Hz = (sourcePeakBin * result.binSizeHz) / p;
  infoElement.textContent = Number.isFinite(f0Hz) ? `white f0: ${f0Hz.toFixed(2)} Hz` : "white f0: n/a";
}

function updatePerformanceInfo(result) {
  const infoElement = document.getElementById("perfInfo");
  if (!infoElement || !result?.perf) return;
  const {voiceboxMsPerSecondAudio, pitchyMsPerSecondAudio, timeRatio} = result.perf;
  if (!Number.isFinite(voiceboxMsPerSecondAudio) || !Number.isFinite(pitchyMsPerSecondAudio)) {
    infoElement.textContent = "Speed: n/a";
    return;
  }
  const voiceboxRealtime = 1000 / voiceboxMsPerSecondAudio;
  const pitchyRealtime = 1000 / pitchyMsPerSecondAudio;
  if (!Number.isFinite(voiceboxRealtime) || !Number.isFinite(pitchyRealtime)) {
    infoElement.textContent = "Speed: n/a";
    return;
  }
  const voiceboxText = voiceboxRealtime.toLocaleString("en-US", {maximumFractionDigits: 1});
  const pitchyText = pitchyRealtime.toLocaleString("en-US", {maximumFractionDigits: 1});
  const ratioText = Number.isFinite(timeRatio) ? ` (${timeRatio.toFixed(2)}x)` : "";
  infoElement.textContent = `Realtime - Voicebox ${voiceboxText}x, Pitchy ${pitchyText}x${ratioText}`;
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

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function readPitchTuningFromControls(controls) {
  const maxP = Number(controls.maxP.value);
  const pCount = Number(controls.pCount.value);
  const pRefineCount = Number(controls.pRefineCount.value);
  const offWeight = Number(controls.offWeight.value);
  const expectedP0MinRatio = Number(controls.expectedP0MinRatio.value);
  const expectedP0PenaltyWeight = Number(controls.expectedP0PenaltyWeight.value);
  const downwardBiasPerP = Number(controls.downwardBiasPerP.value);
  const searchRadiusBins = Number(controls.searchRadiusBins.value);
  return {
    maxP: Number.isFinite(maxP) ? maxP : DEFAULT_PITCH_TUNING.maxP,
    pCount: Number.isFinite(pCount) ? pCount : DEFAULT_PITCH_TUNING.pCount,
    pRefineCount: Number.isFinite(pRefineCount) ? pRefineCount : DEFAULT_PITCH_TUNING.pRefineCount,
    offWeight: Number.isFinite(offWeight) ? offWeight : DEFAULT_PITCH_TUNING.offWeight,
    expectedP0MinRatio: Number.isFinite(expectedP0MinRatio) ? expectedP0MinRatio : DEFAULT_PITCH_TUNING.expectedP0MinRatio,
    expectedP0PenaltyWeight: Number.isFinite(expectedP0PenaltyWeight) ? expectedP0PenaltyWeight : DEFAULT_PITCH_TUNING.expectedP0PenaltyWeight,
    downwardBiasPerP: Number.isFinite(downwardBiasPerP) ? downwardBiasPerP : DEFAULT_PITCH_TUNING.downwardBiasPerP,
    searchRadiusBins: Number.isFinite(searchRadiusBins) ? searchRadiusBins : DEFAULT_PITCH_TUNING.searchRadiusBins,
  };
}

function readPeakinessCutoff(peakinessCutoffInput) {
  const value = Number(peakinessCutoffInput?.value);
  if (!Number.isFinite(value)) return DEFAULT_PEAKINESS_CUTOFF;
  return Math.max(0, Math.min(1, value));
}

function applyDefaultPitchTuningToControls(controls) {
  controls.maxP.value = String(DEFAULT_PITCH_TUNING.maxP);
  controls.pCount.value = String(DEFAULT_PITCH_TUNING.pCount);
  controls.pRefineCount.value = String(DEFAULT_PITCH_TUNING.pRefineCount);
  controls.offWeight.value = String(DEFAULT_PITCH_TUNING.offWeight);
  controls.expectedP0MinRatio.value = String(DEFAULT_PITCH_TUNING.expectedP0MinRatio);
  controls.expectedP0PenaltyWeight.value = String(DEFAULT_PITCH_TUNING.expectedP0PenaltyWeight);
  controls.downwardBiasPerP.value = String(DEFAULT_PITCH_TUNING.downwardBiasPerP);
  controls.searchRadiusBins.value = String(DEFAULT_PITCH_TUNING.searchRadiusBins);
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
      DEFAULT_ASSET_URL
  );
  if (!selected) {
    throw new Error("No audio sources available.");
  }
  renderSourceOptions(sourceSelect, sources, selected.key);
  writeSelectedAudioSourceKey(selected.key);
  return selected;
}

async function renderResult(result, selectedWindowIndex, onWindowSelect, whiteHypothesisP = null, peakinessCutoff = DEFAULT_PEAKINESS_CUTOFF) {
  await renderPitchCharts(result, {
    selectedWindowIndex,
    whiteHypothesisP,
    peakinessCutoff,
    onWindowSelect,
    onWindowDebug: (windowIndex) => {
      console.log(buildWindowDebugObject(result, windowIndex));
    },
  });
}

async function analyzeSelectedSource({
  sourceSelect,
  selectedWindowIndex,
  tuningControls,
  whiteHypothesisP,
  whiteHypothesisInput,
  peakinessCutoff,
}) {
  const source = getCurrentSelection(sourceSelect);
  const input = loadAudioInputForSource(source);
  if (!input) {
    throw new Error("Selected source is unavailable.");
  }
  const result = await analyzePitchSample(input, readPitchTuningFromControls(tuningControls), {
    peakinessCutoff,
  });
  await renderResult(result, selectedWindowIndex, (windowIndex) => {
    writeSelectedWindowIndex(windowIndex);
    updateWhiteHypothesisInfo(result, whiteHypothesisInput, windowIndex);
  }, whiteHypothesisP, peakinessCutoff);
  updatePerformanceInfo(result);
  setStatus(`Loaded ${source.label}. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, step=${(1000 / result.samplesPerSecond).toFixed(2)} ms`);
  return result;
}

async function analyzeFromMicrophone(recordButton, sourceSelect, tuningControls, whiteHypothesisInput, peakinessCutoffInput) {
  recordButton.disabled = true;
  sourceSelect.disabled = true;
  Object.values(tuningControls).forEach((input) => {
    input.disabled = true;
  });
  document.body.classList.add("loading");
  let selectedWindowIndex = readSelectedWindowIndex();
  try {
    setStatus("Recording from microphone...");
    const capturedAudio = await recordMicrophoneAudio({maxDurationMs: RECORD_DURATION_MS});
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
    const peakinessCutoff = readPeakinessCutoff(peakinessCutoffInput);
    const result = await analyzePitchSample(capturedAudio, readPitchTuningFromControls(tuningControls), {
      peakinessCutoff,
    });
    await renderResult(result, selectedWindowIndex, (windowIndex) => {
      selectedWindowIndex = windowIndex;
      writeSelectedWindowIndex(windowIndex);
      updateWhiteHypothesisInfo(result, whiteHypothesisInput, windowIndex);
    }, readWhiteHypothesisP(whiteHypothesisInput), peakinessCutoff);
    updatePerformanceInfo(result);
    setStatus(`Done. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, step=${(1000 / result.samplesPerSecond).toFixed(2)} ms`);
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
    Object.values(tuningControls).forEach((input) => {
      input.disabled = false;
    });
  }
}

async function analyzeInitialSelection(sourceSelect, tuningControls, whiteHypothesisInput, peakinessCutoffInput) {
  document.body.classList.add("loading");
  try {
    setStatus("Analyzing selected source...");
    return await analyzeSelectedSource({
      sourceSelect,
      selectedWindowIndex: readSelectedWindowIndex(),
      tuningControls,
      whiteHypothesisP: readWhiteHypothesisP(whiteHypothesisInput),
      whiteHypothesisInput,
      peakinessCutoff: readPeakinessCutoff(peakinessCutoffInput),
    });
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
  const whiteHypothesisInput = document.getElementById("whiteHypothesisP");
  const peakinessCutoffInput = document.getElementById("peakinessCutoff");
  const tuningControls = {
    maxP: document.getElementById("tuneMaxP"),
    pCount: document.getElementById("tunePCount"),
    pRefineCount: document.getElementById("tunePRefineCount"),
    offWeight: document.getElementById("tuneOffWeight"),
    expectedP0MinRatio: document.getElementById("tuneExpectedP0MinRatio"),
    expectedP0PenaltyWeight: document.getElementById("tuneExpectedP0PenaltyWeight"),
    downwardBiasPerP: document.getElementById("tuneDownwardBiasPerP"),
    searchRadiusBins: document.getElementById("tuneSearchRadiusBins"),
  };
  applyDefaultPitchTuningToControls(tuningControls);
  peakinessCutoffInput.value = String(DEFAULT_PEAKINESS_CUTOFF);
  let latestResult = null;
  const selectedSource = resolveSelectedSource(
      getAudioSources(),
      readSelectedAudioSourceKey(),
      DEFAULT_ASSET_URL
  );
  if (selectedSource) {
    renderSourceOptions(sourceSelect, getAudioSources(), selectedSource.key);
    writeSelectedAudioSourceKey(selectedSource.key);
  }

  recordButton.addEventListener("click", async () => {
    latestResult = await analyzeFromMicrophone(recordButton, sourceSelect, tuningControls, whiteHypothesisInput, peakinessCutoffInput);
    if (latestResult) {
      updateWhiteHypothesisInfo(latestResult, whiteHypothesisInput, readSelectedWindowIndex());
    }
  });
  async function rerunSelectedSource(statusText = "Analyzing selected source...") {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    Object.values(tuningControls).forEach((input) => {
      input.disabled = true;
    });
    try {
      setStatus(statusText);
      latestResult = await analyzeSelectedSource({
        sourceSelect,
        selectedWindowIndex: readSelectedWindowIndex(),
        tuningControls,
        whiteHypothesisP: readWhiteHypothesisP(whiteHypothesisInput),
        whiteHypothesisInput,
        peakinessCutoff: readPeakinessCutoff(peakinessCutoffInput),
      });
      if (latestResult) {
        updateWhiteHypothesisInfo(latestResult, whiteHypothesisInput, readSelectedWindowIndex());
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      Object.values(tuningControls).forEach((input) => {
        input.disabled = false;
      });
      document.body.classList.remove("loading");
    }
  }

  sourceSelect.addEventListener("change", async () => {
    await rerunSelectedSource("Analyzing selected source...");
  });
  for (const input of Object.values(tuningControls)) {
    input.addEventListener("input", async () => {
      await rerunSelectedSource("Applying tuning...");
    });
  }
  peakinessCutoffInput.addEventListener("input", async () => {
    await rerunSelectedSource("Applying peakiness cutoff...");
  });
  whiteHypothesisInput.addEventListener("input", async () => {
    if (!latestResult) return;
    updateWhiteHypothesisInfo(latestResult, whiteHypothesisInput, readSelectedWindowIndex());
    await renderResult(
        latestResult,
        readSelectedWindowIndex(),
        (windowIndex) => {
          writeSelectedWindowIndex(windowIndex);
          updateWhiteHypothesisInfo(latestResult, whiteHypothesisInput, windowIndex);
        },
        readWhiteHypothesisP(whiteHypothesisInput),
        readPeakinessCutoff(peakinessCutoffInput)
    );
  });
  analyzeInitialSelection(sourceSelect, tuningControls, whiteHypothesisInput, peakinessCutoffInput)
      .then((result) => {
        latestResult = result;
        if (latestResult) {
          updateWhiteHypothesisInfo(latestResult, whiteHypothesisInput, readSelectedWindowIndex());
        }
      });
}

main();
