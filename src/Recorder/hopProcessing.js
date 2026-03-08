import { clamp } from "../tools.js";
import { getPitchFromSpectrum } from "./pitchDetection.js";
import { processPitchSample } from "./pitchProcessing.js";

function getRelativeVolumeStrength(volume, minVolumeThreshold, maxHeardVolume) {
  const epsilon = 1e-4;
  let usedMinVolume = minVolumeThreshold;
  const usedMaxVolume = maxHeardVolume;
  if (usedMinVolume + epsilon > usedMaxVolume) {
    usedMinVolume = 0;
  }
  const volumeSpan = usedMaxVolume - usedMinVolume;
  const canScale = volumeSpan > epsilon;
  return {
    usedMinVolume,
    usedMaxVolume,
    volumeSpan,
    canScale,
    volumeStrength: canScale ? clamp((volume - usedMinVolume) / volumeSpan, 0, 1) : 1,
  };
}

export function createSpectrogramBuffers(binCount) {
  return {
    spectrumNormalized: new Float32Array(binCount),
    spectrumDb: new Float32Array(binCount),
    spectrumForPitchDetection: new Float32Array(binCount),
  };
}

export function createHighResSpectrogramBuffers(binCount) {
  return {
    spectrumNormalized: new Float32Array(binCount),
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
  if (nextBuffers.spectrumNormalized.length !== analyser.frequencyBinCount) {
    // FFT size can change across sessions/settings; keep reusable buffers sized to analyser bins.
    nextBuffers = includePitchDetection
      ? createSpectrogramBuffers(analyser.frequencyBinCount)
      : createHighResSpectrogramBuffers(analyser.frequencyBinCount);
  }

  analyser.getFloatFrequencyData(nextBuffers.spectrumDb);
  const minDb = analyser.minDecibels;
  const maxDb = analyser.maxDecibels;
  const dbRange = maxDb - minDb;
  const invDbRange = dbRange > 0 ? 1 / dbRange : 0;
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
    const normalized = (finiteDb - minDb) * invDbRange;
    nextBuffers.spectrumNormalized[i] = clamp(normalized, 0, 1);
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
      spectrumNormalized: nextBuffers.spectrumNormalized,
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
}) {
  const analyser = audioSessionState.analyser;
  const highResAnalyser = audioSessionState.highResAnalyser;

  // Base analyser always drives pitch detection.
  const baseCaptureResult = captureSpectrumForHop({
    analyser,
    spectrogramBuffers,
    skipNextSpectrumFrame,
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
  const spectrumNormalized = spectrogramSpectrum?.spectrumNormalized ?? null;
  const nextHighResSpectrogramBuffers =
    highResCaptureResult?.spectrogramBuffers ?? highResSpectrogramBuffers;
  const activeSpectrogramBuffers = highResAnalyser
    ? nextHighResSpectrogramBuffers
    : nextSpectrogramBuffers;
  const buildSpectrogramOutput = ({ isSilencePaused, signalStrength }) => {
    if (!spectrumNormalized || isSilencePaused) {
      return {
        spectrogramColumn: null,
        spectrogramColumnGain: 0,
        spectrogramBuffers: activeSpectrogramBuffers,
        didFrameDataChange: false,
      };
    }
    return {
      spectrogramColumn: spectrumNormalized,
      spectrogramColumnGain: signalStrength,
      spectrogramBuffers: activeSpectrogramBuffers,
      didFrameDataChange: true,
    };
  };
  return {
    spectrumForPitchDetection,
    nextSkipNextSpectrumFrame,
    nextSpectrogramBuffers,
    nextHighResSpectrogramBuffers,
    buildSpectrogramOutput,
  };
}

function processHopPitchAndSignals({
  processingState,
  audioSessionState,
  volume,
  minVolumeThreshold,
  volumeTracking,
  lineStrengthEma,
  autoPauseOnSilence,
  pitchRange,
  spectrumForPitchDetection,
}) {
  const minHz = pitchRange.minHz;
  const maxHz = pitchRange.maxHz;

  let shouldPersistMaxVolume = false;
  if (volume > volumeTracking.maxHeardVolume + 0.1) {
    volumeTracking.maxHeardVolume = volume;
    shouldPersistMaxVolume = true;
  }
  const maxHeardVolume = volumeTracking.maxHeardVolume;
  const scaling = getRelativeVolumeStrength(volume, minVolumeThreshold, maxHeardVolume);
  const volumeStrength = scaling.volumeStrength;

  const isAboveSilenceThreshold = volume > minVolumeThreshold;
  // The same derived loudness floor gates pitch detection, even when auto-pause is disabled.
  const cents = isAboveSilenceThreshold
    ? getPitchFromSpectrum(audioSessionState, spectrumForPitchDetection, minHz, maxHz)
    : Number.NaN;

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
    volumeScaling: scaling,
    volumeStrength,
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
  } = engineState;
  const activeVolumeTracking = volumeTracking;
  const { audioSessionState, processingState, spectrogramBuffers, highResSpectrogramBuffers } =
    hopState;
  const spectrogramResult = processHopSpectrogram({
    audioSessionState,
    spectrogramBuffers,
    highResSpectrogramBuffers,
    skipNextSpectrumFrame,
  });
  const {
    spectrumForPitchDetection,
    nextSkipNextSpectrumFrame,
    nextSpectrogramBuffers,
    nextHighResSpectrogramBuffers,
    buildSpectrogramOutput,
  } = spectrogramResult;

  if (!spectrumForPitchDetection) {
    return {
      didFrameDataChange: false,
      nextSkipNextSpectrumFrame,
      nextLineStrengthEma: lineStrengthEma,
      shouldPersistMaxVolume: false,
      spectrogramColumn: null,
      spectrogramColumnGain: 0,
      spectrogramDebug: null,
      spectrogramBuffers: nextSpectrogramBuffers,
      highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
    };
  }

  const pitchResult = processHopPitchAndSignals({
    pitchRange,
    volume,
    minVolumeThreshold,
    volumeTracking: activeVolumeTracking,
    lineStrengthEma,
    autoPauseOnSilence,
    processingState,
    audioSessionState,
    spectrumForPitchDetection,
  });
  const spectrogramOutput = buildSpectrogramOutput({
    isSilencePaused: pitchResult.isSilencePaused,
    signalStrength: pitchResult.volumeStrength,
  });
  const spectrogramPeak =
    spectrogramOutput.spectrogramColumn && spectrogramOutput.spectrogramColumn.length > 0
      ? spectrogramOutput.spectrogramColumn.reduce(
          (peak, value) => Math.max(peak, value * spectrogramOutput.spectrogramColumnGain),
          0,
        )
      : 0;
  const didFrameDataChange = pitchResult.didFrameDataChange || spectrogramOutput.didFrameDataChange;
  return {
    didFrameDataChange,
    nextSkipNextSpectrumFrame,
    nextLineStrengthEma: pitchResult.nextLineStrengthEma,
    shouldPersistMaxVolume: pitchResult.shouldPersistMaxVolume,
    spectrogramColumn: spectrogramOutput.spectrogramColumn,
    spectrogramColumnGain: spectrogramOutput.spectrogramColumnGain,
    spectrogramDebug: {
      peakAfterScaling: spectrogramPeak,
      scalingFactor: spectrogramOutput.spectrogramColumnGain,
      usedMinVolume: pitchResult.volumeScaling.usedMinVolume,
      usedMaxVolume: pitchResult.volumeScaling.usedMaxVolume,
      volumeSpan: pitchResult.volumeScaling.volumeSpan,
      minVolumeThreshold,
      currentVolume: volume,
      maxHeardVolume: activeVolumeTracking.maxHeardVolume,
      canScale: pitchResult.volumeScaling.canScale,
    },
    spectrogramBuffers: nextSpectrogramBuffers,
    highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
  };
}
