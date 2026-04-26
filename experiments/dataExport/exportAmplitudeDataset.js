import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWavFile } from "../wavFileUtils.js";

const TIMESTEPS_PER_SECOND = 80;
const MIN_PITCH_HZ = 41.20344461410875;
const WINDOW_SIZE_EXTRA_SAMPLES = 400;
const TARGET_DECIMALS = 3;
const SAMPLE_DECIMALS = 5;
const MAX_SECONDS = null;
const INTERPOLATION_STEPS = 0;
const INTERPOLATION_SAMPLE_STEP = null;
const ESTIMATE_ONLY = false;
const OUTPUT_FILE_NAME = "vocal_sampler_long_amplitudes.csv";

function getWindowSize(sampleRate) {
  return Math.max(1, Math.ceil((2 / MIN_PITCH_HZ) * sampleRate) + WINDOW_SIZE_EXTRA_SAMPLES);
}

function getEndSampleAtIndex(timestepIndex, sampleRate) {
  return Math.round((timestepIndex / TIMESTEPS_PER_SECOND) * sampleRate);
}

function isFiniteHz(value) {
  return Number.isFinite(value) && value > 0;
}

function roundNumber(value, decimals) {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatRoundedNumber(value, decimals) {
  return String(roundNumber(value, decimals));
}

function buildHeader(windowSize) {
  const columns = ["target"];

  for (let index = 0; index < windowSize; index += 1) {
    columns.push(`sample_${index}`);
  }

  return `${columns.join(",")}\n`;
}

function buildCsvRow(samples, startSample, endSample, targetHz) {
  const values = [formatRoundedNumber(targetHz, TARGET_DECIMALS)];

  for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex += 1) {
    values.push(formatRoundedNumber(samples[sampleIndex], SAMPLE_DECIMALS));
  }

  return `${values.join(",")}\n`;
}

function collectSegments(
  actualPitchHz,
  sampleRate,
  windowSize,
  frameCount,
  maxSeconds,
  interpolationSteps,
  interpolationSampleStep,
) {
  const exportSampleLimit =
    maxSeconds === null ? frameCount : Math.min(frameCount, Math.floor(maxSeconds * sampleRate));
  const segments = [];
  let explicitRowCount = 0;
  let interpolatedRowCount = 0;
  let skippedEarlyExplicitCount = 0;
  let skippedLateExplicitCount = 0;

  for (let index = 0; index < actualPitchHz.length; index += 1) {
    const currentHz = actualPitchHz[index];
    if (!isFiniteHz(currentHz)) {
      continue;
    }

    const currentEndSample = getEndSampleAtIndex(index, sampleRate);
    if (currentEndSample >= windowSize && currentEndSample <= exportSampleLimit) {
      explicitRowCount += 1;
      segments.push({
        startSample: currentEndSample,
        endSample: currentEndSample,
        startHz: currentHz,
        endHz: currentHz,
        interpolated: false,
      });
    } else if (currentEndSample < windowSize) {
      skippedEarlyExplicitCount += 1;
    } else {
      skippedLateExplicitCount += 1;
    }

    const nextHz = actualPitchHz[index + 1];
    if (!isFiniteHz(nextHz)) {
      continue;
    }

    const nextEndSample = getEndSampleAtIndex(index + 1, sampleRate);
    if (interpolationSteps === 0) {
      continue;
    }

    const availableInteriorSamples = nextEndSample - currentEndSample - 1;
    if (availableInteriorSamples <= 0) {
      continue;
    }

    const requestedInterpolationSteps =
      interpolationSampleStep === null
        ? interpolationSteps
        : Math.max(0, Math.floor((nextEndSample - currentEndSample) / interpolationSampleStep) - 1);
    const boundedInterpolationSteps = Math.min(
      requestedInterpolationSteps,
      availableInteriorSamples,
    );

    if (boundedInterpolationSteps === 0) {
      continue;
    }

    for (let stepIndex = 1; stepIndex <= boundedInterpolationSteps; stepIndex += 1) {
      const alpha = stepIndex / (boundedInterpolationSteps + 1);
      const endSample = currentEndSample + Math.round((nextEndSample - currentEndSample) * alpha);

      if (endSample <= currentEndSample || endSample >= nextEndSample) {
        continue;
      }
      if (endSample < windowSize || endSample > exportSampleLimit) {
        continue;
      }

      interpolatedRowCount += 1;
      segments.push({
        startSample: endSample,
        endSample,
        startHz: currentHz,
        endHz: nextHz,
        leftAnchorSample: currentEndSample,
        rightAnchorSample: nextEndSample,
        interpolated: true,
      });
    }
  }

  return {
    exportSampleLimit,
    segments,
    explicitRowCount,
    interpolatedRowCount,
    rowCount: explicitRowCount + interpolatedRowCount,
    skippedEarlyExplicitCount,
    skippedLateExplicitCount,
  };
}

