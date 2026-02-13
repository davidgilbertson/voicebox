import {
  analyzePitchTrackBrowserFft,
  AUDIO_PATH,
  FFT_BIN_COUNT,
  FFT_HARMONIC_COMB_METHOD,
  loadWavSamples,
  MAX_HZ,
  MIN_HZ,
  WINDOW_SIZE,
} from "./audioProcessing.js";
import {renderCharts} from "./charts.js";

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#fca5a5" : "#a7f3d0";
}

// TODO (@davidgilbertson): inline this  
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
      method: FFT_HARMONIC_COMB_METHOD,
      windowCount: track.windowCount,
      voicedCount: track.voicedCount,
      voicedRatio: track.windowCount > 0 ? track.voicedCount / track.windowCount : 0,
      elapsedMs: track.elapsedMs,
      msPerWindow: track.msPerWindow,
      windowIndex: track.windowIndex,
      hz: track.hz,
      freqCandidateStartBins: track.freqCandidateStartBins,
      freqCandidateScores: track.freqCandidateScores,
      windowSpectrumMagnitudes: track.windowSpectrumMagnitudes,
    },
  };
}

// TODO (@davidgilbertson): redundant main() wrapper?
async function main() {
  try {
    setStatus("Decoding audio sample...");
    const {sampleRate, samples} = await loadWavSamples(AUDIO_PATH);

    setStatus("Running browser FFT analysis...");
    const track = await analyzePitchTrackBrowserFft(samples, sampleRate);

    const payload = buildPayload(track, sampleRate);
    renderCharts(payload);

    setStatus(`Done. windows=${track.windowCount}, voiced=${track.voicedCount}, ${track.msPerWindow.toFixed(3)} ms/window`);
  } catch (error) {
    console.error(error);
    setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

main();
