import { getWalkedPitchHz } from "./analysis.js";

const STORAGE_KEY = "voicebox.rawSamplePitch.actualPitchVocalSampler";

function readLabels() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
}

function writeLabels(labels) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}

export function createActualLabelEditor(sourceKey, result, getWaveformWindow) {
  const labels = readLabels();

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
          ...result.rawSettings,
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
        : result.rawPitchHz[activeWindowIndex];

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
        ...result.rawSettings,
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
