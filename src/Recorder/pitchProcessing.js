import {RingBuffer} from "./ringBuffer.js";
import {estimateTimelineVibratoRate} from "./Vibrato/vibratoTools.js";

const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];
const ANCHOR_MAX_DIFF_CENTS = 400;
const OCTAVE_OUTLIER_CENTS_THRESHOLD = 1000;

function applyAnchorOutlierCorrectionAtWrite(processingState) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < 5) return;

  const leftAnchorCents = rawPitchCentsRing.at(-5);
  const rightAnchorCents = rawPitchCentsRing.at(-1);
  const centerCents = rawPitchCentsRing.at(-3);
  if (!Number.isFinite(leftAnchorCents) || !Number.isFinite(rightAnchorCents) || !Number.isFinite(centerCents)) return;
  if (Math.abs(leftAnchorCents - rightAnchorCents) > ANCHOR_MAX_DIFF_CENTS) return;

  const anchorMeanCents = (leftAnchorCents + rightAnchorCents) / 2;
  // 1200 cents is one octave up/down; this catches near-octave-sized pitch jumps.
  if (Math.abs(centerCents - anchorMeanCents) <= OCTAVE_OUTLIER_CENTS_THRESHOLD) return;

  const correctedCenterCents = anchorMeanCents;
  rawPitchCentsRing.setAt(-3, correctedCenterCents);
  processingState.smoothedPitchCentsRing.setAt(-3, correctedCenterCents);
}

function updateDisplaySmoothingAtWrite(processingState) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < (SMOOTH_RADIUS * 2) + 1) return;

  let smoothed = 0;
  for (let offset = -SMOOTH_RADIUS; offset <= SMOOTH_RADIUS; offset += 1) {
    const sample = rawPitchCentsRing.at(-(SMOOTH_RADIUS - offset + 1));
    if (!Number.isFinite(sample)) {
      return;
    }
    smoothed += sample * SMOOTH_KERNEL[offset + SMOOTH_RADIUS];
  }
  processingState.smoothedPitchCentsRing.setAt(-(SMOOTH_RADIUS + 1), smoothed);
}

export function createPitchProcessingState({
  columnRateHz,
  seconds,
  silencePauseStepThreshold,
}) {
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
    silentStepCount: 0,
    silencePaused: false,
    diagnostics: {
      totalTickCount: 0,
    },
  };
}

function pushPitchValue(processingState, value, lineStrength) {
  processingState.rawPitchCentsRing.push(value);
  processingState.smoothedPitchCentsRing.push(value);
  processingState.lineStrengthRing.push(lineStrength);
  processingState.vibratoRateHzRing.push(Number.NaN);
  applyAnchorOutlierCorrectionAtWrite(processingState);
  updateDisplaySmoothingAtWrite(processingState);
  const estimatedRateNow = estimateTimelineVibratoRate({
    ring: processingState.smoothedPitchCentsRing,
    samplesPerSecond: processingState.columnRateHz,
  });
  processingState.vibratoRateHzRing.setAt(-1, estimatedRateNow ?? Number.NaN);
}

export function processPitchSample(processingState, {
  cents,
  lineStrength = Number.NaN,
  hasSignal = Number.isFinite(cents),
  autoPauseOnSilence = true,
}) {
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
    return {steps: 0, paused: true};
  }

  const hasPitch = Number.isFinite(cents);
  const value = hasPitch ? cents : Number.NaN;
  const nextLineStrength = hasPitch ? lineStrength : Number.NaN;
  pushPitchValue(processingState, value, nextLineStrength);
  return {steps: 1, paused: false};
}

export function resizePitchProcessingState(processingState, nextLength) {
  if (!processingState) return;
  processingState.rawPitchCentsRing.resize(nextLength);
  processingState.smoothedPitchCentsRing.resize(nextLength);
  processingState.lineStrengthRing.resize(nextLength);
  processingState.vibratoRateHzRing.resize(nextLength);
}
