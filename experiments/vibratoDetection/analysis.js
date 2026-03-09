import { DEFAULT_PITCH_TUNING, detectPitchFromSpectrumDetailed } from "../pitchDetectionCore.js";

// const AUDIO_PATH = "../../.private/assets/david_vibrato_2.wav";
// const AUDIO_PATH = "../../.private/assets/david_vibrato_3.wav";
const AUDIO_PATH = "../../.private/assets/rozette_vibrato.wav";
const DISPLAY_SAMPLES_PER_SECOND = 80;
const FFT_SIZE = 4096;
const FFT_BIN_COUNT = FFT_SIZE / 2;
const MIN_PITCH_HZ = 32.703; // C1
const MAX_PITCH_HZ = 1396.913; // F6

const VIBRATO_MIN_RATE_HZ = 3;
const VIBRATO_MAX_RATE_HZ = 9;
const VIBRATO_ANALYSIS_WINDOW_SECONDS = 0.7;
const VIBRATO_MIN_CONTIGUOUS_SECONDS = 0.4;
const VIBRATO_BASELINE_WINDOW_SECONDS = VIBRATO_ANALYSIS_WINDOW_SECONDS;
const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dbToMagnitude(db) {
  if (!Number.isFinite(db)) return 0;
  return 10 ** (db / 20);
}

function orderedTimelineValues(values, writeIndex, count) {
  const ordered = [];
  const total = values.length;
  const firstIndex = count === total ? writeIndex : 0;
  for (let i = 0; i < count; i += 1) {
    ordered.push(values[(firstIndex + i) % total]);
  }
  return ordered;
}

function contiguousFiniteTail(values, maxSamples) {
  const tail = [];
  for (let i = values.length - 1; i >= 0 && tail.length < maxSamples; i -= 1) {
    const value = values[i];
    if (!Number.isFinite(value)) break;
    tail.push(value);
  }
  tail.reverse();
  return tail;
}

function median(values) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }
  return sorted[middleIndex];
}

function centeredFiniteTail({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  analysisWindowSeconds,
  minContinuousSeconds,
}) {
  if (!values || count <= 0 || samplesPerSecond <= 0) return null;
  const ordered = orderedTimelineValues(values, writeIndex, count);
  const maxSamples = Math.max(1, Math.floor(samplesPerSecond * analysisWindowSeconds));
  const tail = contiguousFiniteTail(ordered, maxSamples);
  const minSamples = Math.max(8, Math.floor(samplesPerSecond * minContinuousSeconds));
  if (tail.length < minSamples) return null;

  let sum = 0;
  for (const value of tail) {
    sum += value;
  }
  const mean = sum / tail.length;

  const centered = new Array(tail.length);
  let sumSquares = 0;
  for (let i = 0; i < tail.length; i += 1) {
    const delta = tail[i] - mean;
    centered[i] = delta;
    sumSquares += delta * delta;
  }
  const rms = Math.sqrt(sumSquares / centered.length);
  return {
    centered,
    rms,
    tailLength: tail.length,
  };
}

function rateFromZeroCrossings(centered, samplesPerSecond) {
  if (!centered || centered.length < 2) return null;

  const crossings = [];
  const epsilon = 1e-6;
  for (let i = 1; i < centered.length; i += 1) {
    const previous = centered[i - 1];
    const next = centered[i];
    if (!(previous <= 0 && next > 0)) continue;
    const slope = next - previous;
    if (Math.abs(slope) <= epsilon) continue;
    const crossingOffset = (0 - previous) / slope;
    crossings.push(i - 1 + crossingOffset);
  }
  if (crossings.length < 2) return null;

  const periodsInSamples = [];
  for (let i = 1; i < crossings.length; i += 1) {
    const spacing = crossings[i] - crossings[i - 1];
    if (spacing > 0) periodsInSamples.push(spacing);
  }
  if (!periodsInSamples.length) return null;

  const periodSamples = median(periodsInSamples);
  if (!Number.isFinite(periodSamples) || periodSamples <= 0) return null;
  const rateHz = samplesPerSecond / periodSamples;
  if (!Number.isFinite(rateHz)) return null;
  return rateHz;
}

