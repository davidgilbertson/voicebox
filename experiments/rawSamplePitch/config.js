export const DEFAULT_ASSET_URL = "../../.private/assets/High ah gaps.wav";
export const RECORD_DURATION_MS = 5000;
export const RAW_MIN_HZ = 40;
export const RAW_MAX_HZ = 2200;
export const RAW_MIN_WINDOW_MAX_AMPLITUDE = 0.01;
export const RAW_ACCURACY_CENTS = 50;

export const RAW_SETTINGS_DEFAULTS = {
  maxExtremaPerFold: 5,
  maxCrossingsPerPeriod: 18, // Bigger is better, but slower
  maxComparisonPatches: 3,
  maxWalkSteps: 10,
  rawGlobalLogCorrelationCutoff: 0,
  octaveBias: 0.15,
  peakinessBias: 0,
};

export const RAW_SETTING_FIELDS = [
  { key: "maxExtremaPerFold", label: "extrema-per-fold" },
  { key: "maxCrossingsPerPeriod", label: "crossings-per-period" },
  { key: "maxComparisonPatches", label: "max comparison patches" },
  { key: "maxWalkSteps", label: "max walk" },
  { key: "rawGlobalLogCorrelationCutoff", label: "min log corr" },
  { key: "octaveBias", label: "octave bias" },
  { key: "peakinessBias", label: "peakiness bias" },
];
