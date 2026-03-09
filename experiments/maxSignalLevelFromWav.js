import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let offset = 12;
  let formatTag = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const nextOffset = chunkDataStart + chunkSize + (chunkSize % 2);

    if (chunkId === "fmt ") {
      formatTag = buffer.readUInt16LE(chunkDataStart + 0);
      channels = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
    }

    offset = nextOffset;
  }

  if (
    formatTag === null ||
    channels === null ||
    sampleRate === null ||
    bitsPerSample === null ||
    dataOffset === null ||
    dataSize === null
  ) {
    throw new Error("Missing required WAV chunks");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(frameCount);

  if (formatTag === 1 && bitsPerSample === 16) {
    for (let i = 0; i < frameCount; i += 1) {
      const frameStart = dataOffset + (i * frameSize);
      const sampleInt16 = buffer.readInt16LE(frameStart);
      samples[i] = sampleInt16 / 32768;
    }
  } else if (formatTag === 3 && bitsPerSample === 32) {
    for (let i = 0; i < frameCount; i += 1) {
      const frameStart = dataOffset + (i * frameSize);
      samples[i] = buffer.readFloatLE(frameStart);
    }
  } else {
    throw new Error(`Unsupported WAV format. formatTag=${formatTag}, bitsPerSample=${bitsPerSample}`);
  }

  return {sampleRate, channels, bitsPerSample, frameCount, samples};
}

function maxSignalLevelWithWorkletMath(samples, batchSize) {
  let pendingSampleCount = 0;
  let pendingSumSquares = 0;
  let maxSignalLevel = 0;
  let batchCount = 0;
  const batchSignalLevels = [];

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    pendingSumSquares += sample * sample;
    pendingSampleCount += 1;
    if (pendingSampleCount >= batchSize) {
      const signalLevel = Math.sqrt(pendingSumSquares / pendingSampleCount);
      batchSignalLevels.push(signalLevel);
      if (signalLevel > maxSignalLevel) {
        maxSignalLevel = signalLevel;
      }
      batchCount += 1;
      pendingSampleCount = 0;
      pendingSumSquares = 0;
    }
  }

  return {maxSignalLevel, batchCount, batchSignalLevels};
}

function percentile(values, p) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function generateVoiceLikeSignal({
  sampleRate,
  durationSeconds,
  fundamentalHz,
  harmonics,
}) {
  const length = Math.floor(sampleRate * durationSeconds);
  const samples = new Float32Array(length);

  // Simple "voice-like" harmonic roll-off with fixed phases.
  const phases = new Array(harmonics);
  for (let n = 1; n <= harmonics; n += 1) {
    phases[n - 1] = (n * 0.73) % (Math.PI * 2);
  }

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    let value = 0;
    for (let n = 1; n <= harmonics; n += 1) {
      const amplitude = 1 / (n ** 1.3);
      value += amplitude * Math.sin((2 * Math.PI * fundamentalHz * n * t) + phases[n - 1]);
    }
    samples[i] = value;
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > 0) {
    const invPeak = 1 / peak;
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] *= invPeak;
    }
  }

  return samples;
}

function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const wavPath = path.resolve(thisDir, "assets", "High ah gaps.wav");
  const buffer = fs.readFileSync(wavPath);
  const wav = parseWav(buffer);
  const batchSize = Math.round(wav.sampleRate / 80);
  const {maxSignalLevel, batchCount, batchSignalLevels} = maxSignalLevelWithWorkletMath(wav.samples, batchSize);
  const nearMaxThreshold = maxSignalLevel * 0.95;
  let nearMaxCount = 0;
  for (const level of batchSignalLevels) {
    if (level >= nearMaxThreshold) nearMaxCount += 1;
  }
  const nearMaxPct = batchSignalLevels.length > 0 ? (nearMaxCount / batchSignalLevels.length) * 100 : 0;
  const thresholdForTop10Pct = percentile(batchSignalLevels, 90);

  const syntheticSamples = generateVoiceLikeSignal({
    sampleRate: wav.sampleRate,
    durationSeconds: 8,
    fundamentalHz: 220,
    harmonics: 20,
  });
  const syntheticResult = maxSignalLevelWithWorkletMath(syntheticSamples, batchSize);

  console.log({
    wavPath,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    frameCount: wav.frameCount,
    batchSize,
    batchCount,
    maxSignalLevel,
    nearMaxThreshold,
    nearMaxCount,
    nearMaxPct,
    thresholdForTop10Pct,
    syntheticVoiceLike: {
      sampleRate: wav.sampleRate,
      durationSeconds: 8,
      fundamentalHz: 220,
      harmonics: 20,
      maxSignalLevel: syntheticResult.maxSignalLevel,
      nearMaxThreshold95PctOfMax: syntheticResult.maxSignalLevel * 0.95,
      thresholdForTop10Pct: percentile(syntheticResult.batchSignalLevels, 90),
    },
  });
}

main();
