import {clamp} from "../tools.js";

export function createSpectrogramCaptureBuffers(binCount) {
  return {
    spectrumNormalized: new Float32Array(binCount),
    spectrumDb: new Float32Array(binCount),
    spectrumForPitchDetection: new Float32Array(binCount),
    spectrumFiltered: new Float32Array(binCount),
  };
}

export function captureSpectrumForHop({
  analyser,
  spectrogramCapture,
  skipNextSpectrumFrame,
}) {
  if (!analyser) {
    return {
      capturedSpectrum: null,
      nextSkipNextSpectrumFrame: skipNextSpectrumFrame,
      spectrogramCapture,
    };
  }

  let nextCapture = spectrogramCapture;
  if (nextCapture.spectrumNormalized.length !== analyser.frequencyBinCount) {
    nextCapture = createSpectrogramCaptureBuffers(analyser.frequencyBinCount);
  }

  analyser.getFloatFrequencyData(nextCapture.spectrumDb);
  const minDb = analyser.minDecibels;
  const maxDb = analyser.maxDecibels;
  const dbRange = maxDb - minDb;
  const invDbRange = dbRange > 0 ? 1 / dbRange : 0;
  let allNegativeInfinity = true;
  let maxMagnitude = 0;
  for (let i = 0; i < nextCapture.spectrumDb.length; i += 1) {
    const dbValue = nextCapture.spectrumDb[i];
    if (dbValue !== Number.NEGATIVE_INFINITY) {
      allNegativeInfinity = false;
    }
    const finiteDb = Number.isFinite(dbValue) ? dbValue : minDb;
    const magnitude = 10 ** (finiteDb / 20);
    nextCapture.spectrumForPitchDetection[i] = magnitude;
    if (magnitude > maxMagnitude) {
      maxMagnitude = magnitude;
    }
    const normalized = (finiteDb - minDb) * invDbRange;
    nextCapture.spectrumNormalized[i] = clamp(normalized, 0, 1);
  }

  if (maxMagnitude > 0) {
    const scale = 1 / maxMagnitude;
    for (let i = 0; i < nextCapture.spectrumForPitchDetection.length; i += 1) {
      nextCapture.spectrumForPitchDetection[i] *= scale;
    }
  }

  if (allNegativeInfinity) {
    return {
      capturedSpectrum: null,
      nextSkipNextSpectrumFrame: true,
      spectrogramCapture: nextCapture,
    };
  }

  if (skipNextSpectrumFrame) {
    return {
      capturedSpectrum: null,
      nextSkipNextSpectrumFrame: false,
      spectrogramCapture: nextCapture,
    };
  }

  return {
    capturedSpectrum: {
      spectrumNormalized: nextCapture.spectrumNormalized,
      spectrumForPitchDetection: nextCapture.spectrumForPitchDetection,
    },
    nextSkipNextSpectrumFrame: false,
    spectrogramCapture: nextCapture,
  };
}

export function applyNoiseProfileToSpectrum({
  spectrumNormalized,
  spectrogramNoiseState,
  spectrogramCapture,
}) {
  if (spectrogramNoiseState.calibrating && spectrogramNoiseState.sumBins) {
    const captureCount = Math.min(spectrogramNoiseState.sumBins.length, spectrumNormalized.length);
    for (let i = 0; i < captureCount; i += 1) {
      spectrogramNoiseState.sumBins[i] += spectrumNormalized[i];
    }
    spectrogramNoiseState.sampleCount += 1;
  }

  if (!spectrogramNoiseState.profile) {
    return {
      spectrumFiltered: spectrumNormalized,
      spectrogramCapture,
    };
  }

  if (spectrogramCapture.spectrumFiltered.length !== spectrumNormalized.length) {
    spectrogramCapture.spectrumFiltered = new Float32Array(spectrumNormalized.length);
  }
  const spectrumFiltered = spectrogramCapture.spectrumFiltered;
  const profileCount = Math.min(spectrogramNoiseState.profile.length, spectrumNormalized.length);
  for (let i = 0; i < profileCount; i += 1) {
    const value = spectrumNormalized[i];
    const weightedNoise = spectrogramNoiseState.profile[i] * (1 - value);
    spectrumFiltered[i] = Math.max(0, value - weightedNoise);
  }
  for (let i = profileCount; i < spectrumNormalized.length; i += 1) {
    spectrumFiltered[i] = spectrumNormalized[i];
  }
  return {
    spectrumFiltered,
    spectrogramCapture,
  };
}

