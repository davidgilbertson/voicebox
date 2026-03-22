import { RingBuffer } from "./ringBuffer.js";
import { estimateTimelineVibratoRate } from "./Vibrato/vibratoTools.js";

const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];
const ANCHOR_MAX_DIFF_CENTS = 400;
const OCTAVE_OUTLIER_CENTS_THRESHOLD = 1000;
const ISLAND_MAX_JUMP_CENTS = 200;

function applyAnchorOutlierCorrectionAtWrite(processingState) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < 5) return;

  const leftAnchorCents = rawPitchCentsRing.at(-5);
  const rightAnchorCents = rawPitchCentsRing.at(-1);
  const centerCents = rawPitchCentsRing.at(-3);
  if (
    !Number.isFinite(leftAnchorCents) ||
    !Number.isFinite(rightAnchorCents) ||
    !Number.isFinite(centerCents)
  )
    return;
  if (Math.abs(leftAnchorCents - rightAnchorCents) > ANCHOR_MAX_DIFF_CENTS) return;

  const anchorMeanCents = (leftAnchorCents + rightAnchorCents) / 2;
  // 1200 cents is one octave up/down; this catches near-octave-sized pitch jumps.
  if (Math.abs(centerCents - anchorMeanCents) <= OCTAVE_OUTLIER_CENTS_THRESHOLD) return;

  // Replace near-octave center glitches with the anchor mean.
  const correctedCenterCents = anchorMeanCents;
  rawPitchCentsRing.setAt(-3, correctedCenterCents);
  processingState.smoothedPitchCentsRing.setAt(-3, correctedCenterCents);
}

export function createPitchProcessingState({ columnRateHz, seconds, silencePauseStepThreshold }) {
  const length = Math.max(1, Math.floor(columnRateHz * seconds));
  const rawPitchCentsRing = new RingBuffer(length);
  const smoothedPitchCentsRing = new RingBuffer(length);
  const lineStrengthRing = new RingBuffer(length);
  const vibratoRateHzRing = new RingBuffer(length);
  return {
    rawPitchCentsRing,
    smoothedPitchCentsRing,
    lineStrengthRing,
    vibratoRateHzRing,
    columnRateHz,
    silencePauseStepThreshold,
    cleanupWindow: new Float32Array(SMOOTH_RADIUS * 2 + 1),
    silentStepCount: 0,
    silencePaused: false,
    diagnostics: {
      totalTickCount: 0,
    },
  };
}

