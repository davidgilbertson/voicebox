import {
  analyzePitchTrackBrowserFft,
  AUDIO_PATH,
  FFT_BIN_COUNT,
  FFT_HARMONIC_COMB_METHOD,
  MAX_HZ,
  MIN_HZ,
  SCORE_PROCESSORS,
  WINDOW_SIZE,
} from "./audioProcessing.js";
import {renderCharts} from "./charts.js";

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

// TODO (@davidgilbertson): inline this  
function buildPayload(track, sampleRate, processorId) {
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
      method: `${FFT_HARMONIC_COMB_METHOD}:${processorId}`,
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

// TODO (@davidgilbertson): redundant main() wrapper?
async function main() {
  const processorNames = Object.keys(SCORE_PROCESSORS);
  let selectedProcessorName = processorNames[processorNames.length - 1];
  let latestRunToken = 0;
  let selectedWindowIndex = null;

  const controls = document.getElementById("processorControls");
  controls.replaceChildren();
  for (const processorName of processorNames) {
    const label = document.createElement("label");
    label.className = "processor-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "processor";
    input.value = processorName;
    input.checked = processorName === selectedProcessorName;
    input.addEventListener("change", () => {
      if (!input.checked || processorName === selectedProcessorName) return;
      selectedProcessorName = processorName;
      void runAnalysis();
    });
    label.append(input, processorName);
    controls.append(label);
  }

  async function runAnalysis() {
    const runToken = ++latestRunToken;
    setStatus(`Running browser FFT analysis (${selectedProcessorName})...`);
    const track = await analyzePitchTrackBrowserFft(samples, sampleRate, selectedProcessorName);
    if (runToken !== latestRunToken) return;
    const payload = buildPayload(track, sampleRate, selectedProcessorName);
    renderCharts(payload, {
      selectedWindowIndex,
      onWindowSelect: (windowIndex) => {
        selectedWindowIndex = windowIndex;
      },
    });
    setStatus(`Done. ${selectedProcessorName}, windows=${track.windowCount}, ${track.msPerWindow.toFixed(3)} ms/window`);
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
