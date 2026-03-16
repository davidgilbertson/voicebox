export const E1_HZ = 41.20344461410875;
export const PICA_WINDOW_CYCLES = 2;
export const PICA_ASSUMED_SAMPLE_RATE = 48_000;
export const PICA_WINDOW_DURATION_SEC = PICA_WINDOW_CYCLES / E1_HZ;
export const PICA_WINDOW_SAMPLES_AT_48K = Math.ceil(
  PICA_WINDOW_DURATION_SEC * PICA_ASSUMED_SAMPLE_RATE,
);

export function getPicaWindowSize(sampleRate) {
  return Math.max(1, Math.ceil(PICA_WINDOW_DURATION_SEC * sampleRate));
}

export function getPicaWindowSamples(samples, sampleRate, endTimeSec) {
  const picaWindowSamples = getPicaWindowSize(sampleRate);
  const endSample = Math.min(samples.length, Math.max(0, Math.round(endTimeSec * sampleRate)));
  const startSample = Math.max(0, endSample - picaWindowSamples);
  return samples.subarray(startSample, endSample);
}

export function getPicaWaveformWindow(result, windowIndex) {
  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  const clampedWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
  const endTimeSec = result.timeSec[clampedWindowIndex];
  const picaWindowSamples = getPicaWindowSize(result.sampleRate);
  const endSample = Math.min(
    result.samples.length,
    Math.max(0, Math.round(endTimeSec * result.sampleRate)),
  );
  const startSample = Math.max(0, endSample - picaWindowSamples);
  const samples = result.samples.subarray(startSample, endSample);
  const timeSec = Array.from(
    { length: samples.length },
    (_, index) => (startSample + index) / result.sampleRate,
  );
  return {
    windowIndex: clampedWindowIndex,
    fftPitchHz: result.pitchHz[clampedWindowIndex],
    picaPitchHz: result.picaPitchHz[clampedWindowIndex],
    carryForwardPitchHz: result.carryForwardPitchHz?.[clampedWindowIndex] ?? Number.NaN,
    sampleRate: result.sampleRate,
    endSample,
    endTimeSec: endSample / result.sampleRate,
    startSample,
    samples,
    timeSec,
    picaWindowSamples,
    durationMs: (samples.length / result.sampleRate) * 1000,
  };
}
