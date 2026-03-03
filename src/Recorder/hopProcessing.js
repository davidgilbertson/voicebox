import {clamp} from "../tools.js";
import {getPitchFromSpectrum} from "./pitchDetection.js";
import {processPitchSample} from "./pitchProcessing.js";

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
  const spectrumForPitchDetection = includePitchDetection ? nextBuffers.spectrumForPitchDetection : null;
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
  const nextHighResSpectrogramBuffers = highResCaptureResult?.spectrogramBuffers ?? highResSpectrogramBuffers;
  const activeSpectrogramBuffers = highResAnalyser ? nextHighResSpectrogramBuffers : nextSpectrogramBuffers;
  const buildSpectrogramOutput = ({isSilencePaused}) => {
    if (!spectrumNormalized || isSilencePaused) {
      return {
        spectrogramColumn: null,
        spectrogramBuffers: activeSpectrogramBuffers,
        didFrameDataChange: false,
      };
    }
    return {
      spectrogramColumn: spectrumNormalized,
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
                                     signalLevel,
                                     minSignalThreshold,
                                     signalTracking,
                                     lineStrengthEma,
                                     autoPauseOnSilence,
                                     pitchRange,
                                     spectrumForPitchDetection,
                                   }) {
  const minHz = pitchRange.minHz;
  const maxHz = pitchRange.maxHz;

  let shouldPersistMaxSignalLevel = false;
  if (signalLevel > (signalTracking.maxHeardSignalLevel + 0.01)) {
    signalTracking.maxHeardSignalLevel = signalLevel;
    shouldPersistMaxSignalLevel = true;
  }
  const maxHeardSignalLevel = signalTracking.maxHeardSignalLevel;
  const usedMaxSignalLevel = maxHeardSignalLevel * 0.8;

  const isAboveSilenceThreshold = signalLevel > minSignalThreshold;
  const result = isAboveSilenceThreshold
      ? getPitchFromSpectrum(audioSessionState, spectrumForPitchDetection, minHz, maxHz)
      : {cents: Number.NaN};

  let didFrameDataChange = false;
  let pitchWriteResult = null;
  let nextLineStrengthEma = lineStrengthEma;
  if (result) {
    const signalSpan = usedMaxSignalLevel - minSignalThreshold;
    const lineStrength = clamp(
        signalSpan > 0 ? ((signalLevel - minSignalThreshold) / signalSpan) : 0,
        0,
        1
    );
    const smoothedLineStrength = lineStrengthEma + ((lineStrength - lineStrengthEma) * 0.2);
    nextLineStrengthEma = smoothedLineStrength;
    pitchWriteResult = processPitchSample(processingState, {
      autoPauseOnSilence,
      hasSignal: isAboveSilenceThreshold,
      cents: result.cents,
      lineStrength: smoothedLineStrength,
    });
    if (pitchWriteResult.steps > 0) {
      didFrameDataChange = true;
    }
  }

  return {
    didFrameDataChange,
    shouldPersistMaxSignalLevel,
    nextLineStrengthEma,
    isSilencePaused: pitchWriteResult?.paused ?? processingState.silencePaused,
  };
}

/**
 * Process one FFT hop and update processing state.
 * Assumes caller handles manual pause gating.
 */
export function processOneAudioHop({
                                     engineState,
                                     hopState,
                                   }) {
  const {
    pitchRange,
    signalLevel,
    minSignalThreshold,
    signalTracking,
    lineStrengthEma,
    autoPauseOnSilence,
    skipNextSpectrumFrame,
  } = engineState;
  const {
    audioSessionState,
    processingState,
    spectrogramBuffers,
    highResSpectrogramBuffers,
  } = hopState;
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
      shouldPersistMaxSignalLevel: false,
      spectrogramColumn: null,
      spectrogramBuffers: nextSpectrogramBuffers,
      highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
    };
  }

  const pitchResult = processHopPitchAndSignals({
    pitchRange,
    signalLevel,
    minSignalThreshold,
    signalTracking,
    lineStrengthEma,
    autoPauseOnSilence,
    processingState,
    audioSessionState,
    spectrumForPitchDetection,
  });
  const spectrogramOutput = buildSpectrogramOutput({
    isSilencePaused: pitchResult.isSilencePaused,
  });
  const didFrameDataChange = pitchResult.didFrameDataChange || spectrogramOutput.didFrameDataChange;
  return {
    didFrameDataChange,
    nextSkipNextSpectrumFrame,
    nextLineStrengthEma: pitchResult.nextLineStrengthEma,
    shouldPersistMaxSignalLevel: pitchResult.shouldPersistMaxSignalLevel,
    spectrogramColumn: spectrogramOutput.spectrogramColumn,
    spectrogramBuffers: nextSpectrogramBuffers,
    highResSpectrogramBuffers: nextHighResSpectrogramBuffers,
  };
}
