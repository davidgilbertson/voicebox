import { clamp } from "../tools.js";
import { getPitchFromSpectrum } from "./pitchDetection.js";
import { fillPicaWindowSamples, getPicaPitchResult } from "./picaPitch.js";
import { processPitchSample } from "./pitchProcessing.js";

function getRelativeVolumeStrength(volume, minVolumeThreshold, maxHeardVolume) {
  const epsilon = 1e-4;
  let usedMinVolume = minVolumeThreshold;
  if (usedMinVolume + epsilon > maxHeardVolume) {
    usedMinVolume = 0;
  }
  const volumeSpan = maxHeardVolume - usedMinVolume;
  return volumeSpan > epsilon ? clamp((volume - usedMinVolume) / volumeSpan, 0, 1) : 1;
}

export function createSpectrogramBuffers(binCount) {
  return {
    spectrumDb: new Float32Array(binCount),
    spectrumForPitchDetection: new Float32Array(binCount),
  };
}

export function createHighResSpectrogramBuffers(binCount) {
  return {
    spectrumDb: new Float32Array(binCount),
  };
}

export function captureSpectrumForHop({
  analyser,
  spectrogramBuffers,
  skipNextSpectrumFrame,
  // When false, skip allocating/filling pitch-only arrays for spectrogram-only paths.
  includePitchDetection = true,
}) {
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
    nextBuffers = includePitchDetection
      ? createSpectrogramBuffers(analyser.frequencyBinCount)
      : createHighResSpectrogramBuffers(analyser.frequencyBinCount);
  }

  analyser.getFloatFrequencyData(nextBuffers.spectrumDb);
  const minDb = analyser.minDecibels;
  let allNegativeInfinity = true;
  let maxMagnitude = 0;
  const spectrumForPitchDetection = includePitchDetection
    ? nextBuffers.spectrumForPitchDetection
    : null;
  for (let i = 0; i < nextBuffers.spectrumDb.length; i += 1) {
    const dbValue = nextBuffers.spectrumDb[i];
    if (dbValue !== Number.NEGATIVE_INFINITY) {
      allNegativeInfinity = false;
    }
    const finiteDb = Number.isFinite(dbValue) ? dbValue : minDb;
    if (spectrumForPitchDetection) {
      const magnitude = 10 ** (finiteDb / 20);
      spectrumForPitchDetection[i] = magnitude;
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
      }
    }
  }

  if (spectrumForPitchDetection && maxMagnitude > 0) {
    const scale = 1 / maxMagnitude;
    for (let i = 0; i < spectrumForPitchDetection.length; i += 1) {
      spectrumForPitchDetection[i] *= scale;
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
      spectrumForPitchDetection,
    },
    nextSkipNextSpectrumFrame: false,
    spectrogramBuffers: nextBuffers,
  };
}

