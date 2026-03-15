import { RAW_MIN_HZ } from "./config.js";

const MAX_LOG_CORRELATION = 0.999999;

export function getLogCorrelation(correlation) {
  if (correlation <= 0 || !Number.isFinite(correlation)) return 0;
  return -Math.log10(1 - Math.min(correlation, MAX_LOG_CORRELATION));
}

export function getCentsDifference(aHz, bHz) {
  if (!(aHz > 0) || !(bHz > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs(1200 * Math.log2(aHz / bHz));
}

export function getMaxAbsoluteAmplitude(samples) {
  let max = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    if (absolute > max) max = absolute;
  }
  return max;
}

export function hasZeroCrossing(a, b) {
  return a === 0 || b === 0 || (a < 0 && b > 0) || (a > 0 && b < 0);
}

export function countZeroCrossings(samples) {
  let count = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (hasZeroCrossing(samples[index - 1], samples[index])) {
      count += 1;
    }
  }
  return count;
}

export function getCandidateWeightedScore(
  candidateHz,
  correlation,
  octaveBias,
  peakiness = 0,
  peakinessBias = 0,
) {
  return (
    getLogCorrelation(correlation) +
    octaveBias * Math.log2(candidateHz / RAW_MIN_HZ) +
    peakinessBias * peakiness
  );
}