function rateFromAutocorrelation(centered, samplesPerSecond, minRateHz, maxRateHz) {
  if (!centered || centered.length < 3) return null;

  const minLag = Math.max(1, Math.floor(samplesPerSecond / maxRateHz));
  const maxLag = Math.min(centered.length - 2, Math.ceil(samplesPerSecond / minRateHz));
  if (maxLag < minLag) return null;

  const correlations = new Array(maxLag + 1).fill(0);
  let bestOverallLag = 1;
  let bestOverallCorrelation = Number.NEGATIVE_INFINITY;
  let bestLag = minLag;
  let bestCorrelation = Number.NEGATIVE_INFINITY;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    const overlapLength = centered.length - lag;
    for (let i = 0; i < overlapLength; i += 1) {
      sum += centered[i] * centered[i + lag];
    }
    const correlation = sum / overlapLength;
    correlations[lag] = correlation;
    if (correlation > bestOverallCorrelation) {
      bestOverallCorrelation = correlation;
      bestOverallLag = lag;
    }
    if (lag >= minLag && correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  if (!(bestCorrelation > 0)) return null;
  if (bestOverallLag < minLag && bestOverallCorrelation > bestCorrelation * 1.1) return null;

  let dominantLag = bestLag;
  for (let divisor = 2; divisor <= 4; divisor += 1) {
    const candidateLag = Math.round(bestLag / divisor);
    if (candidateLag < 1 || candidateLag >= bestLag || candidateLag > maxLag) continue;
    if (correlations[candidateLag] >= bestCorrelation * 0.9) {
      dominantLag = candidateLag;
      break;
    }
  }

  let refinedLag = dominantLag;
  if (dominantLag > minLag && dominantLag < maxLag) {
    const left = correlations[dominantLag - 1];
    const center = correlations[dominantLag];
    const right = correlations[dominantLag + 1];
    const denominator = left - 2 * center + right;
    if (Math.abs(denominator) > 1e-6) {
      const offset = (0.5 * (left - right)) / denominator;
      if (Math.abs(offset) <= 1) {
        refinedLag = bestLag + offset;
      }
    }
  }
  if (!(refinedLag > 0)) return null;

  const rateHz = samplesPerSecond / refinedLag;
  if (!Number.isFinite(rateHz)) return null;
  return rateHz;
}

function rateFromTopTwoPeaks(centered, samplesPerSecond) {
  if (!centered || centered.length < 3) return null;
  const peaks = [];
  for (let i = 1; i < centered.length - 1; i += 1) {
    if (centered[i] > centered[i - 1] && centered[i] >= centered[i + 1]) {
      peaks.push({ index: i, amplitude: centered[i] });
    }
  }
  if (peaks.length < 2) return null;

  peaks.sort((a, b) => b.amplitude - a.amplitude);
  const firstPeak = peaks[0];
  const secondPeak = peaks[1];
  const spacingSamples = Math.abs(secondPeak.index - firstPeak.index);
  if (!(spacingSamples > 0)) return null;
  const rateHz = samplesPerSecond / spacingSamples;
  if (!Number.isFinite(rateHz)) return null;
  return rateHz;
}

function rateFromLastTwoShapePeaks(centered, samplesPerSecond) {
  if (!centered || centered.length < 5) {
    return null;
  }
  let expectedType =
    centered[centered.length - 2] - centered[centered.length - 3] >= 0 ? "trough" : "peak";
  const extrema = [];
  let peakCount = 0;
  let troughCount = 0;
  let index = centered.length - 3;
  while (index >= 2 && (peakCount < 2 || troughCount < 2)) {
    const left2 = centered[index - 2];
    const left1 = centered[index - 1];
    const value = centered[index];
    const right1 = centered[index + 1];
    const right2 = centered[index + 2];
    if (expectedType === "trough") {
      const isTrough =
        value <= left2 &&
        value <= left1 &&
        value <= right1 &&
        value <= right2 &&
        (value < left2 || value < left1 || value < right1 || value < right2);
      if (isTrough) {
        extrema.push({ type: "trough", index });
        troughCount += 1;
        expectedType = "peak";
        index -= 2;
        continue;
      }
    } else {
      const isPeak =
        value >= left2 &&
        value >= left1 &&
        value >= right1 &&
        value >= right2 &&
        (value > left2 || value > left1 || value > right1 || value > right2);
      if (isPeak) {
        extrema.push({ type: "peak", index });
        peakCount += 1;
        expectedType = "trough";
        index -= 2;
        continue;
      }
    }
    index -= 1;
  }

  if (peakCount < 2 || troughCount < 2 || extrema.length < 4) return null;
  const leg1 = extrema[0].index - extrema[1].index;
  const leg2 = extrema[1].index - extrema[2].index;
  const leg3 = extrema[2].index - extrema[3].index;
  if (!(leg1 > 0 && leg2 > 0 && leg3 > 0)) return null;
  const legSamples = (leg1 + leg2 + leg3) / 3;
  let minInWindow = Number.POSITIVE_INFINITY;
  let maxInWindow = Number.NEGATIVE_INFINITY;
  for (const value of centered) {
    if (value < minInWindow) minInWindow = value;
    if (value > maxInWindow) maxInWindow = value;
  }
  if (maxInWindow - minInWindow < 12) return null;
  const rateHz = samplesPerSecond / (legSamples * 2);
  if (!Number.isFinite(rateHz)) return null;
  return {
    rateHz,
    debug: {
      selectedPeakIndices: extrema.slice(0, 4).map((entry) => entry.index),
      selectedFeatureType: extrema[0].type,
      selectedFeatureCount: extrema.length,
      peakCount,
      troughCount,
      rangeCents: maxInWindow - minInWindow,
    },
  };
}

function estimateTimelineVibratoRateHzWithMethod({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  minRateHz = 4,
  maxRateHz = 10,
  analysisWindowSeconds = 2.5,
  minContinuousSeconds = 0.6,
  method,
  debugName = "",
  debugContext = "",
}) {
  if (debugName) {
    console.log(`[vibrato:${debugName}] start`, {
      debugContext,
      writeIndex,
      count,
      samplesPerSecond,
      minRateHz,
      maxRateHz,
      analysisWindowSeconds,
      minContinuousSeconds,
    });
  }
  const tailData = centeredFiniteTail({
    values,
    writeIndex,
    count,
    samplesPerSecond,
    analysisWindowSeconds,
    minContinuousSeconds,
  });
  if (!tailData) {
    if (debugName) {
      console.log(`[vibrato:${debugName}] no tailData`, {
        debugContext,
        reason: "not enough contiguous finite values",
      });
    }
    return null;
  }
  if (tailData.rms < 5) {
    if (debugName) {
      console.log(`[vibrato:${debugName}] rejected by rms`, {
        debugContext,
        rms: tailData.rms,
        threshold: 5,
        windowSamples: tailData.tailLength,
      });
    }
    return null;
  }

  const rawMethodResult = method(tailData.centered, samplesPerSecond, minRateHz, maxRateHz);
  const rateHz =
    typeof rawMethodResult === "object" && rawMethodResult !== null
      ? rawMethodResult.rateHz
      : rawMethodResult;
  const methodDebug =
    typeof rawMethodResult === "object" && rawMethodResult !== null ? rawMethodResult.debug : null;
  if (!Number.isFinite(rateHz)) {
    if (debugName) {
      console.log(`[vibrato:${debugName}] method returned non-finite rate`, {
        debugContext,
        rateHz,
      });
    }
    return null;
  }
  if (rateHz < minRateHz || rateHz > maxRateHz) {
    if (debugName) {
      console.log(`[vibrato:${debugName}] rejected by min/max range`, {
        debugContext,
        rateHz,
        minRateHz,
        maxRateHz,
      });
    }
    return null;
  }

  const tailStartIndex = Math.max(0, count - tailData.tailLength);

  if (debugName) {
    console.log(`[vibrato:${debugName}] accepted`, {
      debugContext,
      rateHz,
      windowSamples: tailData.tailLength,
      tailStartIndex,
      tailEndIndex: count - 1,
      methodDebug,
    });
  }

  return {
    rateHz,
    windowSamples: tailData.tailLength,
    tailStartIndex,
    tailEndIndex: count - 1,
    methodDebug,
  };
}

export function estimateTimelineVibratoRateHzZeroCrossing(options) {
  return estimateTimelineVibratoRateHzWithMethod({
    ...options,
    method: (centered, samplesPerSecond) => rateFromZeroCrossings(centered, samplesPerSecond),
  });
}

export function estimateTimelineVibratoRateHzAutoCorrelation(options) {
  return estimateTimelineVibratoRateHzWithMethod({
    ...options,
    method: (centered, samplesPerSecond, minRateHz, maxRateHz) =>
      rateFromAutocorrelation(centered, samplesPerSecond, minRateHz, maxRateHz),
  });
}

export function estimateTimelineVibratoRateHzPeakSpacing(options) {
  return estimateTimelineVibratoRateHzWithMethod({
    ...options,
    debugName: "peak-spacing",
    method: (centered, samplesPerSecond, minRateHz, maxRateHz) => {
      console.log("[vibrato:peak-spacing] running peak finder", {
        debugContext: options.debugContext ?? "",
        centeredLength: centered?.length ?? 0,
        previousSpacingSamples: options.previousSpacingSamples ?? null,
      });
      if (!centered || centered.length < 3) {
        console.log("[vibrato:peak-spacing] early return", {
          debugContext: options.debugContext ?? "",
          reason: "centered length < 3",
        });
        return null;
      }
      const peaks = [];
      for (let i = 1; i < centered.length - 1; i += 1) {
        if (centered[i] > centered[i - 1] && centered[i] >= centered[i + 1]) {
          peaks.push({ index: i, amplitude: centered[i] });
        }
      }
      if (peaks.length < 2) {
        console.log("[vibrato:peak-spacing] early return", {
          debugContext: options.debugContext ?? "",
          reason: "fewer than 2 peaks",
          peaksFound: peaks.length,
        });
        return null;
      }

      peaks.sort((a, b) => b.amplitude - a.amplitude);
      const firstPeak = peaks[0];
      const secondPeak = peaks[1];
      const rawSpacingSamples = Math.abs(secondPeak.index - firstPeak.index);
      if (!(rawSpacingSamples > 0)) {
        console.log("[vibrato:peak-spacing] early return", {
          debugContext: options.debugContext ?? "",
          reason: "peak spacing <= 0",
          firstPeak,
          secondPeak,
        });
        return null;
      }
      const minSpacingSamples = samplesPerSecond / maxRateHz;
      const maxSpacingSamples = samplesPerSecond / minRateHz;
      const previousSpacingSamples = Number.isFinite(options.previousSpacingSamples)
        ? options.previousSpacingSamples
        : null;
      const candidates = [];
      for (let divisor = 1; divisor <= 8; divisor += 1) {
        const candidateSpacingSamples = rawSpacingSamples / divisor;
        if (
          candidateSpacingSamples < minSpacingSamples ||
          candidateSpacingSamples > maxSpacingSamples
        )
          continue;
        const candidateRateHz = samplesPerSecond / candidateSpacingSamples;
        const stabilityError =
          previousSpacingSamples === null
            ? 0
            : Math.abs(candidateSpacingSamples - previousSpacingSamples) / previousSpacingSamples;
        candidates.push({
          divisor,
          candidateSpacingSamples,
          candidateRateHz,
          stabilityError,
        });
      }
      if (candidates.length === 0) {
        console.log("[vibrato:peak-spacing] early return", {
          debugContext: options.debugContext ?? "",
          reason: "no spacing divisor in vibrato range",
          rawSpacingSamples,
          minSpacingSamples,
          maxSpacingSamples,
        });
        return null;
      }
      let bestCandidate = candidates[0];
      if (previousSpacingSamples !== null) {
        for (let i = 1; i < candidates.length; i += 1) {
          if (candidates[i].stabilityError < bestCandidate.stabilityError) {
            bestCandidate = candidates[i];
          }
        }
      }
      const spacingSamples = bestCandidate.candidateSpacingSamples;
      const rateHz = bestCandidate.candidateRateHz;
      console.log("[vibrato:peak-spacing] candidate rate", {
        debugContext: options.debugContext ?? "",
        firstPeak,
        secondPeak,
        rawSpacingSamples,
        spacingSamples,
        samplesPerSecond,
        previousSpacingSamples,
        candidates,
        chosenDivisor: bestCandidate.divisor,
        rateHz,
      });
      if (!Number.isFinite(rateHz)) {
        console.log("[vibrato:peak-spacing] early return", {
          debugContext: options.debugContext ?? "",
          reason: "non-finite rate",
          rateHz,
        });
        return null;
      }
      return {
        rateHz,
        debug: {
          selectedPeakIndices: [firstPeak.index, secondPeak.index],
          selectedPeaks: [firstPeak, secondPeak],
          rawSpacingSamples,
          chosenSpacingSamples: spacingSamples,
          chosenDivisor: bestCandidate.divisor,
          previousSpacingSamples,
          candidates,
        },
      };
    },
  });
}

export function estimateTimelineVibratoRateHzLastTwoShapePeaks(options) {
  return estimateTimelineVibratoRateHzWithMethod({
    ...options,
    debugName: options.debugLogging ? "last-two-shape-peaks" : "",
    method: (centered, samplesPerSecond) => rateFromLastTwoShapePeaks(centered, samplesPerSecond),
  });
}

async function createWindowSpectrumComputer({
  samples,
  sampleRate,
  binCount,
  windowSize,
  hopSamples,
  windowCount,
}) {
  const context = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);

  const source = context.createBufferSource();
  source.buffer = buffer;

  const analyser = context.createAnalyser();
  analyser.fftSize = binCount * 2;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  analyser.connect(context.destination);

  const dbBins = new Float32Array(analyser.frequencyBinCount);
  const magnitudesByWindow = new Array(windowCount);

  let previousTime = 0;
  const epsilon = 1 / sampleRate;
  const durationSeconds = samples.length / sampleRate;
  for (let index = 0; index < windowCount; index += 1) {
    const startSample = index * hopSamples;
    let snapshotTime = (startSample + windowSize / 2) / sampleRate;
    snapshotTime = clamp(snapshotTime, 0, Math.max(0, durationSeconds - epsilon));
    if (snapshotTime <= previousTime) {
      snapshotTime = Math.min(durationSeconds - epsilon, previousTime + epsilon);
    }
    previousTime = snapshotTime;

    context.suspend(snapshotTime).then(async () => {
      analyser.getFloatFrequencyData(dbBins);
      const magnitudes = new Float32Array(dbBins.length);
      let maxMagnitude = 0;
      for (let bin = 0; bin < dbBins.length; bin += 1) {
        const magnitude = dbToMagnitude(dbBins[bin]);
        magnitudes[bin] = magnitude;
        if (magnitude > maxMagnitude) {
          maxMagnitude = magnitude;
        }
      }
      if (maxMagnitude > 0) {
        const scale = 1 / maxMagnitude;
        for (let bin = 0; bin < magnitudes.length; bin += 1) {
          magnitudes[bin] *= scale;
        }
      }
      magnitudesByWindow[index] = magnitudes;
      await context.resume();
    });
  }

  source.start(0);
  await context.startRendering();

  return function getWindowSpectrum(windowIndex) {
    return magnitudesByWindow[windowIndex] ?? new Float32Array(binCount);
  };
}

