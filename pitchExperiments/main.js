import {
  analyzePitchTrackBrowserFft,
  AUDIO_PATH,
  FFT_BIN_COUNT,
  FFT_HARMONIC_COMB_METHOD,
  MAX_HZ,
  MIN_HZ,
  V5_SETTINGS_DEFAULT,
  WINDOW_SIZE,
} from "./audioProcessing.js";
import {renderCharts} from "./charts.js";

const SELECTED_WINDOW_STORAGE_KEY = "voicebox.pitchExperiments.selectedWindowIndex";

function readSelectedWindowIndex() {
  const raw = localStorage.getItem(SELECTED_WINDOW_STORAGE_KEY);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function writeSelectedWindowIndex(windowIndex) {
  if (Number.isInteger(windowIndex) && windowIndex >= 0) {
    localStorage.setItem(SELECTED_WINDOW_STORAGE_KEY, String(windowIndex));
  }
}

const V5_SETTINGS_SCHEMA = [
  {key: "maxP", label: "maxP", min: 2, max: 12, step: 1, description: "max partial hypothesis"},
  {key: "pCount", label: "pCount", min: 4, max: 24, step: 1, description: "partials scored per hypothesis"},
  {key: "pRefineCount", label: "pRefineCount", min: 1, max: 8, step: 1, description: "partials used in refinement"},
  {key: "searchRadiusBins", label: "searchRadiusBins", min: 0, max: 6, step: 1, description: "peak search radius"},
  {key: "offWeight", label: "offWeight", min: 0, max: 2, step: 0.05, description: "off-partial penalty"},
  {key: "expectedP0MinRatio", label: "expectedP0MinRatio", min: 0, max: 1, step: 0.01, description: "expected P0 floor"},
  {key: "expectedP0PenaltyWeight", label: "expectedP0PenaltyWeight", min: 0, max: 5, step: 0.05, description: "P0 floor penalty weight"},
  {key: "downwardBiasPerP", label: "downwardBiasPerP", min: 0, max: 0.2, step: 0.005, description: "bias toward lower P"},
  {key: "minRms", label: "minRms", min: 0, max: 0.1, step: 0.001, description: "RMS gate"},
];

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

function buildPayload(track, sampleRate) {
  return {
    sourceFile: AUDIO_PATH,
    sampleRate,
    windowSize: WINDOW_SIZE,
    frequencyBinCount: FFT_BIN_COUNT,
    binSizeHz: (sampleRate / 2) / FFT_BIN_COUNT,
    pitchRange: {
      minHz: MIN_HZ,
      maxHz: MAX_HZ,
    },
    track: {
      method: track.method ?? `${FFT_HARMONIC_COMB_METHOD}:V5 app detector`,
      windowIndex: track.windowIndex,
      hz: track.hz,
      freqCandidateStartBins: track.freqCandidateStartBins,
      freqCandidateScores: track.freqCandidateScores,
      windowSpectrumMagnitudes: track.windowSpectrumMagnitudes,
      processorDebug: track.processorDebug,
    },
  };
}

async function loadWavSamples(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load WAV: ${url} (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(bytes.slice(0));
    const channelData = audioBuffer.getChannelData(0);
    return {
      sampleRate: audioBuffer.sampleRate,
      samples: new Float32Array(channelData),
    };
  } finally {
    await audioContext.close();
  }
}

function createNumberInput({id, value, min, max, step, onChange}) {
  const input = document.createElement("input");
  input.id = id;
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.className = "control-input";
  input.addEventListener("change", () => {
    const nextValue = Number(input.value);
    onChange(Number.isFinite(nextValue) ? nextValue : value);
  });
  return input;
}

function createV5Controls(initialSettings, onSettingsChange) {
  const controlsRoot = document.getElementById("v5Controls");
  controlsRoot.replaceChildren();

  for (const field of V5_SETTINGS_SCHEMA) {
    const row = document.createElement("label");
    row.className = "control-row";

    const title = document.createElement("div");
    title.className = "control-title";
    title.textContent = field.label;

    const hint = document.createElement("div");
    hint.className = "control-hint";
    hint.textContent = `${field.description} (${field.min}..${field.max})`;

    const input = createNumberInput({
      id: `v5-${field.key}`,
      value: initialSettings[field.key],
      min: field.min,
      max: field.max,
      step: field.step,
      onChange: (nextValue) => {
        onSettingsChange(field.key, nextValue);
      },
    });

    row.append(title, hint, input);
    controlsRoot.append(row);
  }
}

async function main() {
  let latestRunToken = 0;
  let selectedWindowIndex = readSelectedWindowIndex();
  let scheduleTimer = 0;
  const v5Settings = {...V5_SETTINGS_DEFAULT};

  function scheduleRun() {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer);
    }
    scheduleTimer = window.setTimeout(() => {
      scheduleTimer = 0;
      void runAnalysis();
    }, 120);
  }

  createV5Controls(v5Settings, (key, value) => {
    v5Settings[key] = value;
    scheduleRun();
  });

  async function runAnalysis() {
    if (!samples) return;
    const runToken = ++latestRunToken;
    document.body.classList.add("loading");
    try {
      setStatus("Running browser FFT analysis (app V5 detector)...");
      const track = await analyzePitchTrackBrowserFft(samples, sampleRate, {v5Settings});
      if (runToken !== latestRunToken) return;
      const payload = buildPayload(track, sampleRate);
      await renderCharts(payload, {
        selectedWindowIndex,
        onWindowSelect: (windowIndex) => {
          selectedWindowIndex = windowIndex;
          writeSelectedWindowIndex(windowIndex);
        },
      });
      if (runToken !== latestRunToken) return;
      setStatus(`Done. app V5 detector, windows=${track.windowCount}, ${track.msPerWindow.toFixed(3)} ms/window`);
    } finally {
      if (runToken === latestRunToken) {
        document.body.classList.remove("loading");
      }
    }
  }

  let sampleRate = 0;
  let samples = null;
  try {
    setStatus("Decoding audio sample...");
    const loaded = await loadWavSamples(AUDIO_PATH);
    sampleRate = loaded.sampleRate;
    samples = loaded.samples;
    await runAnalysis();
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

main();
