import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PICA_SETTINGS_DEFAULTS } from "../pica/config.js";
import { getPicaWindowSize } from "../pica/windowing.js";
import { loadWavFile } from "../wavFileUtils.js";

const TIMESTEPS_PER_SECOND = 80;
const EXTREMA_THRESHOLD = 0.1;
const MAX_EXTREMA_COUNT = PICA_SETTINGS_DEFAULTS.maxCrossingsPerPeriod * 2;
const WAV_PATH = "../../.private/assets/vocal_sampler_long.wav";
const ACTUAL_JSON_PATH = "../../.private/assets/vocal_sampler_long_actual.json";
const INTERPOLATION_SAMPLE_STEP = 50;
const OUTPUT_CSV = "./vocal_sampler_long_features.csv";

function getScaledSamples(samples) {
  const scaledSamples = new Float32Array(samples.length);
  let maxAbs = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    scaledSamples[index] = sample;
    const absSample = Math.abs(sample);
    if (absSample > maxAbs) {
      maxAbs = absSample;
    }
  }

  if (!(maxAbs > 0)) {
    return scaledSamples;
  }

  for (let index = 0; index < scaledSamples.length; index += 1) {
    scaledSamples[index] /= maxAbs;
  }

  return scaledSamples;
}

function findFirstExtremum(samples) {
  if (samples.length === 0) {
    return null;
  }

  const lastIndex = samples.length - 1;
  const lastValue = samples[lastIndex];
  let peakIndex = samples.length - 1;
  let troughIndex = samples.length - 1;
  let peakValue = samples[peakIndex];
  let troughValue = samples[troughIndex];
  let peakWentUp = false;
  let troughWentDown = false;

  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const sample = samples[index];

    if (sample > peakValue) {
      peakValue = sample;
      peakIndex = index;
    }
    if (sample < troughValue) {
      troughValue = sample;
      troughIndex = index;
    }

    if (!peakWentUp && peakValue - lastValue >= EXTREMA_THRESHOLD) {
      peakWentUp = true;
    }
    if (!troughWentDown && lastValue - troughValue >= EXTREMA_THRESHOLD) {
      troughWentDown = true;
    }

    const peakLocked = peakWentUp && peakValue - sample >= EXTREMA_THRESHOLD;
    const troughLocked = troughWentDown && sample - troughValue >= EXTREMA_THRESHOLD;

    if (peakLocked && troughLocked) {
      return peakIndex > troughIndex
        ? { type: "peak", index: peakIndex, value: peakValue }
        : { type: "trough", index: troughIndex, value: troughValue };
    }
    if (peakLocked) {
      return { type: "peak", index: peakIndex, value: peakValue };
    }
    if (troughLocked) {
      return { type: "trough", index: troughIndex, value: troughValue };
    }
  }

  return null;
}

function findNextExtremum(samples, startIndex, type) {
  if (startIndex < 0) {
    return null;
  }

  let candidateIndex = startIndex;
  let candidateValue = samples[startIndex];

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const sample = samples[index];

    if (type === "peak") {
      if (sample > candidateValue) {
        candidateValue = sample;
        candidateIndex = index;
      }
      if (candidateValue - sample >= EXTREMA_THRESHOLD) {
        return { type, index: candidateIndex, value: candidateValue };
      }
      continue;
    }

    if (sample < candidateValue) {
      candidateValue = sample;
      candidateIndex = index;
    }
    if (sample - candidateValue >= EXTREMA_THRESHOLD) {
      return { type, index: candidateIndex, value: candidateValue };
    }
  }

  return null;
}

function getExtremaFromWindow(samples, startSample, endSample) {
  const scaledSamples = getScaledSamples(samples);
  const extrema = [];

  const firstExtremum = findFirstExtremum(scaledSamples);
  if (firstExtremum === null) {
    return extrema;
  }

  extrema.push({
    type: firstExtremum.type,
    samplesAgo: endSample - 1 - (startSample + firstExtremum.index),
    amplitude: firstExtremum.value,
  });

  let nextType = firstExtremum.type === "peak" ? "trough" : "peak";
  let searchStartIndex = firstExtremum.index - 1;

  while (searchStartIndex >= 0) {
    if (extrema.length >= MAX_EXTREMA_COUNT) {
      break;
    }

    const extremum = findNextExtremum(scaledSamples, searchStartIndex, nextType);
    if (extremum === null) {
      break;
    }

    extrema.push({
      type: extremum.type,
      samplesAgo: endSample - 1 - (startSample + extremum.index),
      amplitude: extremum.value,
    });
    nextType = nextType === "peak" ? "trough" : "peak";
    searchStartIndex = extremum.index - 1;
  }

  return extrema;
}

function getCsvValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string" && /[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return String(value);
}

function isFiniteHz(value) {
  return Number.isFinite(value) && value > 0;
}

function getTargetPeriod(actualHz, sampleRate) {
  return isFiniteHz(actualHz) ? sampleRate / actualHz : null;
}

function getEndSampleAtIndex(timestepIndex, sampleRate) {
  return Math.round((timestepIndex / TIMESTEPS_PER_SECOND) * sampleRate);
}