function fftBinsToPitchDetailed(spectrumBins, sampleRate, minHz, maxHz) {
  return detectPitchFromSpectrumDetailed(spectrumBins, sampleRate, {
    minHz,
    maxHz,
    tuning: DEFAULT_PITCH_TUNING,
  });
}

function smoothPitchLikeApp(rawPitchCents) {
  const smoothedPitchCents = rawPitchCents.slice();
  if (rawPitchCents.length < SMOOTH_RADIUS * 2 + 1) return smoothedPitchCents;
  for (let center = SMOOTH_RADIUS; center < rawPitchCents.length - SMOOTH_RADIUS; center += 1) {
    let smoothed = 0;
    let hasNaN = false;
    for (let offset = -SMOOTH_RADIUS; offset <= SMOOTH_RADIUS; offset += 1) {
      const sample = rawPitchCents[center + offset];
      if (!Number.isFinite(sample)) {
        hasNaN = true;
        break;
      }
      smoothed += sample * SMOOTH_KERNEL[offset + SMOOTH_RADIUS];
    }
    if (!hasNaN) {
      smoothedPitchCents[center] = smoothed;
    }
  }
  return smoothedPitchCents;
}

function hzToCents(hz) {
  return Number.isFinite(hz) && hz > 0 ? 1200 * Math.log2(hz) : Number.NaN;
}

