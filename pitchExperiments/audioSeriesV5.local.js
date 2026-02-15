// Mirror of V5 detector logic from src/audioSeries.js for no-build pitch experiments.
// Keep in sync manually with app code when V5 changes.

const ADAPTIVE_RANGE_MIN_FACTOR = 0.5;
const ADAPTIVE_RANGE_MAX_FACTOR = 2;
const ADAPTIVE_RANGE_REACQUIRE_MISSES = 20;
const ADAPTIVE_RANGE_FULL_SCAN_INTERVAL = 40;
const ADAPTIVE_RANGE_SWITCH_RATIO = 1.15;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(current, next, factor) {
  return current + (next - current) * factor;
}

export function createAudioState(defaultSamplesPerSecond) {
  return {
    context: null,
    analyser: null,
    source: null,
    stream: null,
    captureNode: null,
    sinkGain: null,
    hzBuffer: null,
    hzIndex: 0,
    sampleRate: 48000,
    analysisFps: defaultSamplesPerSecond,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
    levelEma: 0,
    lastTrackedHz: 0,
    missedDetections: 0,
    adaptiveTick: 0,
  };
}

export function setupAudioState(prevState, {
  context,
  source,
  stream,
  captureNode,
  analyser,
  sinkGain,
  analysisFps,
  centerSeconds,
  sampleRate,
}) {
  const hzLength = Math.floor(centerSeconds * analysisFps);

  const existingHzBuffer = prevState.hzBuffer;
  const hzBuffer = existingHzBuffer && existingHzBuffer.length === hzLength
      ? existingHzBuffer
      : (() => {
        const buf = new Float32Array(hzLength);
        buf.fill(Number.NaN);
        return buf;
      })();

  return {
    ...prevState,
    context,
    source,
    stream,
    captureNode,
    analyser,
    sinkGain,
    hzBuffer,
    hzIndex: prevState.hzIndex || 0,
    sampleRate,
    analysisFps,
    centerHz: prevState.centerHz || 220,
    centerCents: prevState.centerCents || 1200 * Math.log2(220),
    levelEma: prevState.levelEma || 0,
    lastTrackedHz: prevState.lastTrackedHz || 0,
    missedDetections: prevState.missedDetections || 0,
    adaptiveTick: prevState.adaptiveTick || 0,
  };
}

function computeCenterHzMedian(hzBuffer, minHz, maxHz) {
  const values = [];
  for (let i = 0; i < hzBuffer.length; i += 1) {
    const value = hzBuffer[i];
    if (Number.isFinite(value) && value >= minHz && value <= maxHz) {
      values.push(value);
    }
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[mid - 1] + values[mid]) / 2;
  }
  return values[mid];
}

function computeWindowLevel(state, timeData) {
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const value = timeData[i];
    const absValue = Math.abs(value);
    if (absValue > peak) peak = absValue;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);
  state.levelEma = lerp(state.levelEma, rms, 0.2);
  return {peak, rms: state.levelEma};
}

function finalizeDetection(state, {
  peak,
  hz,
  minHz,
  maxHz,
  adaptiveRange,
  usedWideSearch,
}) {
  const {hzBuffer} = state;
  const inHzRange = hz >= minHz && hz <= maxHz;
  const hasVoice = inHzRange;
  const absCents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;

  if (hasVoice) {
    state.lastTrackedHz = hz;
    state.missedDetections = 0;
    hzBuffer[state.hzIndex] = hz;
    state.hzIndex = (state.hzIndex + 1) % hzBuffer.length;
    const centerHz = computeCenterHzMedian(hzBuffer, minHz, maxHz);
    if (centerHz > 0) {
      state.centerHz = lerp(state.centerHz, centerHz, 0.2);
      state.centerCents = 1200 * Math.log2(state.centerHz);
    }
  } else if (adaptiveRange) {
    state.missedDetections += 1;
    if (state.missedDetections >= ADAPTIVE_RANGE_REACQUIRE_MISSES) {
      state.lastTrackedHz = 0;
    }
  }

  return {
    peak,
    rms: state.levelEma,
    hz,
    hasVoice,
    cents: absCents,
    usedWideSearch,
  };
}