function buildRow(wav, endSample, targetHz) {
  const windowSize = getPicaWindowSize(wav.sampleRate);
  const startSample = endSample - windowSize;
  if (startSample < 0 || !isFiniteHz(targetHz)) {
    return null;
  }

  const windowSamples = wav.samples.subarray(startSample, endSample);
  const extrema = getExtremaFromWindow(windowSamples, startSample, endSample);
  const peaks = [];
  const troughs = [];

  for (const type of ["peak", "trough"]) {
    const typedExtrema = extrema.filter((extremum) => extremum.type === type);
    for (let index = 0; index < typedExtrema.length - 1; index += 1) {
      const current = typedExtrema[index];
      const previousSameSign = typedExtrema[index + 1];
      const point = {
        x: previousSameSign.samplesAgo - current.samplesAgo,
        y: current.amplitude,
      };

      if (type === "peak") {
        peaks.push(point);
      } else {
        troughs.push(point);
      }
    }
  }

  return {
    target: getTargetPeriod(targetHz, wav.sampleRate),
    peaks,
    troughs,
  };
}

function getSaturationSummary(rows, maxPeakCount, maxTroughCount) {
  const rowsWithTarget = rows.filter((row) => Number.isFinite(row.target));
  const peakCoverageCounts = new Array(maxPeakCount).fill(0);
  const troughCoverageCounts = new Array(maxTroughCount).fill(0);

  for (const row of rowsWithTarget) {
    for (let pointIndex = 0; pointIndex < maxPeakCount; pointIndex += 1) {
      if (row.peaks[pointIndex] !== undefined) {
        peakCoverageCounts[pointIndex] += 1;
      }
    }
    for (let pointIndex = 0; pointIndex < maxTroughCount; pointIndex += 1) {
      if (row.troughs[pointIndex] !== undefined) {
        troughCoverageCounts[pointIndex] += 1;
      }
    }
  }

  const densePeakCount = peakCoverageCounts.findIndex((count) => count !== rowsWithTarget.length);
  const denseTroughCount = troughCoverageCounts.findIndex(
    (count) => count !== rowsWithTarget.length,
  );

  return {
    densePeakCount: densePeakCount === -1 ? maxPeakCount : densePeakCount,
    denseTroughCount: denseTroughCount === -1 ? maxTroughCount : denseTroughCount,
  };
}

function main() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const wavPath = path.resolve(thisDir, WAV_PATH);
  const actualPath = path.resolve(thisDir, ACTUAL_JSON_PATH);
  const outputPath = path.resolve(thisDir, OUTPUT_CSV);

  const wav = loadWavFile(wavPath);
  const actualPitchHz = JSON.parse(fs.readFileSync(actualPath, "utf8"));
  const rows = [];
  let maxPeakCount = 0;
  let maxTroughCount = 0;
  let interpolatedRowCount = 0;

  for (let timestepIndex = 0; timestepIndex < actualPitchHz.length; timestepIndex += 1) {
    const currentHz = actualPitchHz[timestepIndex];
    const currentEndSample = getEndSampleAtIndex(timestepIndex, wav.sampleRate);
    const explicitRow = buildRow(wav, currentEndSample, currentHz);

    if (explicitRow) {
      maxPeakCount = Math.max(maxPeakCount, explicitRow.peaks.length);
      maxTroughCount = Math.max(maxTroughCount, explicitRow.troughs.length);
      rows.push(explicitRow);
    }

    const nextHz = actualPitchHz[timestepIndex + 1];
    if (!isFiniteHz(currentHz) || !isFiniteHz(nextHz)) {
      continue;
    }

    const nextEndSample = getEndSampleAtIndex(timestepIndex + 1, wav.sampleRate);
    const interpolationCount = Math.max(
      0,
      Math.floor((nextEndSample - currentEndSample) / INTERPOLATION_SAMPLE_STEP) - 1,
    );

    for (
      let interpolationIndex = 1;
      interpolationIndex <= interpolationCount;
      interpolationIndex += 1
    ) {
      const alpha = interpolationIndex / (interpolationCount + 1);
      const interpolatedEndSample =
        currentEndSample + Math.round((nextEndSample - currentEndSample) * alpha);
      const interpolatedHz = currentHz + (nextHz - currentHz) * alpha;
      const interpolatedRow = buildRow(wav, interpolatedEndSample, interpolatedHz);

      if (!interpolatedRow) {
        continue;
      }

      maxPeakCount = Math.max(maxPeakCount, interpolatedRow.peaks.length);
      maxTroughCount = Math.max(maxTroughCount, interpolatedRow.troughs.length);
      rows.push(interpolatedRow);
      interpolatedRowCount += 1;
    }
  }

  const saturationSummary = getSaturationSummary(rows, maxPeakCount, maxTroughCount);
  const header = [];
  for (let pointIndex = 0; pointIndex < saturationSummary.densePeakCount; pointIndex += 1) {
    header.push(`P${pointIndex + 1}x`, `P${pointIndex + 1}y`);
  }
  for (let pointIndex = 0; pointIndex < saturationSummary.denseTroughCount; pointIndex += 1) {
    header.push(`T${pointIndex + 1}x`, `T${pointIndex + 1}y`);
  }
  header.push("Target");

  const csvLines = [header.join(",")];
  for (const row of rows) {
    const values = [];

    for (let pointIndex = 0; pointIndex < saturationSummary.densePeakCount; pointIndex += 1) {
      values.push(row.peaks[pointIndex]?.x, row.peaks[pointIndex]?.y);
    }
    for (let pointIndex = 0; pointIndex < saturationSummary.denseTroughCount; pointIndex += 1) {
      values.push(row.troughs[pointIndex]?.x, row.troughs[pointIndex]?.y);
    }
    values.push(row.target);

    csvLines.push(values.map(getCsvValue).join(","));
  }

  fs.writeFileSync(outputPath, `${csvLines.join("\n")}\n`);

  console.log(path.basename(outputPath));
  console.log(
    `rows=${rows.length}  interpolated=${interpolatedRowCount}  dense-peaks=${saturationSummary.densePeakCount}  dense-troughs=${saturationSummary.denseTroughCount}`,
  );
}

main();