async function loadWavSamples(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load WAV: ${url} (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const audioBuffer = await context.decodeAudioData(bytes.slice(0));
    return {
      sampleRate: audioBuffer.sampleRate,
      samples: new Float32Array(audioBuffer.getChannelData(0)),
    };
  } finally {
    await context.close();
  }
}

function createEmptyVibratoSeries(length) {
  const hz = new Array(length).fill(null);
  const windows = new Array(length).fill(null);
  const isVibrato = new Array(length).fill(false);
  return { hz, windows, isVibrato };
}

export async function analyzeVibratoSample(audioInput = null) {
  const loaded =
    typeof audioInput === "string"
      ? await loadWavSamples(audioInput)
      : (audioInput ?? (await loadWavSamples(AUDIO_PATH)));
  const { sampleRate, samples } = loaded;
  const hopSamples = Math.max(1, Math.round(sampleRate / DISPLAY_SAMPLES_PER_SECOND));
  const windowCount = Math.max(0, Math.floor((samples.length - FFT_SIZE) / hopSamples) + 1);

  const getWindowSpectrum = await createWindowSpectrumComputer({
    samples,
    sampleRate,
    binCount: FFT_BIN_COUNT,
    windowSize: FFT_SIZE,
    hopSamples,
    windowCount,
  });

  const timeSec = new Array(windowCount);
  const pitchHz = new Array(windowCount);
  const pitchCents = new Array(windowCount);

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const magnitudes = getWindowSpectrum(windowIndex);
    const detection = fftBinsToPitchDetailed(magnitudes, sampleRate, MIN_PITCH_HZ, MAX_PITCH_HZ);
    const hz = Number.isFinite(detection.hz) && detection.hz > 0 ? detection.hz : Number.NaN;
    timeSec[windowIndex] = windowIndex / DISPLAY_SAMPLES_PER_SECOND;
    pitchHz[windowIndex] = hz;
    pitchCents[windowIndex] = hzToCents(hz);
  }
  const smoothedPitchCents = smoothPitchLikeApp(pitchCents);

  const autoCorrelation = createEmptyVibratoSeries(windowCount);
  const zeroCrossing = createEmptyVibratoSeries(windowCount);
  const peakSpacing = createEmptyVibratoSeries(windowCount);
  const lastTwoShapePeaksRawInput = createEmptyVibratoSeries(windowCount);
  const lastTwoShapePeaksSmoothedInput = createEmptyVibratoSeries(windowCount);
  peakSpacing.spacingSamples = new Array(windowCount).fill(null);
  let lastPeakSpacingSamples = null;

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const options = {
      writeIndex: 0,
      count: windowIndex + 1,
      samplesPerSecond: DISPLAY_SAMPLES_PER_SECOND,
      minRateHz: VIBRATO_MIN_RATE_HZ,
      maxRateHz: VIBRATO_MAX_RATE_HZ,
      analysisWindowSeconds: VIBRATO_ANALYSIS_WINDOW_SECONDS,
      minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
    };
    // const autoResult = estimateTimelineVibratoRateHzAutoCorrelation(options);
    // if (autoResult) {
    //   autoCorrelation.hz[windowIndex] = autoResult.rateHz;
    //   autoCorrelation.windows[windowIndex] = {
    //     startSec: Math.max(0, timeSec[windowIndex] - (autoResult.windowSamples / DISPLAY_SAMPLES_PER_SECOND)),
    //     endSec: timeSec[windowIndex],
    //   };
    // }

    const zeroResult = estimateTimelineVibratoRateHzZeroCrossing(options);
    if (zeroResult) {
      zeroCrossing.hz[windowIndex] = zeroResult.rateHz;
      zeroCrossing.windows[windowIndex] = {
        startSec: Math.max(
          0,
          timeSec[windowIndex] - zeroResult.windowSamples / DISPLAY_SAMPLES_PER_SECOND,
        ),
        endSec: timeSec[windowIndex],
      };
    }

    const peakResult = estimateTimelineVibratoRateHzPeakSpacing({
      ...options,
      values: smoothedPitchCents,
      analysisWindowSeconds: VIBRATO_BASELINE_WINDOW_SECONDS,
      previousSpacingSamples: lastPeakSpacingSamples,
    });
    if (peakResult) {
      peakSpacing.hz[windowIndex] = peakResult.rateHz;
      peakSpacing.spacingSamples[windowIndex] =
        peakResult.methodDebug?.chosenSpacingSamples ?? null;
      peakSpacing.windows[windowIndex] = {
        startSec: Math.max(
          0,
          timeSec[windowIndex] - peakResult.windowSamples / DISPLAY_SAMPLES_PER_SECOND,
        ),
        endSec: timeSec[windowIndex],
      };
      lastPeakSpacingSamples =
        peakResult.methodDebug?.chosenSpacingSamples ?? lastPeakSpacingSamples;
    }

    const rawShapePeakResult = estimateTimelineVibratoRateHzLastTwoShapePeaks({
      ...options,
      values: pitchCents,
      analysisWindowSeconds: VIBRATO_BASELINE_WINDOW_SECONDS,
    });
    lastTwoShapePeaksRawInput.isVibrato[windowIndex] = rawShapePeakResult !== null;
    if (rawShapePeakResult) {
      lastTwoShapePeaksRawInput.hz[windowIndex] = rawShapePeakResult.rateHz;
      lastTwoShapePeaksRawInput.windows[windowIndex] = {
        startSec: Math.max(
          0,
          timeSec[windowIndex] - rawShapePeakResult.windowSamples / DISPLAY_SAMPLES_PER_SECOND,
        ),
        endSec: timeSec[windowIndex],
      };
    }

    const smoothedShapePeakResult = estimateTimelineVibratoRateHzLastTwoShapePeaks({
      ...options,
      values: smoothedPitchCents,
      analysisWindowSeconds: VIBRATO_BASELINE_WINDOW_SECONDS,
    });
    lastTwoShapePeaksSmoothedInput.isVibrato[windowIndex] = smoothedShapePeakResult !== null;
    if (smoothedShapePeakResult) {
      lastTwoShapePeaksSmoothedInput.hz[windowIndex] = smoothedShapePeakResult.rateHz;
      lastTwoShapePeaksSmoothedInput.windows[windowIndex] = {
        startSec: Math.max(
          0,
          timeSec[windowIndex] - smoothedShapePeakResult.windowSamples / DISPLAY_SAMPLES_PER_SECOND,
        ),
        endSec: timeSec[windowIndex],
      };
    }
  }

  return {
    sourceFile: AUDIO_PATH,
    sampleRate,
    samplesPerSecond: DISPLAY_SAMPLES_PER_SECOND,
    timeSec,
    pitchHz,
    pitchCents,
    smoothedPitchCents,
    vibrato: {
      autoCorrelation,
      zeroCrossing,
      peakSpacing,
      lastTwoShapePeaks: lastTwoShapePeaksSmoothedInput,
      lastTwoShapePeaksRawInput,
      lastTwoShapePeaksSmoothedInput,
    },
  };
}

