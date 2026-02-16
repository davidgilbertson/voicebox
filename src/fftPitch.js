import {clamp} from "./tools.js";

const RMS_MIN = 0.01;

const planCache = new Map();
const scratchCache = new Map();

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function reverseBits(value, bits) {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | ((value >> i) & 1);
  }
  return reversed;
}

function getPlan(size) {
  const cached = planCache.get(size);
  if (cached) return cached;

  const bits = Math.log2(size);
  const bitReverse = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    bitReverse[i] = reverseBits(i, bits);
  }

  const twiddleCos = new Float64Array(size / 2);
  const twiddleSin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i += 1) {
    const angle = (-2 * Math.PI * i) / size;
    twiddleCos[i] = Math.cos(angle);
    twiddleSin[i] = Math.sin(angle);
  }

  const plan = {bitReverse, twiddleCos, twiddleSin};
  planCache.set(size, plan);
  return plan;
}

function getScratch(size) {
  const cached = scratchCache.get(size);
  if (cached) return cached;

  const scratch = {
    windowed: new Float64Array(size),
    real: new Float64Array(size),
    imag: new Float64Array(size),
    magnitudes: new Float64Array((size / 2) + 1),
  };
  scratchCache.set(size, scratch);
  return scratch;
}

function applyHannWindow(input, output) {
  output.fill(0);
  const length = input.length;
  const denom = Math.max(1, length - 1);
  for (let i = 0; i < length; i += 1) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    output[i] = input[i] * hann;
  }
}

function runFftInPlace(real, imag, twiddleCos, twiddleSin) {
  const size = real.length;

  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1;
    const step = size / len;
    for (let start = 0; start < size; start += len) {
      for (let i = 0; i < half; i += 1) {
        const twiddleIndex = i * step;
        const wr = twiddleCos[twiddleIndex];
        const wi = twiddleSin[twiddleIndex];

        const evenIndex = start + i;
        const oddIndex = evenIndex + half;

        const oddReal = real[oddIndex];
        const oddImag = imag[oddIndex];

        const tReal = (oddReal * wr) - (oddImag * wi);
        const tImag = (oddReal * wi) + (oddImag * wr);

        const evenReal = real[evenIndex];
        const evenImag = imag[evenIndex];

        real[evenIndex] = evenReal + tReal;
        imag[evenIndex] = evenImag + tImag;
        real[oddIndex] = evenReal - tReal;
        imag[oddIndex] = evenImag - tImag;
      }
    }
  }
}

function computeRms(data) {
  let sumSquares = 0;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / data.length);
}

function resolveFftSize(dataLength, options = {}) {
  const requestedBinCount = Number(options.binCount);
  const requestedFftSize = Number(options.fftSize);
  const fftSize = Number.isFinite(requestedBinCount) && requestedBinCount > 0
      ? Math.floor(requestedBinCount) * 2
      : Number.isFinite(requestedFftSize) && requestedFftSize > 0
          ? Math.floor(requestedFftSize)
          : dataLength;
  if (!isPowerOfTwo(fftSize)) return 0;
  if (fftSize < dataLength) return 0;
  return fftSize;
}

function findRefinedPeakBin(magnitudes, bestBin, minBin, maxBin) {
  let refinedBin = bestBin;
  if (bestBin > minBin && bestBin < maxBin) {
    const left = magnitudes[bestBin - 1];
    const mid = magnitudes[bestBin];
    const right = magnitudes[bestBin + 1];
    const denom = left - (2 * mid) + right;
    if (denom !== 0) {
      const offset = 0.5 * (left - right) / denom;
      if (Number.isFinite(offset)) {
        refinedBin = bestBin + clamp(offset, -1, 1);
      }
    }
  }
  return refinedBin;
}

