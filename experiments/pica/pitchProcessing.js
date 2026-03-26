const CLEANUP_WINDOW_SIZE = 7;
const MAX_CENTS_PER_STEP = 150;
const OUTLIER_CENTS_THRESHOLD = 1000;

function hzToCents(hz) {
  return hz > 0 ? 1200 * Math.log2(hz / 440) + 6900 : Number.NaN;
}

function centsToHz(cents) {
  return Number.isFinite(cents) ? 440 * Math.pow(2, (cents - 6900) / 1200) : Number.NaN;
}

function isFiniteCents(value) {
  return Number.isFinite(value);
}

function applyCleanup(processedPitchCents, endIndex) {
  const cleanupWindow = processedPitchCents.slice(endIndex - CLEANUP_WINDOW_SIZE + 1, endIndex + 1);
  if (cleanupWindow.length !== CLEANUP_WINDOW_SIZE) {
    throw new Error(`Expected cleanup window to contain ${CLEANUP_WINDOW_SIZE} samples`);
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
      processedPitchCents[endIndex - 5] = anchorMeanCents;
      processedPitchCents[endIndex - 4] = anchorMeanCents;
      processedPitchCents[endIndex - 3] = anchorMeanCents;
      processedPitchCents[endIndex - 2] = anchorMeanCents;
      processedPitchCents[endIndex - 1] = anchorMeanCents;
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
      processedPitchCents[endIndex - 4] = anchorMeanCents;
      processedPitchCents[endIndex - 3] = anchorMeanCents;
      processedPitchCents[endIndex - 2] = anchorMeanCents;
      processedPitchCents[endIndex - 1] = anchorMeanCents;
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
      processedPitchCents[endIndex - 3] = anchorMeanCents;
      processedPitchCents[endIndex - 2] = anchorMeanCents;
      processedPitchCents[endIndex - 1] = anchorMeanCents;
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
      processedPitchCents[endIndex - 2] = anchorMeanCents;
      processedPitchCents[endIndex - 1] = anchorMeanCents;
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
      processedPitchCents[endIndex - 1] = anchorMeanCents;
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
    processedPitchCents[endIndex - 4] = pos2 + gapStepCents;
    processedPitchCents[endIndex - 3] = pos2 + gapStepCents * 2;
    processedPitchCents[endIndex - 2] = pos2 + gapStepCents * 3;
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
    processedPitchCents[endIndex - 3] = pos3 + gapStepCents;
    processedPitchCents[endIndex - 2] = pos3 + gapStepCents * 2;
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
    processedPitchCents[endIndex - 2] = (pos4 + pos6) / 2;
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
      processedPitchCents[endIndex - 1] = Number.NaN;
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
      processedPitchCents[endIndex - 2] = Number.NaN;
      processedPitchCents[endIndex - 1] = Number.NaN;
    }
  }
}

export function postProcessPitchTrack(pitchHz) {
  const processedPitchCents = pitchHz.map(hzToCents);

  if (processedPitchCents.length < CLEANUP_WINDOW_SIZE) {
    return processedPitchCents.map(centsToHz);
  }

  for (
    let endIndex = CLEANUP_WINDOW_SIZE - 1;
    endIndex < processedPitchCents.length;
    endIndex += 1
  ) {
    applyCleanup(processedPitchCents, endIndex);
  }

  return processedPitchCents.map(centsToHz);
}