function findLatestFiniteValue(values, maxIndexInclusive) {
  if (!Array.isArray(values)) return null;
  for (let i = maxIndexInclusive; i >= 0; i -= 1) {
    const value = values[i];
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function runPeakSpacingDebugAtIndex(result, windowIndex, debugContext = "manual click") {
  if (!Number.isInteger(windowIndex) || windowIndex < 0 || windowIndex >= result.timeSec.length) {
    console.log("[vibrato:peak-spacing] debug index out of range", {
      debugContext,
      windowIndex,
      maxIndex: result.timeSec.length - 1,
    });
    return null;
  }
  const response = estimateTimelineVibratoRateHzPeakSpacing({
    values: result.smoothedPitchCents ?? result.pitchCents,
    writeIndex: 0,
    count: windowIndex + 1,
    samplesPerSecond: result.samplesPerSecond,
    minRateHz: VIBRATO_MIN_RATE_HZ,
    maxRateHz: VIBRATO_MAX_RATE_HZ,
    analysisWindowSeconds: VIBRATO_BASELINE_WINDOW_SECONDS,
    minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
    previousSpacingSamples: findLatestFiniteValue(
      result.vibrato?.peakSpacing?.spacingSamples,
      windowIndex - 1,
    ),
    debugContext: `${debugContext}, index=${windowIndex}, timeSec=${result.timeSec[windowIndex]}`,
  });
  const selectedPeakIndicesRelative = response?.methodDebug?.selectedPeakIndices ?? [];
  const selectedPeakTimelineIndices = selectedPeakIndicesRelative.map(
    (peakIndex) => (response?.tailStartIndex ?? 0) + peakIndex,
  );
  console.log("[vibrato:peak-spacing] debug run result", {
    debugContext,
    windowIndex,
    timeSec: result.timeSec[windowIndex],
    response,
    selectedPeakTimelineIndices,
  });
  return response
    ? {
        ...response,
        selectedPeakTimelineIndices,
      }
    : null;
}

export function runLastTwoShapePeaksDebugAtIndex(
  result,
  windowIndex,
  debugContext = "manual click",
) {
  if (!Number.isInteger(windowIndex) || windowIndex < 0 || windowIndex >= result.timeSec.length) {
    console.log("[vibrato:last-two-shape-peaks] debug index out of range", {
      debugContext,
      windowIndex,
      maxIndex: result.timeSec.length - 1,
    });
    return null;
  }
  const response = estimateTimelineVibratoRateHzLastTwoShapePeaks({
    values: result.smoothedPitchCents ?? result.pitchCents,
    writeIndex: 0,
    count: windowIndex + 1,
    samplesPerSecond: result.samplesPerSecond,
    minRateHz: VIBRATO_MIN_RATE_HZ,
    maxRateHz: VIBRATO_MAX_RATE_HZ,
    analysisWindowSeconds: VIBRATO_BASELINE_WINDOW_SECONDS,
    minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
    debugLogging: false,
    debugContext: `${debugContext}, index=${windowIndex}, timeSec=${result.timeSec[windowIndex]}`,
  });
  const selectedPeakIndicesRelative = response?.methodDebug?.selectedPeakIndices ?? [];
  const selectedPeakTimelineIndices = selectedPeakIndicesRelative.map(
    (peakIndex) => (response?.tailStartIndex ?? 0) + peakIndex,
  );
  console.log({
    debugContext,
    windowIndex,
    timeSec: result.timeSec[windowIndex],
    rateHz: response?.rateHz ?? null,
    rangeCents: response?.methodDebug?.rangeCents ?? null,
    selectedFeatureType: response?.methodDebug?.selectedFeatureType ?? null,
    selectedPeakTimelineIndices,
  });
  return response
    ? {
        ...response,
        selectedPeakTimelineIndices,
      }
    : null;
}

export function getPeakSpacingWindowPreviewForIndex(result, windowIndex) {
  if (!Number.isInteger(windowIndex) || windowIndex < 0 || windowIndex >= result.timeSec.length) {
    return null;
  }
  const maxWindowSamples = Math.max(
    1,
    Math.floor(result.samplesPerSecond * VIBRATO_BASELINE_WINDOW_SECONDS),
  );
  const tailStartIndex = Math.max(0, windowIndex - maxWindowSamples + 1);
  return {
    startSec: Math.max(0, result.timeSec[tailStartIndex] ?? 0),
    endSec: result.timeSec[windowIndex],
  };
}