export function detectPitchFftHpsDetailed(data, sampleRate, minHz, maxHz, options = {}) {
  if (!data || data.length <= 0 || !isPowerOfTwo(data.length) || sampleRate <= 0) {
    return {hz: 0, confidence: 0, rms: 0};
  }

  const rms = computeRms(data);
  if (rms < RMS_MIN) {
    return {hz: 0, confidence: 0, rms};
  }

  // App policy: window size and output bin count are separate knobs.
  // Internally we convert binCount -> FFT length and zero-pad when needed.
  const size = resolveFftSize(data.length, options);
  if (size === 0) {
    return {hz: 0, confidence: 0, rms};
  }
  const nyquistBin = size / 2;
  const plan = getPlan(size);
  const scratch = getScratch(size);

  applyHannWindow(data, scratch.windowed);

  for (let i = 0; i < size; i += 1) {
    const sourceIndex = plan.bitReverse[i];
    scratch.real[i] = scratch.windowed[sourceIndex];
    scratch.imag[i] = 0;
  }

  runFftInPlace(scratch.real, scratch.imag, plan.twiddleCos, plan.twiddleSin);

  for (let bin = 0; bin <= nyquistBin; bin += 1) {
    const real = scratch.real[bin];
    const imag = scratch.imag[bin];
    scratch.magnitudes[bin] = Math.hypot(real, imag);
  }

  const safeMinHz = Math.max(1e-6, minHz);
  const safeMaxHz = Math.max(safeMinHz, maxHz);
  const minBin = clamp(Math.floor((safeMinHz * size) / sampleRate), 1, nyquistBin);
  const maxBin = clamp(Math.ceil((safeMaxHz * size) / sampleRate), minBin, nyquistBin);
  const detector = options.detector === "shs" ? "shs" : "hps";
  const harmonicCount = clamp(Math.floor(options.harmonicCount ?? 4), 2, 6);
  const confidenceMin = Math.max(0, Number(options.confidenceMin ?? 0));
  const peakFloorRatio = clamp(Number(options.peakFloorRatio ?? 0.12), 0, 1);

  // SHS scoring knobs: sum weighted harmonic energy from a candidate f0.
  const shsHarmonicPower = Number(options.shsHarmonicPower ?? 0.75);
  const shsMissingPenalty = Math.max(0, Number(options.shsMissingPenalty ?? 0.15));
  const shsFundamentalBoost = Math.max(1, Number(options.shsFundamentalBoost ?? 1.8));
  const shsSupportThresholdRatio = clamp(Number(options.shsSupportThresholdRatio ?? 0.18), 0, 1);

  // HPS-like scoring knobs: reward strong fundamental + harmonic support.
  const hpsBaseWeight = Math.max(0.5, Number(options.baseWeight ?? 1.5));
  const hpsSupportThresholdRatio = clamp(Number(options.supportThresholdRatio ?? 0.1), 0, 1);
  const hpsSupportBonusPerHarmonic = Math.max(0, Number(options.supportBonusPerHarmonic ?? 0.45));

  let maxMagnitude = 0;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const magnitude = scratch.magnitudes[bin];
    if (magnitude > maxMagnitude) {
      maxMagnitude = magnitude;
    }
  }
  const peakFloor = maxMagnitude * peakFloorRatio;

  let bestBin = 0;
  let bestScore = 0;
  let secondBestScore = 0;

  for (let bin = minBin; bin <= maxBin; bin += 1) {
    const candidateMagnitude = scratch.magnitudes[bin];
    const leftNeighborMagnitude = scratch.magnitudes[Math.max(minBin, bin - 1)];
    const rightNeighborMagnitude = scratch.magnitudes[Math.min(maxBin, bin + 1)];
    // Only score local peaks; flat/noisy bins are rarely good f0 candidates.
    if (!(candidateMagnitude > 0)) continue;
    if (candidateMagnitude < peakFloor) continue;
    if (candidateMagnitude < leftNeighborMagnitude || candidateMagnitude < rightNeighborMagnitude) continue;

    let score = 0;
    if (detector === "shs") {
      let supportedHarmonics = 0;
      for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
        const harmonicBin = bin * harmonic;
        if (harmonicBin > nyquistBin) break;
        const left = scratch.magnitudes[Math.max(0, harmonicBin - 1)];
        const mid = scratch.magnitudes[harmonicBin];
        const right = scratch.magnitudes[Math.min(nyquistBin, harmonicBin + 1)];
        const harmonicPeak = Math.max(left, mid, right);
        // "Supported" means this harmonic has visible energy near expected location.
        if (harmonicPeak >= candidateMagnitude * shsSupportThresholdRatio) {
          supportedHarmonics += 1;
        }
        // Give extra weight to the candidate fundamental itself to reduce octave errors.
        const harmonicWeight = (harmonic === 1 ? shsFundamentalBoost : 1)
            / (harmonic ** shsHarmonicPower);
        score += harmonicPeak * harmonicWeight;
      }
      const expectedHarmonics = Math.min(harmonicCount, Math.floor(nyquistBin / bin));
      const missingHarmonics = Math.max(0, expectedHarmonics - supportedHarmonics);
      score -= missingHarmonics * shsMissingPenalty * candidateMagnitude;
      if (score <= 0) continue;
    } else {
      let harmonicScore = 0;
      let supportCount = 1;
      for (let harmonic = 2; harmonic <= harmonicCount; harmonic += 1) {
        const harmonicBin = bin * harmonic;
        if (harmonicBin > nyquistBin) break;
        const left = scratch.magnitudes[Math.max(0, harmonicBin - 1)];
        const mid = scratch.magnitudes[harmonicBin];
        const right = scratch.magnitudes[Math.min(nyquistBin, harmonicBin + 1)];
        const harmonicPeak = Math.max(left, mid, right);
        harmonicScore += harmonicPeak / harmonic;
        if (harmonicPeak >= candidateMagnitude * hpsSupportThresholdRatio) {
          supportCount += 1;
        }
      }

      const supportMultiplier = 1 + ((supportCount - 1) * hpsSupportBonusPerHarmonic);
      score = (candidateMagnitude * hpsBaseWeight + harmonicScore) * supportMultiplier;
    }

    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestBin = bin;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestBin || bestScore <= 0) {
    return {hz: 0, confidence: 0, rms};
  }

  const confidence = secondBestScore > 0 ? bestScore / secondBestScore : bestScore;
  if (confidence < confidenceMin) {
    return {hz: 0, confidence, rms};
  }

  const refinedBin = findRefinedPeakBin(scratch.magnitudes, bestBin, minBin, maxBin);

  const hz = (refinedBin * sampleRate) / size;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) {
    return {hz: 0, confidence, rms};
  }

  return {hz, confidence, rms};
}

