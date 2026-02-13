function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dbToMagnitude(db) {
  if (!Number.isFinite(db)) return 0;
  return 10 ** (db / 20);
}

export async function createWindowSpectrumComputer({
  samples,
  sampleRate,
  binCount,
  windowSize,
  hopSamples,
  windowCount,
}) {
  const context = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;

  const analyser = context.createAnalyser();
  analyser.fftSize = binCount * 2;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = -120;
  analyser.maxDecibels = -20;
  source.connect(analyser);
  analyser.connect(context.destination);

  const dbBins = new Float32Array(analyser.frequencyBinCount);
  const magnitudesByWindow = new Array(windowCount);

  let previousTime = 0;
  const epsilon = 1 / sampleRate;
  const durationSeconds = samples.length / sampleRate;
  for (let index = 0; index < windowCount; index += 1) {
    const startSample = index * hopSamples;
    let snapshotTime = (startSample + (windowSize / 2)) / sampleRate;
    snapshotTime = clamp(snapshotTime, 0, Math.max(0, durationSeconds - epsilon));
    if (snapshotTime <= previousTime) {
      snapshotTime = Math.min(durationSeconds - epsilon, previousTime + epsilon);
    }
    previousTime = snapshotTime;

    context.suspend(snapshotTime).then(async () => {
      analyser.getFloatFrequencyData(dbBins);
      const magnitudes = new Float32Array(dbBins.length);
      for (let bin = 0; bin < dbBins.length; bin += 1) {
        magnitudes[bin] = dbToMagnitude(dbBins[bin]);
      }
      magnitudesByWindow[index] = magnitudes;
      await context.resume();
    });
  }

  source.start(0);
  await context.startRendering();

  return function getWindowSpectrum(windowIndex) {
    return magnitudesByWindow[windowIndex] ?? new Float32Array(binCount);
  };
}
