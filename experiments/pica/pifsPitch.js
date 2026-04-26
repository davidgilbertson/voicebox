import { PICA_MAX_HZ, PICA_MIN_HZ, PICA_SETTINGS_DEFAULTS } from "./config.js";
import { getFoldExtremaFromWaveform } from "./pizaPitch.js";

function getScaledSamples(samples) {
  const scaledSamples = new Float32Array(samples.length);
  let maxAbsSample = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const rawAmp = samples[index];
    const absSample = Math.abs(rawAmp);
    if (absSample > maxAbsSample) {
      maxAbsSample = absSample;
    }
    scaledSamples[index] = rawAmp;
  }

  if (maxAbsSample > 0) {
    for (let index = 0; index < scaledSamples.length; index += 1) {
      scaledSamples[index] /= maxAbsSample;
    }
  }

  return { scaledSamples, maxAbsSample };
}

function getScenarioMatch(
  folds,
  foldScenario,
  minPeriodSamples,
  maxPeriodSamples,
  spreadThreshold,
  ampDisplacementThreshold,
) {
  if (folds.length < foldScenario * 2) return null;

  const widthSpreads = [];
  let ampDisplacement = 0;
  let periodWidth = 0;
  let periodStartIndex = -1;
  let periodEndIndex = -1;
  for (let foldOffset = 0; foldOffset < foldScenario; foldOffset += 1) {
    const leftFold = folds.at(-(foldOffset + foldScenario + 1));
    const rightFold = folds.at(-(foldOffset + 1));
    const meanWidth = (leftFold.width + rightFold.width) / 2;
    const widthSpread = (Math.abs(leftFold.width - rightFold.width) / meanWidth) * 100;
    widthSpreads.push(widthSpread);
    if (widthSpread >= spreadThreshold) {
      return {
        foldScenario,
        matched: false,
        failedAtFold: foldOffset + 1,
        widthSpreads,
      };
    }
    ampDisplacement += Math.abs(leftFold.extremaAmplitude - rightFold.extremaAmplitude);
    periodWidth += rightFold.width;
    periodStartIndex = rightFold.startIndex;
    if (periodEndIndex === -1) {
      periodEndIndex = rightFold.endIndex;
    }
  }

  ampDisplacement /= foldScenario;

  if (periodWidth < minPeriodSamples || periodWidth > maxPeriodSamples) {
    return {
      foldScenario,
      matched: false,
      failedAtFold: null,
      widthSpreads,
      ampDisplacement,
      periodWidth,
      rejectionReason: "periodRange",
    };
  }

  if (ampDisplacement >= ampDisplacementThreshold) {
    return {
      foldScenario,
      matched: false,
      failedAtFold: null,
      widthSpreads,
      ampDisplacement,
      periodWidth,
      rejectionReason: "ampDisplacement",
    };
  }

  return {
    foldScenario,
    matched: true,
    failedAtFold: null,
    widthSpreads,
    ampDisplacement,
    periodWidth,
    selectedRange: {
      startIndex: periodStartIndex,
      endIndex: periodEndIndex,
    },
  };
}

export function getPifsPitchHzFromWaveform(samples, sampleRate, settings) {
  const debug = window.pifsDebug;
  const globalDebug = debug.global;
  const { scaledSamples, maxAbsSample } = getScaledSamples(samples);
  const foldPoints = getFoldExtremaFromWaveform(scaledSamples, settings);
  const minPeriodSamples = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSamples = Math.max(minPeriodSamples, Math.floor(sampleRate / PICA_MIN_HZ));
  const spreadThreshold =
    settings.pifsSpreadThreshold ?? PICA_SETTINGS_DEFAULTS.pifsSpreadThreshold;
  const ampDisplacementThreshold =
    settings.pifsAmpDisplacementThreshold ?? PICA_SETTINGS_DEFAULTS.pifsAmpDisplacementThreshold;
  const maxFolds = Math.max(
    2,
    Math.floor(settings.pifsMaxFolds ?? PICA_SETTINGS_DEFAULTS.pifsMaxFolds),
  );

  debug.folds = foldPoints.folds;
  debug.scenarioAnalyses = [];
  debug.predictionReason = "noMatch";
  debug.periodWidth = Number.NaN;
  debug.foldScenario = Number.NaN;
  debug.ampDisplacement = Number.NaN;
  debug.selectedRange = null;
  globalDebug.maxAbsSample = maxAbsSample;

  for (
    let foldScenario = 2;
    foldScenario <= Math.min(maxFolds, foldPoints.folds.length);
    foldScenario += 2
  ) {
    const scenario = getScenarioMatch(
      foldPoints.folds,
      foldScenario,
      minPeriodSamples,
      maxPeriodSamples,
      spreadThreshold,
      ampDisplacementThreshold,
    );
    if (scenario === null) {
      break;
    }
    debug.scenarioAnalyses.push(scenario);
    if (!scenario.matched) {
      continue;
    }

    debug.predictionReason = `matched:${foldScenario}`;
    debug.periodWidth = scenario.periodWidth;
    debug.foldScenario = foldScenario;
    debug.ampDisplacement = scenario.ampDisplacement;
    debug.selectedRange = scenario.selectedRange;
    globalDebug.predictionReasons[window.windowIndex] = debug.predictionReason;
    globalDebug.periodWidthsByWindow[window.windowIndex] = scenario.periodWidth;
    globalDebug.foldScenariosByWindow[window.windowIndex] = foldScenario;
    globalDebug.ampDisplacementsByWindow[window.windowIndex] = scenario.ampDisplacement;
    return sampleRate / scenario.periodWidth;
  }

  globalDebug.predictionReasons[window.windowIndex] = debug.predictionReason;
  globalDebug.periodWidthsByWindow[window.windowIndex] = Number.NaN;
  globalDebug.foldScenariosByWindow[window.windowIndex] = Number.NaN;
  globalDebug.ampDisplacementsByWindow[window.windowIndex] = Number.NaN;
  return Number.NaN;
}
