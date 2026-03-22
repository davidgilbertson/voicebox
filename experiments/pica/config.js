export const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
export const RECORD_DURATION_MS = 5000;
export const PICA_MIN_HZ = 40;
export const PICA_MAX_HZ = 2200;
export const PICA_MIN_WINDOW_MAX_AMPLITUDE = 0.01; // TODO (@davidgilbertson): doesn't do much in practice
export const PICA_ACCURACY_CENTS = 50;

export const SIMILARITY_FUNC = "cosine";
export const PICA_SETTINGS_DEFAULTS = {
  minAmp: PICA_MIN_WINDOW_MAX_AMPLITUDE,
  minCorr: 0.83,
  minCarryCorr: 0.5,
  maxCrossingsPerPeriod: 23,
  maxComparisonPatches: 3,
  corrSamplePoints: 18,
  maxWalkSteps: 60,
  maxCarryRun: 10,
  correlationToHzWeightRatio: 250,
};

// export const SIMILARITY_FUNC = "scaledDot";
// export const PICA_SETTINGS_DEFAULTS = {
//   maxCrossingsPerPeriod: 18,
//   maxComparisonPatches: 3,
//   maxWalkSteps: 10,
//   minCarryCorr: 3,
//   correlationToHzWeightRatio: 2.5,
// };

// export const SIMILARITY_FUNC = "mae";
// export const PICA_SETTINGS_DEFAULTS = {
//   maxCrossingsPerPeriod: 18,
//   maxComparisonPatches: 3,
//   maxWalkSteps: 10,
//   minCarryCorr: 3,
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
    key: "minCorr",
    label: "min correlation",
    inputLabel: "minCorr",
    min: 0,
    max: 1,
    step: 0.01,
    title: "Minimum winning-candidate correlation required before Pica accepts it.",
  },
  {
    key: "minCarryCorr",
    label: "min carry correlation",
    inputLabel: "minCarryCorr",
    min: 0,
    max: 1,
    step: 0.1,
    title: "Minimum prior and walked correlation required before the carry-forward path can win.",
  },
  {
    key: "maxCrossingsPerPeriod",
    label: "crossings-per-period",
    inputLabel: "maxCrossingsPerPeriod",
    min: 1,
    step: 2,
    title: "Maximum zero crossings to allow in one period when collecting recent folds.",
  },
  {
    key: "maxComparisonPatches",
    label: "max comparison patches",
    inputLabel: "maxPatches",
    min: 2,
    step: 1,
    title:
      "Maximum number of trailing period-sized patches to compare when scoring a candidate period.",
  },
  {
    key: "corrSamplePoints",
    label: "corr sample points",
    inputLabel: "corrPts",
    min: 1,
    step: 1,
    title: "Approximate number of sampled points per compared patch when computing correlation.",
  },
  {
    key: "maxWalkSteps",
    label: "max walk",
    inputLabel: "maxWalk",
    min: 0,
    step: 2,
    title:
      "Maximum number of one-sample period adjustments to try when hill-climbing a candidate period.",
  },
  {
    key: "maxCarryRun",
    label: "max carry run",
    inputLabel: "maxCarryRun",
    min: 0,
    step: 1,
    title:
      "Maximum number of consecutive carry-forward windows before Pica forces a fresh extrema search.",
  },
  {
    key: "correlationToHzWeightRatio",
    label: "corr/hz ratio",
    inputLabel: "corrHzRatio",
    min: 0,
    step: 0.2,
    title: "Correlation feature weight relative to the Hz feature weight of 1.",
  },
];