function getTargetHzForSample(segment, endSample) {
  if (!segment.interpolated) {
    return segment.startHz;
  }

  const alpha =
    (endSample - segment.leftAnchorSample) / (segment.rightAnchorSample - segment.leftAnchorSample);
  return segment.startHz + (segment.endHz - segment.startHz) * alpha;
}

async function writeDataset({ outputPath, wav, segments, windowSize }) {
  const stream = fs.createWriteStream(outputPath);
  let rowCount = 0;

  await new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.write(buildHeader(windowSize));

    for (const segment of segments) {
      for (let endSample = segment.startSample; endSample <= segment.endSample; endSample += 1) {
        const startSample = endSample - windowSize;
        const targetHz = getTargetHzForSample(segment, endSample);
        stream.write(buildCsvRow(wav.samples, startSample, endSample, targetHz));
        rowCount += 1;
      }
    }

    stream.end();
  });

  const fileSizeBytes = fs.statSync(outputPath).size;
  return {
    rowCount,
    fileSizeBytes,
    averageBytesPerRow:
      rowCount > 0 ? (fileSizeBytes - buildHeader(windowSize).length) / rowCount : 0,
  };
}

function formatBytes(bytes) {
  if (!(bytes > 0)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatCount(value) {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : "n/a";
}

async function main() {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const wavPath = path.resolve(thisDir, "../../.private/assets/vocal_sampler_long.wav");
  const actualPath = path.resolve(thisDir, "../../.private/assets/vocal_sampler_long_actual.json");
  const outputPath = path.resolve(thisDir, OUTPUT_FILE_NAME);

  const wav = loadWavFile(wavPath);
  const actualPitchHz = JSON.parse(fs.readFileSync(actualPath, "utf8"));
  const windowSize = getWindowSize(wav.sampleRate);
  const summary = collectSegments(
    actualPitchHz,
    wav.sampleRate,
    windowSize,
    wav.frameCount,
    MAX_SECONDS,
    INTERPOLATION_STEPS,
    INTERPOLATION_SAMPLE_STEP,
  );

  if (ESTIMATE_ONLY) {
    console.log(path.basename(outputPath));
    console.log(
      `estimate: ${formatCount(summary.rowCount)} rows (${formatCount(summary.explicitRowCount)} labelled, ${formatCount(summary.interpolatedRowCount)} interpolated)`,
    );
    return;
  }

  const writeResult = await writeDataset({
    outputPath,
    wav,
    segments: summary.segments,
    windowSize,
  });

  console.log(path.basename(outputPath));
  console.log(
    `wrote ${formatCount(writeResult.rowCount)} rows (${formatCount(summary.explicitRowCount)} labelled, ${formatCount(summary.interpolatedRowCount)} interpolated)`,
  );
  console.log(
    `size=${formatBytes(writeResult.fileSizeBytes)}  avg-row=${formatBytes(writeResult.averageBytesPerRow)}`,
  );
}

await main();
