import { RingBuffer } from "./ringBuffer.js";
import { estimateTimelineVibratoRate } from "./Vibrato/vibratoTools.js";

const CLEANUP_WINDOW_SIZE = 7;
const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];
const MAX_CENTS_PER_STEP = 150; // Our biggest span is 6 -> 900 cents
const OUTLIER_CENTS_THRESHOLD = 1000;

function isFiniteCents(value) {
  return Number.isFinite(value);
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
    cleanupWindow: new Float32Array(CLEANUP_WINDOW_SIZE),
    silentStepCount: 0,
    silencePaused: false,
    diagnostics: {
      totalTickCount: 0,
    },
  };
}

function setCleanupSample(processingState, cleanupWindow, cleanupWindowIndex, cents) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  const ringIndex = cleanupWindowIndex - cleanupWindow.length;
  rawPitchCentsRing.setAt(ringIndex, cents);
  processingState.smoothedPitchCentsRing.setAt(ringIndex, cents);
  cleanupWindow[cleanupWindowIndex] = cents;
}

function adjustOutliers(processingState) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < CLEANUP_WINDOW_SIZE) return;

  const cleanupWindow = processingState.cleanupWindow;
  for (let i = 0; i < cleanupWindow.length; i += 1) {
    cleanupWindow[i] = rawPitchCentsRing.at(i - cleanupWindow.length);
  }

  const [pos1, pos2, pos3, pos4, pos5, pos6, pos7] = cleanupWindow;

  // Symbols: A=Anchor, O=Outlier, R=Replacement, N=NaN, .=ignored
  // 5 outliers in last 7
  // In:  [A O O O O O A]
  //         ↓ ↓ ↓ ↓ ↓
  // Out: [A R R R R R A]
  if (
    isFiniteCents(pos1) &&
    isFiniteCents(pos2) &&
    isFiniteCents(pos3) &&
    isFiniteCents(pos4) &&
    isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    isFiniteCents(pos7)
  ) {
    const anchorSpanCents = Math.abs(pos1 - pos7);
    const anchorMeanCents = (pos1 + pos7) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP * 6 &&
      Math.abs(pos2 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos3 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos4 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos5 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 1, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 2, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 3, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 4, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 5, anchorMeanCents);
      return;
    }
  }

  // 4 outliers in last 6
  // In:  [. A O O O O A]
  //           ↓ ↓ ↓ ↓
  // Out: [. A R R R R A]
  if (
    isFiniteCents(pos2) &&
    isFiniteCents(pos3) &&
    isFiniteCents(pos4) &&
    isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    isFiniteCents(pos7)
  ) {
    const anchorSpanCents = Math.abs(pos2 - pos7);
    const anchorMeanCents = (pos2 + pos7) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP * 5 &&
      Math.abs(pos3 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos4 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos5 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 2, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 3, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 4, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 5, anchorMeanCents);
      return;
    }
  }

  // 3 outliers in last 5
  // In:  [. . A O O O A]
  //             ↓ ↓ ↓
  // Out: [. . A R R R A]
  if (
    isFiniteCents(pos3) &&
    isFiniteCents(pos4) &&
    isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    isFiniteCents(pos7)
  ) {
    const anchorSpanCents = Math.abs(pos3 - pos7);
    const anchorMeanCents = (pos3 + pos7) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP * 4 &&
      Math.abs(pos4 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos5 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 3, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 4, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 5, anchorMeanCents);
      return;
    }
  }

  // 2 outliers in last 4
  // In:  [. . . A O O A]
  //               ↓ ↓
  // Out: [. . . A R R A]
  if (isFiniteCents(pos4) && isFiniteCents(pos5) && isFiniteCents(pos6) && isFiniteCents(pos7)) {
    const anchorSpanCents = Math.abs(pos4 - pos7);
    const anchorMeanCents = (pos4 + pos7) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP * 3 &&
      Math.abs(pos5 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 4, anchorMeanCents);
      setCleanupSample(processingState, cleanupWindow, 5, anchorMeanCents);
      return;
    }
  }

  // 1 outlier in midpoint of last 3
  // In:  [. . . . A O A]
  //                 ↓
  // Out: [. . . . A R A]
  if (isFiniteCents(pos5) && isFiniteCents(pos6) && isFiniteCents(pos7)) {
    const anchorSpanCents = Math.abs(pos5 - pos7);
    const anchorMeanCents = (pos5 + pos7) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP * 2 &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 5, anchorMeanCents);
      return;
    }
  }

  // 3 NaNs in last 7
  // In:  [A A N N N A A]
  //           ↓ ↓ ↓
  // Out: [A A R R R A A]
  if (
    isFiniteCents(pos1) &&
    isFiniteCents(pos2) &&
    !isFiniteCents(pos3) &&
    !isFiniteCents(pos4) &&
    !isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    isFiniteCents(pos7)
  ) {
    const gapStepCents = (pos6 - pos2) / 4;
    setCleanupSample(processingState, cleanupWindow, 2, pos2 + gapStepCents);
    setCleanupSample(processingState, cleanupWindow, 3, pos2 + gapStepCents * 2);
    setCleanupSample(processingState, cleanupWindow, 4, pos2 + gapStepCents * 3);
    return;
  }

  // 2 NaNs in last 6
  // In:  [. A A N N A A]
  //             ↓ ↓
  // Out: [. A A R R A A]
  if (
    isFiniteCents(pos2) &&
    isFiniteCents(pos3) &&
    !isFiniteCents(pos4) &&
    !isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    isFiniteCents(pos7)
  ) {
    const gapStepCents = (pos6 - pos3) / 3;
    setCleanupSample(processingState, cleanupWindow, 3, pos3 + gapStepCents);
    setCleanupSample(processingState, cleanupWindow, 4, pos3 + gapStepCents * 2);
    return;
  }

  // 1 NaN in last 5
  // In:  [. . A A N A A]
  //               ↓
  // Out: [. . A A R A A]
  if (
    isFiniteCents(pos3) &&
    isFiniteCents(pos4) &&
    !isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    isFiniteCents(pos7)
  ) {
    setCleanupSample(processingState, cleanupWindow, 4, (pos4 + pos6) / 2);
    return;
  }

  // end-pos 1 outlier
  // In:  [. . . A A O N]
  //                 ↓
  // Out: [. . . A A N N]
  if (isFiniteCents(pos4) && isFiniteCents(pos5) && isFiniteCents(pos6) && !isFiniteCents(pos7)) {
    const anchorSpanCents = Math.abs(pos4 - pos5);
    const anchorMeanCents = (pos4 + pos5) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 5, Number.NaN);
      return;
    }
  }

  // end-pos 2 outliers
  // In:  [. . A A O O N]
  //               ↓ ↓
  // Out: [. . A A N N N]
  if (
    isFiniteCents(pos3) &&
    isFiniteCents(pos4) &&
    isFiniteCents(pos5) &&
    isFiniteCents(pos6) &&
    !isFiniteCents(pos7)
  ) {
    const anchorSpanCents = Math.abs(pos3 - pos4);
    const anchorMeanCents = (pos3 + pos4) / 2;
    if (
      anchorSpanCents <= MAX_CENTS_PER_STEP &&
      Math.abs(pos5 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD &&
      Math.abs(pos6 - anchorMeanCents) > OUTLIER_CENTS_THRESHOLD
    ) {
      setCleanupSample(processingState, cleanupWindow, 4, Number.NaN);
      setCleanupSample(processingState, cleanupWindow, 5, Number.NaN);
    }
  }
}

function smooth(processingState) {
  const rawPitchCentsRing = processingState.rawPitchCentsRing;
  if (rawPitchCentsRing.sampleCount < CLEANUP_WINDOW_SIZE) return;

  const cleanupWindow = processingState.cleanupWindow;
  for (let i = 0; i < cleanupWindow.length; i += 1) {
    cleanupWindow[i] = rawPitchCentsRing.at(i - cleanupWindow.length);
  }

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
  adjustOutliers(processingState);
  smooth(processingState);
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
