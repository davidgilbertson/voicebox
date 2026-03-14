export const E1_HZ = 41.20344461410875;
export const RAW_SAMPLE_WINDOW_CYCLES = 2;
export const RAW_SAMPLE_ASSUMED_SAMPLE_RATE = 48_000;
export const RAW_SAMPLE_WINDOW_DURATION_SEC = RAW_SAMPLE_WINDOW_CYCLES / E1_HZ;
export const RAW_SAMPLE_WINDOW_SAMPLES_AT_48K = Math.ceil(
  RAW_SAMPLE_WINDOW_DURATION_SEC * RAW_SAMPLE_ASSUMED_SAMPLE_RATE,
);

export function getRawSampleWindowSize(sampleRate) {
  return Math.max(1, Math.ceil(RAW_SAMPLE_WINDOW_DURATION_SEC * sampleRate));
}

export function getRawWaveformWindow(result, windowIndex) {
  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  const clampedWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
  const rawWindowSamples = getRawSampleWindowSize(result.sampleRate);
  const endTimeSec = result.timeSec[clampedWindowIndex];
  const endSample = Math.min(
    result.samples.length,
    Math.max(0, Math.round(endTimeSec * result.sampleRate)),
  );
  const startSample = Math.max(0, endSample - rawWindowSamples);
  const samples = result.samples.subarray(startSample, endSample);
  const timeSec = Array.from(
    { length: samples.length },
    (_, index) => (startSample + index) / result.sampleRate,
  );
  return {
    windowIndex: clampedWindowIndex,
    fftPitchHz: result.pitchHz[clampedWindowIndex],
    pitchHz: result.rawPitchHz?.[clampedWindowIndex],
    rawDebug: result.rawDebug?.[clampedWindowIndex] ?? null,
    sampleRate: result.sampleRate,
    endSample,
    endTimeSec: endSample / result.sampleRate,
    startSample,
    samples,
    timeSec,
    rawWindowSamples,
    durationMs: (samples.length / result.sampleRate) * 1000,
  };
}
