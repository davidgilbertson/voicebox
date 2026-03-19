export const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
export const RECORD_DURATION_MS = 5000;
export const PICA_MIN_HZ = 40;
export const PICA_MAX_HZ = 2200;
export const PICA_MIN_WINDOW_MAX_AMPLITUDE = 0.01; // TODO (@davidgilbertson): doesn't do much in practice
export const PICA_ACCURACY_CENTS = 50;

export const USE_COSINE = true;
export const PICA_SETTINGS_DEFAULTS = {
  minAmp: PICA_MIN_WINDOW_MAX_AMPLITUDE,
  maxExtremaPerFold: 6,
  maxCrossingsPerPeriod: 20,
  maxComparisonPatches: 6,
  corrSamplePoints: 6,
  maxWalkSteps: 10,
  carryForwardCorrelationThreshold: 0.7,
  correlationToHzWeightRatio: 27,
};

// export const USE_COSINE = false;
// export const PICA_SETTINGS_DEFAULTS = {
//   maxExtremaPerFold: 2,
//   maxCrossingsPerPeriod: 18,
//   maxComparisonPatches: 3,
//   maxWalkSteps: 10,
//   carryForwardCorrelationThreshold: 3,
//   correlationToHzWeightRatio: 2.5,
// };

export const PICA_SETTING_FIELDS = [
  {
    key: "minAmp",
    label: "min amplitude",
    inputLabel: "minAmp",
    min: 0,
    max: 1,
    step: 0.01,
    title: "Minimum window or compared-region peak amplitude required before Pica accepts it.",
  },
  {
    key: "maxExtremaPerFold",
    label: "extrema-per-fold",
    inputLabel: "maxExtremaPerFold",
    min: 1,
    max: 8,
    step: 1,
    title: "How many same-sign extrema to keep from each fold.",
  },
  {
    key: "maxCrossingsPerPeriod",
    label: "crossings-per-period",
    inputLabel: "maxCrossingsPerPeriod",
    min: 2,
    max: 64,
    step: 2,
    title: "Maximum zero crossings to allow in one period when collecting recent folds.",
  },
  {
    key: "maxComparisonPatches",
    label: "max comparison patches",
    inputLabel: "maxPatches",
    min: 2,
    max: 16,
    step: 1,
    title:
      "Maximum number of trailing period-sized patches to compare when scoring a candidate period.",
  },
  {
    key: "corrSamplePoints",
    label: "corr sample points",
    inputLabel: "corrPts",
    min: 1,
    max: 128,
    step: 1,
    title: "Approximate number of sampled points per compared patch when computing correlation.",
  },
  {
    key: "maxWalkSteps",
    label: "max walk",
    inputLabel: "maxWalk",
    min: 0,
    max: 64,
    step: 2,
    title:
      "Maximum number of one-sample period adjustments to try when hill-climbing a candidate period.",
  },
  {
    key: "carryForwardCorrelationThreshold",
    label: "carry threshold",
    inputLabel: "carryThr",
    min: 0,
    max: 20,
    step: 0.1,
    title: "Minimum prior and walked correlation required before the carry-forward path can win.",
  },
  {
    key: "correlationToHzWeightRatio",
    label: "corr/hz ratio",
    inputLabel: "corrHzRatio",
    min: 0,
    max: 10,
    step: 0.2,
    title: "Correlation feature weight relative to the Hz feature weight of 1.",
  },
];
