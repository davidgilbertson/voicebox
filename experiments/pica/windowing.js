// Terminology in this file:
// - window sequence: the shared list of end-sample positions for every method on the page
// - detector window: the waveform slice that the sample-domain methods inspect at one window index
//
// Window index 0 is sample 600, matching the saved JSON label files after their leading placeholder is removed.
// The sequence stops early enough that FFT still has a full 4096-sample history available when it needs it.
// `timeSec` is only a chart axis derived from those sample positions.
export const WINDOWS_PER_SECOND = 80;
export const FFT_WINDOW_SAMPLES = 4096;
export const E1_HZ = 41.20344461410875;
export const DETECTOR_WINDOW_CYCLES = 2;
export const DETECTOR_WINDOW_DURATION_SEC = DETECTOR_WINDOW_CYCLES / E1_HZ;

export function getHopSamples(sampleRate) {
  return Math.max(1, Math.round(sampleRate / WINDOWS_PER_SECOND));
}

export function buildWindowSequence(sampleRate, sampleCount) {
  const hopSamples = getHopSamples(sampleRate);
  const firstWindowEndSample = hopSamples;
  const windowCount = Math.max(0, Math.floor((sampleCount - FFT_WINDOW_SAMPLES) / hopSamples));

  return {
    windowsPerSecond: WINDOWS_PER_SECOND,
    hopSamples,
    firstWindowEndSample,
    windowCount,
    timeSec: Array.from(
      { length: windowCount },
      (_, windowIndex) =>
        getWindowEndSample({ hopSamples, firstWindowEndSample }, windowIndex) / sampleRate,
    ),
  };
}

export function getWindowEndSample(windowSequence, windowIndex) {
  return windowSequence.firstWindowEndSample + windowIndex * windowSequence.hopSamples;
}

export function getDetectorWindowSize(sampleRate) {
  // The extra margin gives us room to throw away incomplete folds at the window edges.
  return Math.max(1, Math.ceil(DETECTOR_WINDOW_DURATION_SEC * sampleRate) + 400);
}

export function getDetectorWindowSamples(samples, sampleRate, endSample) {
  const detectorWindowSamples = getDetectorWindowSize(sampleRate);
  const startSample = Math.max(0, endSample - detectorWindowSamples);
  return samples.subarray(startSample, endSample);
}

export function getWaveformWindow(result, windowIndex) {
  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  const clampedWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
  const endSample = getWindowEndSample(result.windowSequence, clampedWindowIndex);
  const detectorWindowSamples = getDetectorWindowSize(result.sampleRate);
  const startSample = Math.max(0, endSample - detectorWindowSamples);
  const samples = result.samples.subarray(startSample, endSample);
  const sampleIndex = Array.from({ length: samples.length }, (_, index) => startSample + index);
  const timeSec = Array.from(
    { length: samples.length },
    (_, index) => (startSample + index) / result.sampleRate,
  );
  return {
    windowIndex: clampedWindowIndex,
    fftPitchHz: result.pitchHz[clampedWindowIndex],
    picaPitchHz: result.picaPitchHz[clampedWindowIndex],
    pizaPitchHz: result.pizaPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    pica2PitchHz: result.pica2PitchHz?.[clampedWindowIndex] ?? Number.NaN,
    piraPitchHz: result.piraPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    pifsPitchHz: result.pifsPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    pipsPitchHz: result.pipsPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    piscPitchHz: result.piscPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    picaCfPitchHz: result.picaCfPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    sampleRate: result.sampleRate,
    endSample,
    endTimeSec: endSample / result.sampleRate,
    startSample,
    sampleIndex,
    samples,
    timeSec,
    detectorWindowSamples,
    durationMs: (samples.length / result.sampleRate) * 1000,
  };
}