export function processOneAudioHop({
  isManuallyPaused,
  activeView,
  pitchRange,
  spectrogramRange,
  signalLevel,
  minSignalThreshold,
  signalTracking,
  spectrumIntensityEma,
  autoPauseOnSilence,
  timeline,
  audioState,
  spectrogramNoiseState,
  spectrogramCapture,
  skipNextSpectrumFrame,
  analyzePitch,
  writePitchTimeline,
  estimateTimelineVibratoRate,
  vibratoRateConfig,
}) {
  if (isManuallyPaused) {
    return {
      didFrameDataChange: false,
      nextSkipNextSpectrumFrame: skipNextSpectrumFrame,
      nextSpectrumIntensityEma: spectrumIntensityEma,
      shouldPersistMaxSignalLevel: false,
      spectrogramColumn: null,
      spectrogramCapture,
    };
  }

  const minHz = activeView === "spectrogram" ? spectrogramRange.minHz : pitchRange.minHz;
  const maxHz = activeView === "spectrogram" ? spectrogramRange.maxHz : pitchRange.maxHz;
  let didFrameDataChange = false;
  const captureResult = captureSpectrumForHop({
    analyser: audioState.analyser,
    spectrogramCapture,
    skipNextSpectrumFrame,
  });
  const capturedSpectrum = captureResult.capturedSpectrum;
  const spectrumNormalized = capturedSpectrum?.spectrumNormalized ?? null;
  const spectrumForPitchDetection = capturedSpectrum?.spectrumForPitchDetection ?? null;
  const nextSkipNextSpectrumFrame = captureResult.nextSkipNextSpectrumFrame;
  const nextSpectrogramCapture = captureResult.spectrogramCapture;

  if (!spectrumForPitchDetection) {
    return {
      didFrameDataChange: false,
      nextSkipNextSpectrumFrame,
      nextSpectrumIntensityEma: spectrumIntensityEma,
      shouldPersistMaxSignalLevel: false,
      spectrogramColumn: null,
      spectrogramCapture: nextSpectrogramCapture,
    };
  }

  let shouldPersistMaxSignalLevel = false;
  if (signalLevel > (signalTracking.maxHeardSignalLevel + 0.01)) {
    signalTracking.maxHeardSignalLevel = signalLevel;
    shouldPersistMaxSignalLevel = true;
  }
  const maxHeardSignalLevel = signalTracking.maxHeardSignalLevel;
  const usedMaxSignalLevel = maxHeardSignalLevel * 0.8;

  const isAboveSilenceThreshold = signalLevel > minSignalThreshold;
  const result = isAboveSilenceThreshold
    ? analyzePitch(audioState, null, spectrumForPitchDetection, minHz, maxHz)
    : {cents: Number.NaN};

  let pitchWriteResult = null;
  let nextSpectrumIntensityEma = spectrumIntensityEma;
  if (result) {
    const signalSpan = usedMaxSignalLevel - minSignalThreshold;
    const signalIntensity = clamp(
      signalSpan > 0 ? ((signalLevel - minSignalThreshold) / signalSpan) : 0,
      0,
      1
    );
    const smoothedSpectrumIntensity = spectrumIntensityEma + ((signalIntensity - spectrumIntensityEma) * 0.2);
    nextSpectrumIntensityEma = smoothedSpectrumIntensity;
    pitchWriteResult = writePitchTimeline(timeline, {
      autoPauseOnSilence,
      hasSignal: isAboveSilenceThreshold,
      cents: result.cents,
      intensity: smoothedSpectrumIntensity,
    });
    if (pitchWriteResult.steps > 0) {
      const estimatedRateNow = estimateTimelineVibratoRate({
        values: timeline.values,
        writeIndex: timeline.writeIndex,
        count: timeline.count,
        samplesPerSecond: timeline.columnRateHz,
        minRateHz: vibratoRateConfig.minRateHz,
        maxRateHz: vibratoRateConfig.maxRateHz,
        analysisWindowSeconds: vibratoRateConfig.analysisWindowSeconds,
        minContinuousSeconds: vibratoRateConfig.minContinuousSeconds,
      });
      timeline.vibratoRates[pitchWriteResult.lastWriteIndex] = estimatedRateNow ?? Number.NaN;
      didFrameDataChange = true;
    }
  }

  const spectrogramSilencePaused = pitchWriteResult?.paused ?? timeline.silencePaused;
  if (!spectrumNormalized || spectrogramSilencePaused) {
    return {
      didFrameDataChange,
      nextSkipNextSpectrumFrame,
      nextSpectrumIntensityEma,
      shouldPersistMaxSignalLevel,
      spectrogramColumn: null,
      spectrogramCapture: nextSpectrogramCapture,
    };
  }

  const noiseResult = applyNoiseProfileToSpectrum({
    spectrumNormalized,
    spectrogramNoiseState,
    spectrogramCapture: nextSpectrogramCapture,
  });
  didFrameDataChange = true;

  return {
    didFrameDataChange,
    nextSkipNextSpectrumFrame,
    nextSpectrumIntensityEma,
    shouldPersistMaxSignalLevel,
    spectrogramColumn: noiseResult.spectrumFiltered,
    spectrogramCapture: noiseResult.spectrogramCapture,
  };
}
