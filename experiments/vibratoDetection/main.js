import {
  analyzeVibratoSample,
  getPeakSpacingWindowPreviewForIndex,
  runLastTwoShapePeaksDebugAtIndex,
} from "./analysis.js";
import { renderVibratoCharts } from "./charts.js";
import { recordMicrophoneAudio } from "../micCapture.js";
import {
  getAudioSources,
  loadAudioInputForSource,
  readSelectedAudioSourceKey,
  resolveSelectedSource,
  saveRecordedAudio,
  writeSelectedAudioSourceKey,
} from "../audioSource.js";

const DEFAULT_ASSET_URL = "../../.private/assets/rozette_vibrato.wav";
const RECORD_DURATION_MS = 5000;

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
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

async function renderResult(result) {
  await renderVibratoCharts(result, {
    getTopChartHoverWindow: (pointIndex) => getPeakSpacingWindowPreviewForIndex(result, pointIndex),
    onTopChartClick: (pointIndex) =>
      runLastTwoShapePeaksDebugAtIndex(result, pointIndex, "top chart click"),
  });
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

async function analyzeSelectedSource(sourceSelect) {
  const source = getCurrentSelection(sourceSelect);
  const input = loadAudioInputForSource(source);
  if (!input) {
    throw new Error("Selected source is unavailable.");
  }
  const result = await analyzeVibratoSample(input);
  await renderResult(result);
  setStatus(
    `Loaded ${source.label}. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, step=${result.samplesPerSecond} Hz`,
  );
}

async function analyzeFromMicrophone(recordButton, sourceSelect) {
  recordButton.disabled = true;
  sourceSelect.disabled = true;
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
    } else {
      setStatus("Recorded 5s (not saved to localStorage, check console size log).");
    }
    setStatus("Analyzing recorded audio...");
    const result = await analyzeVibratoSample(capturedAudio);
    await renderResult(result);
    setStatus(
      `Done. windows=${result.timeSec.length}, sampleRate=${result.sampleRate}, step=${result.samplesPerSecond} Hz`,
    );
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed: ${message}`, true);
  } finally {
    document.body.classList.remove("loading");
    recordButton.disabled = false;
    sourceSelect.disabled = false;
  }
}

async function analyzeInitialSelection(sourceSelect) {
  document.body.classList.add("loading");
  try {
    setStatus("Analyzing selected source...");
    await analyzeSelectedSource(sourceSelect);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Failed: ${message}`, true);
  } finally {
    document.body.classList.remove("loading");
  }
}

function main() {
  const recordButton = document.getElementById("recordButton");
  const sourceSelect = document.getElementById("sourceSelect");
  const selectedSource = resolveSelectedSource(
    getAudioSources(),
    readSelectedAudioSourceKey(),
    DEFAULT_ASSET_URL,
  );
  if (selectedSource) {
    renderSourceOptions(sourceSelect, getAudioSources(), selectedSource.key);
    writeSelectedAudioSourceKey(selectedSource.key);
  }

  recordButton.addEventListener("click", () => {
    analyzeFromMicrophone(recordButton, sourceSelect);
  });
  sourceSelect.addEventListener("change", async () => {
    document.body.classList.add("loading");
    recordButton.disabled = true;
    sourceSelect.disabled = true;
    try {
      setStatus("Analyzing selected source...");
      await analyzeSelectedSource(sourceSelect);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Failed: ${message}`, true);
    } finally {
      recordButton.disabled = false;
      sourceSelect.disabled = false;
      document.body.classList.remove("loading");
    }
  });
  analyzeInitialSelection(sourceSelect);
}

main();
