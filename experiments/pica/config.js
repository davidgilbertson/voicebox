export const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
export const RECORD_DURATION_MS = 5000;
export const PICA_MIN_HZ = 40;
export const PICA_MAX_HZ = 2200;
export const PICA_MIN_WINDOW_MAX_AMPLITUDE = 0.01; // TODO (@davidgilbertson): doesn't do much in practice
export const PICA_ACCURACY_CENTS = 50;

export const PICA_SETTINGS_DEFAULTS = {
  maxExtremaPerFold: 2,
  maxCrossingsPerPeriod: 18, // Bigger is better, but slower
  maxComparisonPatches: 7,
  maxWalkSteps: 10,
  carryForwardCorrelationThreshold: 3,
  correlationToHzWeightRatio: 0.5,
};

export const PICA_SETTING_FIELDS = [
  { key: "maxExtremaPerFold", label: "extrema-per-fold" },
  { key: "maxCrossingsPerPeriod", label: "crossings-per-period" },
  { key: "maxComparisonPatches", label: "max comparison patches" },
  { key: "maxWalkSteps", label: "max walk" },
  { key: "carryForwardCorrelationThreshold", label: "carry threshold" },
  { key: "correlationToHzWeightRatio", label: "corr/hz ratio" },
];
