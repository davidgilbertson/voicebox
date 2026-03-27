import { getWalkedPitchHz } from "./picaPitch.js";

const STORAGE_KEY = "voicebox.picaPitch.actualPitchVocalSampler";
const VOCAL_SAMPLER_FILE_NAME = "vocal_sampler.wav";
const VOCAL_SAMPLER_ACTUAL_FILE_NAME = "vocal_sampler_actual.json";

export function readStoredActualLabels() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function writeLabels(labels) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}

function getActualPitchUrl(audioInput) {
  if (typeof audioInput !== "string" || !audioInput.endsWith(VOCAL_SAMPLER_FILE_NAME)) {
    return null;
  }
  return audioInput.slice(0, -VOCAL_SAMPLER_FILE_NAME.length) + VOCAL_SAMPLER_ACTUAL_FILE_NAME;
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

function applyStoredActualLabels(actualPitchHz, targetLength = null) {
  const labels = readStoredActualLabels();
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

export async function getActualPitchHz(audioInput, targetLength = null) {
  const actualPitchHz = await loadActualPitchHz(audioInput);
  return applyStoredActualLabels(
    targetLength === null
      ? actualPitchHz
      : normalizeActualPitchHzLength(actualPitchHz, targetLength),
    targetLength,
  );
}

export function createActualLabelEditor(sourceKey, result, getWaveformWindow) {
  const labels = readStoredActualLabels();

  function save() {
    writeLabels(labels);
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
    save();
  }

  function clearLabel(windowIndex) {
    delete labels[windowIndex];
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