function detectPitchSpectrumV5Detailed(spectrumBins, sampleRate, minHz, maxHz, options = {}) {
  if (!spectrumBins || spectrumBins.length < 8) {
    return {hz: 0, confidence: 0};
  }
  const nyquistBin = spectrumBins.length - 1;
  const binSizeHz = (sampleRate / 2) / spectrumBins.length;
  const minBin = Math.max(1, Math.floor(minHz / binSizeHz));
  const maxBin = Math.min(nyquistBin, Math.floor(maxHz / binSizeHz));
  if (maxBin <= minBin) {
    return {hz: 0, confidence: 0};
  }

  const maxP = options.maxP ?? 6;
  const pCount = options.pCount ?? 12;
  const pRefineCount = options.pRefineCount ?? 4;
  const offWeight = options.offWeight ?? 0.5;
  const expectedP0MinRatio = options.expectedP0MinRatio ?? 0.18;
  const expectedP0PenaltyWeight = options.expectedP0PenaltyWeight ?? 2.0;
  const downwardBiasPerP = options.downwardBiasPerP ?? 0.02;
  const searchRadiusBins = options.searchRadiusBins ?? 2;

  function refineLocalPeakBinParabolic(binIndex) {
    const clampedBin = clamp(Math.round(binIndex), 1, nyquistBin - 1);
    const left = spectrumBins[clampedBin - 1];
    const mid = spectrumBins[clampedBin];
    const right = spectrumBins[clampedBin + 1];
    if (mid < left || mid < right) {
      return clampedBin;
    }
    const denominator = left - (2 * mid) + right;
    if (!Number.isFinite(denominator) || denominator === 0) {
      return clampedBin;
    }
    const offset = 0.5 * (left - right) / denominator;
    return clampedBin + clamp(offset, -1, 1);
  }

  function scoreHypothesis(f0Bin) {
    if (!Number.isFinite(f0Bin) || f0Bin < minBin || f0Bin > maxBin) {
      return {score: Number.NEGATIVE_INFINITY, p0Magnitude: 0, pContributions: []};
    }
    let score = 0;
    let p0Magnitude = 0;
    const pContributions = [];
    for (let p = 1; p <= pCount; p += 1) {
      const pBin = Math.round(f0Bin * p);
      if (pBin < minBin || pBin > maxBin) break;
      const onMagnitude = spectrumBins[pBin];
      if (p === 1) {
        p0Magnitude = onMagnitude;
      }
      const offBin = Math.round(f0Bin * (p + 0.5));
      const offMagnitude = offBin >= minBin && offBin <= maxBin ? spectrumBins[offBin] : 0;
      const contribution = onMagnitude - (offWeight * offMagnitude);
      score += contribution;
      pContributions.push(contribution);
    }
    return {score, p0Magnitude, pContributions};
  }

  function refineF0FromPartials(baseF0Bin) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let p = 1; p <= pRefineCount; p += 1) {
      const targetBin = baseF0Bin * p;
      if (targetBin < minBin || targetBin > maxBin) break;
      const searchStart = clamp(Math.floor(targetBin) - searchRadiusBins, minBin, maxBin);
      const searchEnd = clamp(Math.ceil(targetBin) + searchRadiusBins, minBin, maxBin);
      let bestBin = searchStart;
      let bestMagnitude = Number.NEGATIVE_INFINITY;
      for (let bin = searchStart; bin <= searchEnd; bin += 1) {
        const magnitude = spectrumBins[bin];
        if (magnitude > bestMagnitude) {
          bestMagnitude = magnitude;
          bestBin = bin;
        }
      }
      const refinedPBin = refineLocalPeakBinParabolic(bestBin);
      const f0FromPBin = refinedPBin / p;
      const localBaseline = (spectrumBins[Math.max(0, bestBin - 1)] + spectrumBins[Math.min(nyquistBin, bestBin + 1)]) / 2;
      const peakiness = Math.max(0, bestMagnitude - localBaseline);
      const weight = bestMagnitude * peakiness;
      if (!(weight > 0) || !Number.isFinite(f0FromPBin)) continue;
      weightedSum += f0FromPBin * weight;
      totalWeight += weight;
    }
    if (!(totalWeight > 0)) return Number.NaN;
    return weightedSum / totalWeight;
  }

  let strongestPeakBin = minBin;
  let strongestPeakMagnitude = Number.NEGATIVE_INFINITY;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (spectrumBins[bin] > strongestPeakMagnitude) {
      strongestPeakMagnitude = spectrumBins[bin];
      strongestPeakBin = bin;
    }
  }

  let bestP = 1;
  let bestF0Bin = strongestPeakBin;
  let bestScore = Number.NEGATIVE_INFINITY;
  const byPContributions = {};
  const byPScore = {};
  for (let p = 1; p <= maxP; p += 1) {
    const f0Bin = strongestPeakBin / p;
    if (f0Bin < minBin || f0Bin > maxBin) {
      byPContributions[`ifP${p - 1}`] = [];
      byPScore[`ifP${p - 1}`] = Number.NEGATIVE_INFINITY;
      continue;
    }
    const {score, p0Magnitude, pContributions} = scoreHypothesis(f0Bin);
    let hypothesisScore = score;
    if (p > 1) {
      const expectedP0Magnitude = strongestPeakMagnitude * expectedP0MinRatio;
      const p0Deficit = Math.max(0, expectedP0Magnitude - p0Magnitude);
      hypothesisScore -= p0Deficit * expectedP0PenaltyWeight;
    }
    hypothesisScore -= p * downwardBiasPerP;
    byPContributions[`ifP${p - 1}`] = pContributions;
    byPScore[`ifP${p - 1}`] = hypothesisScore;
    if (hypothesisScore > bestScore) {
      bestScore = hypothesisScore;
      bestP = p;
      bestF0Bin = f0Bin;
    }
  }

  const refinedF0Bin = refineF0FromPartials(bestF0Bin);
  const finalF0Bin = Number.isFinite(refinedF0Bin) ? refinedF0Bin : bestF0Bin;
  const hz = finalF0Bin * binSizeHz;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) {
    return {hz: 0, confidence: 0};
  }

  const confidence = Math.max(0, Math.min(1, strongestPeakMagnitude));
  return {
    hz,
    confidence,
    bestP,
    strongestPeakBin,
    debug: {
      strongestPeakBin,
      strongestPeakHz: strongestPeakBin * binSizeHz,
      strongestPeakMagnitude,
      bestP: bestP - 1,
      bestPScore: bestScore,
      bestF0Bin,
      bestF0Hz: bestF0Bin * binSizeHz,
      prediction: `the peak at ${(strongestPeakBin * binSizeHz).toFixed(2)}hz is P${bestP - 1}`,
      byPContributions,
      byPScore,
    },
  };
}