function runDisplayCleanupAtWrite(processingState) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < SMOOTH_RADIUS * 2 + 1) return;

  const cleanupWindow = processingState.cleanupWindow;
  for (let i = 0; i < cleanupWindow.length; i += 1) {
    cleanupWindow[i] = rawPitchCentsRing.at(i - cleanupWindow.length);
  }

  // Island detection: if the finalized center run is disconnected from both sides, drop it.
  if (Number.isFinite(cleanupWindow[SMOOTH_RADIUS])) {
    let islandStart = SMOOTH_RADIUS;
    while (islandStart > 0) {
      const nextValue = cleanupWindow[islandStart - 1];
      const currentValue = cleanupWindow[islandStart];
      if (!Number.isFinite(nextValue)) break;
      if (Math.abs(currentValue - nextValue) > ISLAND_MAX_JUMP_CENTS) break;
      islandStart -= 1;
    }

    let islandEnd = SMOOTH_RADIUS;
    while (islandEnd < cleanupWindow.length - 1) {
      const currentValue = cleanupWindow[islandEnd];
      const nextValue = cleanupWindow[islandEnd + 1];
      if (!Number.isFinite(nextValue)) break;
      if (Math.abs(currentValue - nextValue) > ISLAND_MAX_JUMP_CENTS) break;
      islandEnd += 1;
    }

    if (islandStart > 0 && islandEnd < cleanupWindow.length - 1) {
      let islandMinCents = cleanupWindow[islandStart];
      let islandMaxCents = cleanupWindow[islandStart];
      for (let i = islandStart + 1; i <= islandEnd; i += 1) {
        islandMinCents = Math.min(islandMinCents, cleanupWindow[i]);
        islandMaxCents = Math.max(islandMaxCents, cleanupWindow[i]);
      }

      let hasConnection = false;
      for (let i = 0; i < islandStart; i += 1) {
        const value = cleanupWindow[i];
        if (!Number.isFinite(value)) continue;
        if (
          value >= islandMinCents - ISLAND_MAX_JUMP_CENTS &&
          value <= islandMaxCents + ISLAND_MAX_JUMP_CENTS
        ) {
          hasConnection = true;
          break;
        }
      }

      for (let i = islandEnd + 1; i < cleanupWindow.length; i += 1) {
        const value = cleanupWindow[i];
        if (!Number.isFinite(value)) continue;
        if (
          value >= islandMinCents - ISLAND_MAX_JUMP_CENTS &&
          value <= islandMaxCents + ISLAND_MAX_JUMP_CENTS
        ) {
          hasConnection = true;
          break;
        }
      }

      if (!hasConnection) {
        for (let i = islandStart; i <= islandEnd; i += 1) {
          rawPitchCentsRing.setAt(i - cleanupWindow.length, Number.NaN);
          processingState.smoothedPitchCentsRing.setAt(i - cleanupWindow.length, Number.NaN);
          cleanupWindow[i] = Number.NaN;
        }
      }
    }
  }

  // Display smoothing: write the finalized center sample only when the whole 7-step window is valid.
  let smoothed = 0;
  for (let i = 0; i < cleanupWindow.length; i += 1) {
    const sample = cleanupWindow[i];
    if (!Number.isFinite(sample)) return;
    smoothed += sample * SMOOTH_KERNEL[i];
  }
  processingState.smoothedPitchCentsRing.setAt(-(SMOOTH_RADIUS + 1), smoothed);
}

function pushPitchValue(processingState, value, lineStrength) {
  processingState.rawPitchCentsRing.push(value);
  processingState.smoothedPitchCentsRing.push(value);
  processingState.lineStrengthRing.push(lineStrength);
  processingState.vibratoRateHzRing.push(Number.NaN);
  applyAnchorOutlierCorrectionAtWrite(processingState);
  runDisplayCleanupAtWrite(processingState);
  const estimatedRateNow = estimateTimelineVibratoRate({
    ring: processingState.smoothedPitchCentsRing,
    samplesPerSecond: processingState.columnRateHz,
  });
  processingState.vibratoRateHzRing.setAt(-1, estimatedRateNow ?? Number.NaN);
}

export function processPitchSample(
  processingState,
  {
    cents,
    lineStrength = Number.NaN,
    hasSignal = Number.isFinite(cents),
    autoPauseOnSilence = true,
  },
) {
  if (autoPauseOnSilence) {
    if (hasSignal) {
      processingState.silencePaused = false;
      processingState.silentStepCount = 0;
    } else {
      processingState.silentStepCount += 1;
    }
    if (processingState.silentStepCount >= processingState.silencePauseStepThreshold) {
      processingState.silencePaused = true;
    }
  } else {
    processingState.silencePaused = false;
    processingState.silentStepCount = 0;
  }

  processingState.diagnostics.totalTickCount += 1;

  if (processingState.silencePaused) {
    return { steps: 0, paused: true };
  }

  const hasPitch = Number.isFinite(cents);
  const value = hasPitch ? cents : Number.NaN;
  const nextLineStrength = hasPitch ? lineStrength : Number.NaN;
  pushPitchValue(processingState, value, nextLineStrength);
  return { steps: 1, paused: false };
}

export function resizePitchProcessingState(processingState, nextLength) {
  if (!processingState) return;
  processingState.rawPitchCentsRing.resize(nextLength);
  processingState.smoothedPitchCentsRing.resize(nextLength);
  processingState.lineStrengthRing.resize(nextLength);
  processingState.vibratoRateHzRing.resize(nextLength);
}
