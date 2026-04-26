import { getWalkedPitchHz } from "./picaPitch.js";

const ACTUAL_SOURCE_CONFIGS = [
  {
    fileName: "vocal_sampler.wav",
    actualFileName: "vocal_sampler_actual.json",
    storageKey: "vb.exp.actualPitchVocalSampler",
  },
  {
    fileName: "vocal_sampler_long.wav",
    actualFileName: "vocal_sampler_long_actual.json",
    storageKey: "vb.exp.actualPitchVocalSamplerLong",
  },
];

export const ACTUAL_LABEL_STORAGE_KEYS = {
  vocalSampler: "vb.exp.actualPitchVocalSampler",
  vocalSamplerLong: "vb.exp.actualPitchVocalSamplerLong",
};

function getActualSourceConfigByAudioInput(audioInput) {
  if (typeof audioInput !== "string") return null;
  return ACTUAL_SOURCE_CONFIGS.find((config) => audioInput.endsWith(config.fileName)) ?? null;
}

function getActualSourceConfigBySourceKey(sourceKey) {
  if (typeof sourceKey !== "string") return null;
  return ACTUAL_SOURCE_CONFIGS.find((config) => sourceKey.endsWith(config.fileName)) ?? null;
}

export function readStoredActualLabels(storageKey) {
  if (typeof storageKey !== "string" || storageKey.length === 0) {
    return {};
  }
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function writeLabels(storageKey, labels) {
  localStorage.setItem(storageKey, JSON.stringify(labels));
}

function getActualPitchUrl(audioInput) {
  const config = getActualSourceConfigByAudioInput(audioInput);
  return config ? audioInput.slice(0, -config.fileName.length) + config.actualFileName : null;
}

async function loadActualPitchHz(audioInput) {
  const actualPitchUrl = getActualPitchUrl(audioInput);
  if (!actualPitchUrl) return null;

  const response = await fetch(actualPitchUrl);
  return await response.json();
}

function normalizeActualPitchHzLength(actualPitchHz, targetLength) {
  if (!Array.isArray(actualPitchHz) || actualPitchHz.length === targetLength) {
    return actualPitchHz;
  }
  if (actualPitchHz.length > targetLength) {
    return actualPitchHz.slice(0, targetLength);
  }
  return actualPitchHz.concat(new Array(targetLength - actualPitchHz.length).fill(null));
}

function applyStoredActualLabels(actualPitchHz, storageKey, targetLength = null) {
  const labels = readStoredActualLabels(storageKey);
  const labelIndexes = Object.keys(labels)
    .map((key) => Number.parseInt(key, 10))
    .filter((index) => Number.isInteger(index) && index >= 0);
  const mergedLength =
    targetLength ??
    Math.max(
      Array.isArray(actualPitchHz) ? actualPitchHz.length : 0,
      labelIndexes.length > 0 ? Math.max(...labelIndexes) + 1 : 0,
    );

  if (mergedLength === 0 && !Array.isArray(actualPitchHz)) {
    return actualPitchHz;
  }

  const merged = Array.isArray(actualPitchHz)
    ? actualPitchHz.slice(0, mergedLength)
    : new Array(mergedLength).fill(null);
  if (merged.length < mergedLength) {
    merged.push(...new Array(mergedLength - merged.length).fill(null));
  }
  for (const index of labelIndexes) {
    if (index >= mergedLength) continue;
    merged[index] = labels[index];
  }
  return merged;
}

export async function getActualPitchData(audioInput, targetLength = null) {
  const storageKey = getActualSourceConfigByAudioInput(audioInput)?.storageKey ?? "";
  const loadedActualPitchHz = await loadActualPitchHz(audioInput);
  const baseActualPitchHz =
    targetLength === null
      ? loadedActualPitchHz
      : normalizeActualPitchHzLength(loadedActualPitchHz, targetLength);
  return {
    baseActualPitchHz: Array.isArray(baseActualPitchHz)
      ? [...baseActualPitchHz]
      : baseActualPitchHz,
    actualPitchHz: applyStoredActualLabels(baseActualPitchHz, storageKey, targetLength),
  };
}

export function createActualLabelEditor(sourceKey, result, getWaveformWindow) {
  const storageKey = getActualSourceConfigBySourceKey(sourceKey)?.storageKey ?? "";
  const labels = readStoredActualLabels(storageKey);
  const baseActualPitchHz = Array.isArray(result.baseActualPitchHz)
    ? result.baseActualPitchHz
    : null;

  function applyLabelToResult(windowIndex) {
    if (
      !Array.isArray(result.actualPitchHz) ||
      windowIndex < 0 ||
      windowIndex >= result.actualPitchHz.length
    ) {
      return;
    }
    result.actualPitchHz[windowIndex] = hasLabel(windowIndex)
      ? labels[windowIndex]
      : (baseActualPitchHz?.[windowIndex] ?? null);
  }

  function save() {
    if (!storageKey) return;
    writeLabels(storageKey, labels);
  }

  function hasLabel(windowIndex) {
    return Object.hasOwn(labels, String(windowIndex));
  }

  function getLabel(windowIndex) {
    return labels[windowIndex];
  }

  function hasStoredLabel(windowIndex) {
    return hasLabel(windowIndex);
  }

  function setLabel(windowIndex, hz) {
    labels[windowIndex] = hz;
    applyLabelToResult(windowIndex);
    save();
  }

  function clearLabel(windowIndex) {
    delete labels[windowIndex];
    applyLabelToResult(windowIndex);
    save();
  }

  function getLabelCount() {
    return Object.keys(labels).length;
  }

  function getSeries() {
    return result.timeSec.map((_, index) => (hasLabel(index) ? getLabel(index) : Number.NaN));
  }

  function autoFixFromFft() {
    for (const key of Object.keys(labels)) {
      delete labels[key];
    }
    for (let windowIndex = 0; windowIndex < result.timeSec.length; windowIndex += 1) {
      const fftPitchHz = result.pitchHz[windowIndex];
      if (fftPitchHz !== fftPitchHz) continue;

      const waveformWindow = getWaveformWindow(windowIndex);
      const walkedPitchHz = getWalkedPitchHz(
        waveformWindow.samples,
        waveformWindow.sampleRate,
        fftPitchHz,
        {
          ...result.settings,
          maxWalkSteps: Number.POSITIVE_INFINITY,
        },
      );
      labels[windowIndex] = walkedPitchHz === walkedPitchHz ? walkedPitchHz : null;
      applyLabelToResult(windowIndex);
    }

    save();
  }

  function copyLabel(activeWindowIndex, direction, maxWindowIndex) {
    const nextWindowIndex = Math.max(0, Math.min(maxWindowIndex, activeWindowIndex + direction));
    const seedPitchHz = hasLabel(activeWindowIndex)
      ? getLabel(activeWindowIndex)
      : result.pitchHz[activeWindowIndex] === result.pitchHz[activeWindowIndex]
        ? result.pitchHz[activeWindowIndex]
        : result.picaPitchHz[activeWindowIndex];

    if (seedPitchHz === null || seedPitchHz !== seedPitchHz) {
      setLabel(nextWindowIndex, null);
      return nextWindowIndex;
    }

    const waveformWindow = getWaveformWindow(nextWindowIndex);
    const walkedPitchHz = getWalkedPitchHz(
      waveformWindow.samples,
      waveformWindow.sampleRate,
      seedPitchHz,
      {
        ...result.settings,
        maxWalkSteps: Number.POSITIVE_INFINITY,
      },
    );
    setLabel(nextWindowIndex, walkedPitchHz === walkedPitchHz ? walkedPitchHz : null);
    return nextWindowIndex;
  }

  function handleKey(key, activeWindowIndex, maxWindowIndex) {
    switch (key.toLowerCase()) {
      case "a":
        return Math.max(0, activeWindowIndex - 1);
      case "d":
        return Math.min(maxWindowIndex, activeWindowIndex + 1);
      case "q":
        return copyLabel(activeWindowIndex, -1, maxWindowIndex);
      case "e":
        return copyLabel(activeWindowIndex, 1, maxWindowIndex);
      case "w":
        setLabel(activeWindowIndex, null);
        return Math.min(maxWindowIndex, activeWindowIndex + 1);
      case "s":
        clearLabel(activeWindowIndex);
        return Math.min(maxWindowIndex, activeWindowIndex + 1);
      default:
        return activeWindowIndex;
    }
  }

  return {
    getLabel,
    getLabelCount,
    getSeries,
    hasStoredLabel,
    autoFixFromFft,
    setLabel,
    handleKey,
  };
}
