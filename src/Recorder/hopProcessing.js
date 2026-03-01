import {clamp} from "../tools.js";
import {getPitchFromSpectrum} from "./pitchDetection.js";
import {processPitchSample} from "./pitchProcessing.js";

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

function processHopSpectrogram({
  audioSessionState,
  spectrogramCapture,
  skipNextSpectrumFrame,
  spectrogramNoiseState,
}) {
  const captureResult = captureSpectrumForHop({
    analyser: audioSessionState.analyser,
    spectrogramCapture,
    skipNextSpectrumFrame,
  });
  const capturedSpectrum = captureResult.capturedSpectrum;
  const spectrumNormalized = capturedSpectrum?.spectrumNormalized ?? null;
  const spectrumForPitchDetection = capturedSpectrum?.spectrumForPitchDetection ?? null;
  const nextSkipNextSpectrumFrame = captureResult.nextSkipNextSpectrumFrame;
  const nextSpectrogramCapture = captureResult.spectrogramCapture;
  const buildSpectrogramOutput = ({isSilencePaused}) => {
    if (!spectrumNormalized || isSilencePaused) {
      return {
        spectrogramColumn: null,
        spectrogramCapture: nextSpectrogramCapture,
        didFrameDataChange: false,
      };
    }
    const noiseResult = applyNoiseProfileToSpectrum({
      spectrumNormalized,
      spectrogramNoiseState,
      spectrogramCapture: nextSpectrogramCapture,
    });
    return {
      spectrogramColumn: noiseResult.spectrumFiltered,
      spectrogramCapture: noiseResult.spectrogramCapture,
      didFrameDataChange: true,
    };
  };
  return {
    spectrumForPitchDetection,
    nextSkipNextSpectrumFrame,
    nextSpectrogramCapture,
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
  activeView,
  pitchRange,
  spectrogramRange,
  spectrumForPitchDetection,
}) {
  const minHz = activeView === "spectrogram" ? spectrogramRange.minHz : pitchRange.minHz;
  const maxHz = activeView === "spectrogram" ? spectrogramRange.maxHz : pitchRange.maxHz;

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
    activeView,
    pitchRange,
    spectrogramRange,
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
    spectrogramNoiseState,
    spectrogramCapture,
  } = hopState;
  const spectrogramResult = processHopSpectrogram({
    audioSessionState,
    spectrogramCapture,
    skipNextSpectrumFrame,
    spectrogramNoiseState,
  });
  const {
    spectrumForPitchDetection,
    nextSkipNextSpectrumFrame,
    nextSpectrogramCapture,
    buildSpectrogramOutput,
  } = spectrogramResult;

  if (!spectrumForPitchDetection) {
    return {
      didFrameDataChange: false,
      nextSkipNextSpectrumFrame,
      nextLineStrengthEma: lineStrengthEma,
      shouldPersistMaxSignalLevel: false,
      spectrogramColumn: null,
      spectrogramCapture: nextSpectrogramCapture,
    };
  }

  const pitchResult = processHopPitchAndSignals({
    activeView,
    pitchRange,
    spectrogramRange,
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
    spectrogramCapture: spectrogramOutput.spectrogramCapture,
  };
}
