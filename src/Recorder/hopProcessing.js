import { clamp } from "../tools.js";
import { fillPicaWindowSamples, getPicaPitchResult } from "./picaPitch.js";
import { processPitchSample } from "./pitchProcessing.js";

// Bring each device's remembered loudest RMS to a common spectrogram level.
// Pitch detection, raw capture and minimum-volume calibration stay raw.
const NORMALIZED_MAX_RMS = 0.25;

export function createSpectrogramBuffers(binCount) {
  return {
    spectrumDb: new Float32Array(binCount),
  };
}

export function captureSpectrumForHop({ analyser, spectrogramBuffers, skipNextSpectrumFrame }) {
  if (!analyser) {
    return {
      capturedSpectrum: null,
      nextSkipNextSpectrumFrame: skipNextSpectrumFrame,
      spectrogramBuffers,
    };
  }

  let nextBuffers = spectrogramBuffers;
  if (nextBuffers.spectrumDb.length !== analyser.frequencyBinCount) {
    // FFT size can change across sessions/settings; keep reusable buffers sized to analyser bins.
    nextBuffers = createSpectrogramBuffers(analyser.frequencyBinCount);
  }

  analyser.getFloatFrequencyData(nextBuffers.spectrumDb);
  let allNegativeInfinity = true;
  for (let i = 0; i < nextBuffers.spectrumDb.length; i += 1) {
    const dbValue = nextBuffers.spectrumDb[i];
    if (dbValue !== Number.NEGATIVE_INFINITY) {
      allNegativeInfinity = false;
    }
  }

  if (allNegativeInfinity) {
    return {
      capturedSpectrum: null,
      nextSkipNextSpectrumFrame: true,
      spectrogramBuffers: nextBuffers,
    };
  }

  if (skipNextSpectrumFrame) {
    return {
      capturedSpectrum: null,
      nextSkipNextSpectrumFrame: false,
      spectrogramBuffers: nextBuffers,
    };
  }

  return {
    capturedSpectrum: {
      spectrumDb: nextBuffers.spectrumDb,
    },
    nextSkipNextSpectrumFrame: false,
    spectrogramBuffers: nextBuffers,
  };
}

function processHopPitch({
  processingState,
  audioSessionState,
  rawAudioState,
  volume,
  minVolumeThreshold,
  volumeTracking,
  lineStrengthEma,
  autoPauseOnSilence,
  smoothing,
  pitchRange,
}) {
  const minHz = pitchRange.minHz;
  const maxHz = pitchRange.maxHz;

  const maxHeardVolume = volumeTracking.maxHeardVolume;
  const epsilon = 1e-4;
  const usedMinVolume = minVolumeThreshold + epsilon > maxHeardVolume ? 0 : minVolumeThreshold;
  const volumeSpan = maxHeardVolume - usedMinVolume;
  const volumeStrength =
    volumeSpan > epsilon ? clamp((volume - usedMinVolume) / volumeSpan, 0, 1) : 1;

  const isAboveSilenceThreshold = volume > minVolumeThreshold;
  let cents = Number.NaN;
  if (
    isAboveSilenceThreshold &&
    rawAudioState.ring.sampleCount >= audioSessionState.picaWindowSamples.length
  ) {
    fillPicaWindowSamples(rawAudioState.ring, audioSessionState.picaWindowSamples);
    const picaPitchResult = getPicaPitchResult(
      audioSessionState.picaWindowSamples,
      rawAudioState.sampleRate,
      minHz,
      maxHz,
    );
    cents = picaPitchResult.cents;
  }

  let didFrameDataChange = false;
  const smoothedLineStrength = lineStrengthEma + (volumeStrength - lineStrengthEma) * 0.2;
  const nextLineStrengthEma = smoothedLineStrength;
  const pitchWriteResult = processPitchSample(processingState, {
    autoPauseOnSilence,
    smoothing,
    hasSignal: isAboveSilenceThreshold,
    cents,
    lineStrength: smoothedLineStrength,
  });
  if (pitchWriteResult.steps > 0) {
    didFrameDataChange = true;
  }

  return {
    didFrameDataChange,
    nextLineStrengthEma,
    isSilencePaused: pitchWriteResult?.paused ?? processingState.silencePaused,
  };
}

/**
 * Process one audio hop and update processing state.
 * Assumes caller handles manual pause gating.
 */
export function processOneAudioHop({ engineState, hopState }) {
  const {
    pitchRange,
    volume,
    minVolumeThreshold,
    volumeTracking,
    lineStrengthEma,
    autoPauseOnSilence,
    smoothing,
    skipNextSpectrumFrame,
  } = engineState;
  const {
    audioSessionState,
    rawAudioState,
    processingState,
    spectrogramBuffers,
    highResSpectrogramBuffers,
  } = hopState;
  const highResAnalyser = audioSessionState.highResAnalyser;
  // Pitch uses raw samples, so only read the analyser needed for the spectrogram.
  const captureResult = captureSpectrumForHop({
    analyser: highResAnalyser ?? audioSessionState.analyser,
    spectrogramBuffers: highResAnalyser ? highResSpectrogramBuffers : spectrogramBuffers,
    skipNextSpectrumFrame,
  });
  const spectrumDb = captureResult.capturedSpectrum?.spectrumDb ?? null;
  const nextSkipNextSpectrumFrame = captureResult.nextSkipNextSpectrumFrame;
  const nextSpectrogramBuffers = highResAnalyser
    ? spectrogramBuffers
    : captureResult.spectrogramBuffers;
  const nextHighResSpectrogramBuffers = highResAnalyser
    ? captureResult.spectrogramBuffers
    : highResSpectrogramBuffers;

  if (!spectrumDb) {
    return {
      didFrameDataChange: false,
      nextSkipNextSpectrumFrame,
      nextLineStrengthEma: lineStrengthEma,
      shouldPersistMaxVolume: false,
      spectrumDb: null,
      spectrogramBuffers: nextSpectrogramBuffers,
      highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
    };
  }

  const shouldPersistMaxVolume = volume > volumeTracking.maxHeardVolume + 0.1;
  if (shouldPersistMaxVolume) volumeTracking.maxHeardVolume = volume;
  const inputGain = NORMALIZED_MAX_RMS / 10 ** (volumeTracking.maxHeardVolume / 2.6 - 4);
  // Adding dB before the display floor is equivalent to multiplying the input
  // samples before the FFT, without modifying the raw recording buffer.
  const inputGainDb = 20 * Math.log10(inputGain);
  for (let i = 0; i < spectrumDb.length; i += 1) spectrumDb[i] += inputGainDb;

  const pitchResult = processHopPitch({
    pitchRange,
    volume,
    minVolumeThreshold,
    volumeTracking,
    lineStrengthEma,
    autoPauseOnSilence,
    smoothing,
    processingState,
    audioSessionState,
    rawAudioState,
  });
  const nextSpectrumDb = pitchResult.isSilencePaused ? null : spectrumDb;
  const didFrameDataChange = pitchResult.didFrameDataChange || Boolean(nextSpectrumDb);
  return {
    didFrameDataChange,
    nextSkipNextSpectrumFrame,
    nextLineStrengthEma: pitchResult.nextLineStrengthEma,
    shouldPersistMaxVolume,
    spectrumDb: nextSpectrumDb,
    spectrogramBuffers: nextSpectrogramBuffers,
    highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
  };
}