function processHopSpectrogram({
  audioSessionState,
  spectrogramBuffers,
  highResSpectrogramBuffers,
  skipNextSpectrumFrame,
  usePica,
}) {
  const analyser = audioSessionState.analyser;
  const highResAnalyser = audioSessionState.highResAnalyser;
  const shouldSkipBaseSpectrum = usePica && highResAnalyser;

  const baseCaptureResult = shouldSkipBaseSpectrum
    ? {
        capturedSpectrum: null,
        nextSkipNextSpectrumFrame: skipNextSpectrumFrame,
        spectrogramBuffers,
      }
    : captureSpectrumForHop({
        analyser,
        spectrogramBuffers,
        skipNextSpectrumFrame,
        includePitchDetection: !usePica,
      });
  const pitchSpectrum = baseCaptureResult.capturedSpectrum;
  const spectrumForPitchDetection = pitchSpectrum?.spectrumForPitchDetection ?? null;
  const nextSkipNextSpectrumFrame = baseCaptureResult.nextSkipNextSpectrumFrame;
  const nextSpectrogramBuffers = baseCaptureResult.spectrogramBuffers;

  const highResCaptureResult = highResAnalyser
    ? captureSpectrumForHop({
        analyser: highResAnalyser,
        spectrogramBuffers: highResSpectrogramBuffers,
        skipNextSpectrumFrame: nextSkipNextSpectrumFrame,
        // High-res path is spectrogram-only, so avoid pitch-detection work/allocation.
        includePitchDetection: false,
      })
    : null;

  const spectrogramSpectrum = highResCaptureResult?.capturedSpectrum ?? pitchSpectrum;
  const spectrumDb = spectrogramSpectrum?.spectrumDb ?? null;
  const nextHighResSpectrogramBuffers =
    highResCaptureResult?.spectrogramBuffers ?? highResSpectrogramBuffers;
  return {
    spectrumDb,
    spectrumForPitchDetection,
    nextSkipNextSpectrumFrame,
    spectrogramBuffers: nextSpectrogramBuffers,
    highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
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
  pitchRange,
  spectrumForPitchDetection,
  usePica,
}) {
  const minHz = pitchRange.minHz;
  const maxHz = pitchRange.maxHz;

  let shouldPersistMaxVolume = false;
  if (volume > volumeTracking.maxHeardVolume + 0.1) {
    volumeTracking.maxHeardVolume = volume;
    shouldPersistMaxVolume = true;
  }
  const maxHeardVolume = volumeTracking.maxHeardVolume;
  const volumeStrength = getRelativeVolumeStrength(volume, minVolumeThreshold, maxHeardVolume);

  const isAboveSilenceThreshold = volume > minVolumeThreshold;
  let cents = Number.NaN;
  if (usePica) {
    if (isAboveSilenceThreshold) {
      if (rawAudioState.ring.sampleCount < audioSessionState.picaWindowSamples.length) {
        audioSessionState.picaPriorStep = null;
      } else {
        fillPicaWindowSamples(rawAudioState.ring, audioSessionState.picaWindowSamples);
        const picaPitchResult = getPicaPitchResult(
          audioSessionState.picaWindowSamples,
          rawAudioState.sampleRate,
          minHz,
          maxHz,
          audioSessionState.picaPriorStep,
        );
        cents = picaPitchResult.cents;
        audioSessionState.picaPriorStep = picaPitchResult.priorStep;
      }
    } else {
      audioSessionState.picaPriorStep = null;
    }
  } else {
    audioSessionState.picaPriorStep = null;
    cents = isAboveSilenceThreshold
      ? getPitchFromSpectrum(audioSessionState, spectrumForPitchDetection, minHz, maxHz)
      : Number.NaN;
  }

  let didFrameDataChange = false;
  let pitchWriteResult = null;
  let nextLineStrengthEma = lineStrengthEma;
  const smoothedLineStrength = lineStrengthEma + (volumeStrength - lineStrengthEma) * 0.2;
  nextLineStrengthEma = smoothedLineStrength;
  pitchWriteResult = processPitchSample(processingState, {
    autoPauseOnSilence,
    hasSignal: isAboveSilenceThreshold,
    cents,
    lineStrength: smoothedLineStrength,
  });
  if (pitchWriteResult.steps > 0) {
    didFrameDataChange = true;
  }

  return {
    didFrameDataChange,
    shouldPersistMaxVolume,
    nextLineStrengthEma,
    isSilencePaused: pitchWriteResult?.paused ?? processingState.silencePaused,
  };
}

/**
 * Process one FFT hop and update processing state.
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
    skipNextSpectrumFrame,
    usePica,
  } = engineState;
  const activeVolumeTracking = volumeTracking;
  const {
    audioSessionState,
    rawAudioState,
    processingState,
    spectrogramBuffers,
    highResSpectrogramBuffers,
  } = hopState;
  const spectrogramResult = processHopSpectrogram({
    audioSessionState,
    spectrogramBuffers,
    highResSpectrogramBuffers,
    skipNextSpectrumFrame,
    usePica,
  });
  const {
    spectrumDb,
    spectrumForPitchDetection,
    nextSkipNextSpectrumFrame,
    spectrogramBuffers: nextSpectrogramBuffers,
    highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
  } = spectrogramResult;

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

  const pitchResult = processHopPitch({
    pitchRange,
    volume,
    minVolumeThreshold,
    volumeTracking: activeVolumeTracking,
    lineStrengthEma,
    autoPauseOnSilence,
    processingState,
    audioSessionState,
    rawAudioState,
    spectrumForPitchDetection,
    usePica,
  });
  const nextSpectrumDb = pitchResult.isSilencePaused ? null : spectrumDb;
  const didFrameDataChange = pitchResult.didFrameDataChange || Boolean(nextSpectrumDb);
  return {
    didFrameDataChange,
    nextSkipNextSpectrumFrame,
    nextLineStrengthEma: pitchResult.nextLineStrengthEma,
    shouldPersistMaxVolume: pitchResult.shouldPersistMaxVolume,
    spectrumDb: nextSpectrumDb,
    spectrogramBuffers: nextSpectrogramBuffers,
    highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
  };
}
