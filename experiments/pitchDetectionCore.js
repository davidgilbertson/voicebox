export const DEFAULT_PITCH_TUNING = Object.freeze({
  maxP: 15,
  pCount: 17,
  pRefineCount: 4,
  offWeight: 1.25,
  expectedP0MinRatio: 0.05,
  expectedP0PenaltyWeight: 2,
  downwardBiasPerP: 0.02,
  searchRadiusBins: 2,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolvePitchTuning(tuning = null) {
  if (!tuning) return DEFAULT_PITCH_TUNING;
  return {
    maxP: Number.isFinite(tuning.maxP)
      ? Math.max(1, Math.floor(tuning.maxP))
      : DEFAULT_PITCH_TUNING.maxP,
    pCount: Number.isFinite(tuning.pCount)
      ? Math.max(1, Math.floor(tuning.pCount))
      : DEFAULT_PITCH_TUNING.pCount,
    pRefineCount: Number.isFinite(tuning.pRefineCount)
      ? Math.max(1, Math.floor(tuning.pRefineCount))
      : DEFAULT_PITCH_TUNING.pRefineCount,
    offWeight: Number.isFinite(tuning.offWeight)
      ? tuning.offWeight
      : DEFAULT_PITCH_TUNING.offWeight,
    expectedP0MinRatio: Number.isFinite(tuning.expectedP0MinRatio)
      ? tuning.expectedP0MinRatio
      : DEFAULT_PITCH_TUNING.expectedP0MinRatio,
    expectedP0PenaltyWeight: Number.isFinite(tuning.expectedP0PenaltyWeight)
      ? tuning.expectedP0PenaltyWeight
      : DEFAULT_PITCH_TUNING.expectedP0PenaltyWeight,
    downwardBiasPerP: Number.isFinite(tuning.downwardBiasPerP)
      ? tuning.downwardBiasPerP
      : DEFAULT_PITCH_TUNING.downwardBiasPerP,
    searchRadiusBins: Number.isFinite(tuning.searchRadiusBins)
      ? Math.max(0, Math.floor(tuning.searchRadiusBins))
      : DEFAULT_PITCH_TUNING.searchRadiusBins,
  };
}

export function detectPitchFromSpectrumDetailed(
  spectrumBins,
  sampleRate,
  { minHz, maxHz, tuning = null },
) {
  if (!spectrumBins || spectrumBins.length < 8) {
    return {
      hz: 0,
      confidence: 0,
      debug: {
        reason: "spectrum too short",
      },
    };
  }

  const nyquistBin = spectrumBins.length - 1;
  const binSizeHz = sampleRate / 2 / spectrumBins.length;
  const minBin = Math.max(1, Math.floor(minHz / binSizeHz));
  const maxBin = Math.min(nyquistBin, Math.floor(maxHz / binSizeHz));
  if (maxBin <= minBin) {
    return {
      hz: 0,
      confidence: 0,
      debug: {
        reason: "min/max bin invalid",
        minBin,
        maxBin,
      },
    };
  }

  const {
    maxP,
    pCount,
    pRefineCount,
    offWeight,
    expectedP0MinRatio,
    expectedP0PenaltyWeight,
    downwardBiasPerP,
    searchRadiusBins,
  } = resolvePitchTuning(tuning);

  function refineLocalPeakBinParabolic(binIndex) {
    const clampedBin = clamp(Math.round(binIndex), 1, nyquistBin - 1);
    const left = spectrumBins[clampedBin - 1];
    const middle = spectrumBins[clampedBin];
    const right = spectrumBins[clampedBin + 1];
    if (middle < left || middle < right) {
      return clampedBin;
    }
    const denominator = left - 2 * middle + right;
    if (!Number.isFinite(denominator) || denominator === 0) {
      return clampedBin;
    }
    const offset = (0.5 * (left - right)) / denominator;
    return clampedBin + clamp(offset, -1, 1);
  }

  function sampleMagnitude3Bin(binPosition) {
    if (!Number.isFinite(binPosition)) return 0;
    const centerBin = clamp(Math.round(binPosition), 1, nyquistBin - 1);
    const frac = clamp(binPosition - centerBin, -1, 1);
    const left = spectrumBins[centerBin - 1];
    const middle = spectrumBins[centerBin];
    const right = spectrumBins[centerBin + 1];
    return middle + 0.5 * frac * (right - left) + 0.5 * frac * frac * (left - 2 * middle + right);
  }

  function scoreHypothesis(f0Bin) {
    if (!Number.isFinite(f0Bin) || f0Bin < minBin || f0Bin > maxBin) {
      return { score: Number.NEGATIVE_INFINITY, p0Magnitude: 0 };
    }
    let score = 0;
    let p0Magnitude = 0;
    for (let p = 1; p <= pCount; p += 1) {
      const pBin = f0Bin * p;
      if (pBin < minBin || pBin > maxBin) break;
      const onMagnitude = sampleMagnitude3Bin(pBin);
      if (p === 1) p0Magnitude = onMagnitude;
      const offBin = f0Bin * (p + 0.5);
      const offMagnitude = offBin >= minBin && offBin <= maxBin ? sampleMagnitude3Bin(offBin) : 0;
      score += onMagnitude - offWeight * offMagnitude;
    }
    return { score, p0Magnitude };
  }

  function findTopSeedPeak() {
    const localPeaks = [];
    for (let bin = minBin + 1; bin < maxBin; bin += 1) {
      const left = spectrumBins[bin - 1];
      const center = spectrumBins[bin];
      const right = spectrumBins[bin + 1];
      if (!(center >= left && center > right)) continue;
      localPeaks.push({ bin, magnitude: center });
    }
    localPeaks.sort((a, b) => b.magnitude - a.magnitude);
    return localPeaks[0] ?? null;
  }

  let strongestPeakBin = minBin;
  let strongestPeakMagnitude = Number.NEGATIVE_INFINITY;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (spectrumBins[bin] > strongestPeakMagnitude) {
      strongestPeakMagnitude = spectrumBins[bin];
      strongestPeakBin = bin;
    }
  }

  const seedPeak = findTopSeedPeak();
  if (!seedPeak) {
    return {
      hz: 0,
      confidence: 0,
      debug: {
        reason: "no local seed peak",
        tuning: {
          maxP,
          pCount,
          pRefineCount,
          offWeight,
          expectedP0MinRatio,
          expectedP0PenaltyWeight,
          downwardBiasPerP,
          searchRadiusBins,
        },
        strongestPeakBin,
        strongestPeakMagnitude,
        seedPeakBins: [],
      },
    };
  }
  const seedPeaks = [seedPeak];

  const individualHypotheses = [];
  for (let p = 1; p <= maxP; p += 1) {
    const f0Bin = seedPeak.bin / p;
    if (f0Bin < minBin || f0Bin > maxBin) continue;
    const { score, p0Magnitude } = scoreHypothesis(f0Bin);
    let hypothesisScore = score;
    if (p > 1) {
      const expectedP0Magnitude = seedPeak.magnitude * expectedP0MinRatio;
      const p0Deficit = Math.max(0, expectedP0Magnitude - p0Magnitude);
      hypothesisScore -= p0Deficit * expectedP0PenaltyWeight;
    }
    hypothesisScore -= p * downwardBiasPerP;
    individualHypotheses.push({
      sourcePeakBin: seedPeak.bin,
      p,
      f0Bin,
      rawScore: score,
      p0Magnitude,
      hypothesisScore,
    });
  }

  const hypothesisScores = [...individualHypotheses].sort(
    (a, b) => b.hypothesisScore - a.hypothesisScore,
  );
  const bestContributor = hypothesisScores[0] ?? null;
  const bestP = bestContributor?.p ?? 1;
  const bestF0Bin = bestContributor?.f0Bin ?? seedPeak.bin;

  const selectedPartials = [];
  let weightedSum = 0;
  let totalWeight = 0;
  for (let p = 1; p <= pRefineCount; p += 1) {
    const targetBin = bestF0Bin * p;
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
    const localBaseline =
      (spectrumBins[Math.max(0, bestBin - 1)] + spectrumBins[Math.min(nyquistBin, bestBin + 1)]) /
      2;
    const peakiness = Math.max(0, bestMagnitude - localBaseline);
    const weight = bestMagnitude * peakiness;
    selectedPartials.push({
      p,
      targetBin,
      selectedBin: bestBin,
      refinedPBin,
      bestMagnitude,
      peakiness,
      weight,
      f0FromPBin,
    });
    if (!(weight > 0) || !Number.isFinite(f0FromPBin)) continue;
    weightedSum += f0FromPBin * weight;
    totalWeight += weight;
  }

  const refinedF0Bin = totalWeight > 0 ? weightedSum / totalWeight : Number.NaN;
  const finalF0Bin = Number.isFinite(refinedF0Bin) ? refinedF0Bin : bestF0Bin;
  const hz = finalF0Bin * binSizeHz;
  if (!Number.isFinite(hz) || hz < minHz || hz > maxHz) {
    return {
      hz: 0,
      confidence: 0,
      debug: {
        reason: "final hz out of range",
        tuning: {
          maxP,
          pCount,
          pRefineCount,
          offWeight,
          expectedP0MinRatio,
          expectedP0PenaltyWeight,
          downwardBiasPerP,
          searchRadiusBins,
        },
        seedPeakBins: seedPeaks.map((item) => item.bin),
        winningSourcePeakBin: bestContributor?.sourcePeakBin ?? null,
        individualHypotheses,
        strongestPeakBin,
        strongestPeakMagnitude,
        bestP,
        bestF0Bin,
        refinedF0Bin,
        finalF0Bin,
        hz,
        selectedPartials,
        hypothesisScores,
      },
    };
  }

  return {
    hz,
    confidence: clamp(strongestPeakMagnitude, 0, 1),
    debug: {
      reason: "ok",
      tuning: {
        maxP,
        pCount,
        pRefineCount,
        offWeight,
        expectedP0MinRatio,
        expectedP0PenaltyWeight,
        downwardBiasPerP,
        searchRadiusBins,
      },
      binSizeHz,
      seedPeakBins: seedPeaks.map((item) => item.bin),
      winningSourcePeakBin: bestContributor?.sourcePeakBin ?? null,
      individualHypotheses,
      strongestPeakBin,
      strongestPeakHz: strongestPeakBin * binSizeHz,
      strongestPeakMagnitude,
      bestP,
      bestF0Bin,
      bestF0Hz: bestF0Bin * binSizeHz,
      refinedF0Bin,
      finalF0Bin,
      finalHz: hz,
      selectedPartials,
      hypothesisScores,
    },
  };
}