export function analyzeAudioWindowSpectrumV5(
    state,
    timeData,
    spectrumBins,
    minHz,
    maxHz,
    options = {}
) {
  const {hzBuffer} = state;
  if (!hzBuffer || !timeData || !timeData.length || !spectrumBins || !spectrumBins.length) return null;
  const {peak} = computeWindowLevel(state, timeData);
  const adaptiveRange = options.adaptiveRange === true;
  const minRms = Number.isFinite(options.minRms) ? options.minRms : 0.01;

  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const value = timeData[i];
    sumSquares += value * value;
  }
  const rawRms = Math.sqrt(sumSquares / timeData.length);
  if (rawRms < minRms) {
    const result = finalizeDetection(state, {
      peak,
      hz: 0,
      minHz,
      maxHz,
      adaptiveRange,
      usedWideSearch: false,
    });
    return {
      ...result,
      confidence: 0,
    };
  }

  let usedWideSearch = false;
  let detection = null;
  if (adaptiveRange) {
    state.adaptiveTick += 1;
    const canUseTrackedRange =
        state.lastTrackedHz > 0 &&
        state.missedDetections < ADAPTIVE_RANGE_REACQUIRE_MISSES;
    if (canUseTrackedRange) {
      const narrowMinHz = Math.max(minHz, state.lastTrackedHz * ADAPTIVE_RANGE_MIN_FACTOR);
      const narrowMaxHz = Math.min(maxHz, state.lastTrackedHz * ADAPTIVE_RANGE_MAX_FACTOR);
      if (narrowMaxHz > narrowMinHz) {
        const narrowDetection = detectPitchSpectrumV5Detailed(
            spectrumBins,
            state.sampleRate,
            narrowMinHz,
            narrowMaxHz,
            options
        );
        if (narrowDetection.hz > 0) {
          detection = narrowDetection;
          if (state.adaptiveTick % ADAPTIVE_RANGE_FULL_SCAN_INTERVAL === 0) {
            const fullDetection = detectPitchSpectrumV5Detailed(
                spectrumBins,
                state.sampleRate,
                minHz,
                maxHz,
                options
            );
            usedWideSearch = true;
            if (
                fullDetection.hz > 0 &&
                fullDetection.confidence > narrowDetection.confidence * ADAPTIVE_RANGE_SWITCH_RATIO
            ) {
              detection = fullDetection;
            }
          }
        } else {
          detection = detectPitchSpectrumV5Detailed(
              spectrumBins,
              state.sampleRate,
              minHz,
              maxHz,
              options
          );
          usedWideSearch = true;
        }
      }
    }
  }
  if (!detection) {
    detection = detectPitchSpectrumV5Detailed(
        spectrumBins,
        state.sampleRate,
        minHz,
        maxHz,
        options
    );
    if (adaptiveRange) {
      usedWideSearch = true;
    }
  }

  const result = finalizeDetection(state, {
    peak,
    hz: detection.hz,
    minHz,
    maxHz,
    adaptiveRange,
    usedWideSearch,
  });
  return {
    ...result,
    confidence: detection.confidence,
    debug: detection.debug ?? null,
  };
}
