import { ACTUAL_LABEL_STORAGE_KEYS } from "./actualLabels.js";

function getCurrentActualStorageKey() {
  const currentSource = window.expDebug.currentSource;
  if (currentSource?.type !== "asset" || typeof currentSource.url !== "string") {
    return null;
  }
  if (currentSource.url.endsWith("vocal_sampler.wav")) {
    return ACTUAL_LABEL_STORAGE_KEYS.vocalSampler;
  }
  if (currentSource.url.endsWith("vocal_sampler_long.wav")) {
    return ACTUAL_LABEL_STORAGE_KEYS.vocalSamplerLong;
  }
  return null;
}

function dumpCurrentActual() {
  const storageKey = getCurrentActualStorageKey();
  if (!storageKey) {
    console.log(
      "dumpCurrentActual() only works when the selected source is vocal_sampler.wav or vocal_sampler_long.wav.",
    );
    return null;
  }

  const actualPitchHz = window.expDebug.currentResult?.actualPitchHz;
  if (!Array.isArray(actualPitchHz)) {
    console.log("No loaded actual pitch array is available for the current source.");
    return null;
  }

  return actualPitchHz;
}

export function ensureExperimentDebugGlobals() {
  window.expDebug ??= {
    currentSource: null,
    currentResult: null,
    actualLabelStorageKeys: ACTUAL_LABEL_STORAGE_KEYS,
  };

  window.picaDebug ??= {
    rejectionReason: null,
    winningType: null,
    winningHz: Number.NaN,
    winningPeriodSize: Number.NaN,
    winningCorrelation: Number.NaN,
    zeroCrossingDensity: Number.NaN,
  };

  window.pica2Debug ??= {
    bins: null,
  };

  window.piraDebug ??= {
    points: null,
    predictionSpans: [],
    predictionReason: null,
    predictionReasons: [],
    spreadsByWindow: [],
    periodSamplesByWindow: [],
    selectedPoint: null,
    maxAbsSample: 1,
    ampPerMilli: 0.1,
    spread: Number.NaN,
    periodSamples: Number.NaN,
  };

  window.pifsDebug ??= {
    folds: [],
    scenarioAnalyses: [],
    predictionReason: null,
    periodWidth: Number.NaN,
    foldScenario: Number.NaN,
    ampDisplacement: Number.NaN,
    selectedRange: null,
    global: {
      predictionReasons: [],
      periodWidthsByWindow: [],
      foldScenariosByWindow: [],
      ampDisplacementsByWindow: [],
      maxAbsSample: 1,
      windowIndex: null,
      waveformWindow: null,
    },
  };

  window.piscDebug ??= {
    periodSizes: [],
    hz: [],
    correlations: [],
    winningPeriodSize: Number.NaN,
    winningCorrelation: Number.NaN,
  };

  window.pipsDebug ??= {
    points: [],
    minRawAmp: Number.NaN,
    maxRawAmp: Number.NaN,
    peakSpans: [],
    troughSpans: [],
    combinedSpans: [],
    bestSpan: null,
    selectedSpan: Number.NaN,
    rejectionReason: null,
  };

  window.pizaDebug ??= {
    foldAnalyses: [],
    activeWindowIndex: null,
    recordFoldDebug: false,
  };

  window.dumpCurrentActual = dumpCurrentActual;
}
