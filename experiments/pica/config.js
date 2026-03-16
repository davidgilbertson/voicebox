export const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
export const RECORD_DURATION_MS = 5000;
export const PICA_MIN_HZ = 40;
export const PICA_MAX_HZ = 2200;
export const PICA_MIN_WINDOW_MAX_AMPLITUDE = 0.01; // TODO (@davidgilbertson): doesn't do much in practice
export const PICA_ACCURACY_CENTS = 50;

export const PICA_SETTINGS_DEFAULTS = {
  maxExtremaPerFold: 5,
  maxCrossingsPerPeriod: 18, // Bigger is better, but slower
  maxComparisonPatches: 3,
  maxWalkSteps: 10,
  carryForwardLogCorrelationThreshold: 1.2,
  picaGlobalLogCorrelationCutoff: 0,
  hzWeight: 0.65,
  correlationWeight: 1.2,
  normalizeHz: true,
  normalizeCorrelation: true,
};

export const PICA_SETTING_FIELDS = [
  { key: "maxExtremaPerFold", label: "extrema-per-fold" },
  { key: "maxCrossingsPerPeriod", label: "crossings-per-period" },
  { key: "maxComparisonPatches", label: "max comparison patches" },
  { key: "maxWalkSteps", label: "max walk" },
  { key: "carryForwardLogCorrelationThreshold", label: "carry threshold" },
  { key: "picaGlobalLogCorrelationCutoff", label: "min log corr" },
  { key: "hzWeight", label: "hz weight" },
  { key: "correlationWeight", label: "corr weight" },
];

export const PICA_TOGGLE_FIELDS = [
  { key: "normalizeHz", label: "norm hz" },
  { key: "normalizeCorrelation", label: "norm corr" },
];