export function detectPitchFftHps(data, sampleRate, minHz, maxHz, options = {}) {
  return detectPitchFftHpsDetailed(data, sampleRate, minHz, maxHz, options).hz;
}

export function detectPitchFftResidualDetailed(data, sampleRate, minHz, maxHz, options = {}) {
  if (!data || data.length <= 0 || !isPowerOfTwo(data.length) || sampleRate <= 0) {
    return {hz: 0, confidence: 0, rms: 0};
  }

  const rms = computeRms(data);
  if (rms < RMS_MIN) {
    return {hz: 0, confidence: 0, rms};
  }

  // Same decoupling as HPS path.
  const size = resolveFftSize(data.length, options);
  if (size === 0) {
    return {hz: 0, confidence: 0, rms};
  }
  const nyquistBin = size / 2;
  const plan = getPlan(size);
  const scratch = getScratch(size);

  applyHannWindow(data, scratch.windowed);
  for (let i = 0; i < size; i += 1) {
    const sourceIndex = plan.bitReverse[i];
    scratch.real[i] = scratch.windowed[sourceIndex];
    scratch.imag[i] = 0;
  }

  runFftInPlace(scratch.real, scratch.imag, plan.twiddleCos, plan.twiddleSin);
  for (let bin = 0; bin <= nyquistBin; bin += 1) {
    const real = scratch.real[bin];
    const imag = scratch.imag[bin];
    scratch.magnitudes[bin] = Math.hypot(real, imag);
  }

  const safeMinHz = Math.max(1e-6, minHz);
  const safeMaxHz = Math.max(safeMinHz, maxHz);
  const minBin = clamp(Math.floor((safeMinHz * size) / sampleRate), 1, nyquistBin);
  const maxBin = clamp(Math.ceil((safeMaxHz * size) / sampleRate), minBin, nyquistBin);
  const confidenceMin = Math.max(0, Number(options.confidenceMin ?? 0));

  let totalMagnitude = 0;
  for (let bin = 0; bin <= nyquistBin; bin += 1) {
    totalMagnitude += scratch.magnitudes[bin];
  }
  const globalMean = totalMagnitude / (nyquistBin + 1);

  let bestBin = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let secondBestScore = Number.NEGATIVE_INFINITY;

  for (let candidateBin = minBin; candidateBin <= maxBin; candidateBin += 1) {
    if (candidateBin < 2) continue;
    let multiplesMagnitude = 0;
    let multiplesCount = 0;
    for (let harmonicBin = candidateBin; harmonicBin <= nyquistBin; harmonicBin += candidateBin) {
      multiplesMagnitude += scratch.magnitudes[harmonicBin];
      multiplesCount += 1;
    }

    // Score higher when harmonic bins for this spacing are stronger than average.
    const score = multiplesMagnitude - (multiplesCount * globalMean);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestBin = candidateBin;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestBin || !Number.isFinite(bestScore)) {
    return {hz: 0, confidence: 0, rms};
  }

  const confidence = Number.isFinite(secondBestScore)
      ? Math.max(0, (bestScore - secondBestScore) / Math.max(1e-12, Math.abs(bestScore)))
      : 1;
  if (confidence < confidenceMin) {
    return {hz: 0, confidence, rms};
  }

  const hz = (bestBin * sampleRate) / size;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) {
    return {hz: 0, confidence, rms};
  }

  return {hz, confidence, rms};
}

export function detectPitchFftResidual(data, sampleRate, minHz, maxHz, options = {}) {
  return detectPitchFftResidualDetailed(data, sampleRate, minHz, maxHz, options).hz;
}
