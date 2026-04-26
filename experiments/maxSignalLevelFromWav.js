import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWavFile } from "./wavFileUtils.js";

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

  return { maxSignalLevel, batchCount, batchSignalLevels };
}

function percentile(values, p) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function generateVoiceLikeSignal({ sampleRate, durationSeconds, fundamentalHz, harmonics }) {
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
      const amplitude = 1 / n ** 1.3;
      value += amplitude * Math.sin(2 * Math.PI * fundamentalHz * n * t + phases[n - 1]);
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
  const wav = loadWavFile(wavPath);
  const batchSize = Math.round(wav.sampleRate / 80);
  const { maxSignalLevel, batchCount, batchSignalLevels } = maxSignalLevelWithWorkletMath(
    wav.samples,
    batchSize,
  );
  const nearMaxThreshold = maxSignalLevel * 0.95;
  let nearMaxCount = 0;
  for (const level of batchSignalLevels) {
    if (level >= nearMaxThreshold) nearMaxCount += 1;
  }
  const nearMaxPct =
    batchSignalLevels.length > 0 ? (nearMaxCount / batchSignalLevels.length) * 100 : 0;
  const thresholdForTop10Pct = percentile(batchSignalLevels, 90);

  const syntheticSamples = generateVoiceLikeSignal({
    sampleRate: wav.sampleRate,
    durationSeconds: 8,
    fundamentalHz: 220,
    harmonics: 20,
  });
  const syntheticResult = maxSignalLevelWithWorkletMath(syntheticSamples, batchSize);

  console.log(path.basename(wavPath));
  console.log(
    `max=${formatNumber(maxSignalLevel)}  p90=${formatNumber(thresholdForTop10Pct)}  near-max=${nearMaxCount}/${batchCount} (${formatNumber(nearMaxPct, 1)}%)`,
  );
  console.log(
    `synthetic: max=${formatNumber(syntheticResult.maxSignalLevel)}  p90=${formatNumber(percentile(syntheticResult.batchSignalLevels, 90))}`,
  );
}

main();
