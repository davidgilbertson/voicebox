export function consumeTimelineElapsed(elapsedMs, samplesPerSecond, accumulator) {
  if (!(elapsedMs > 0) || !(samplesPerSecond > 0)) {
    return {steps: 0, accumulator};
  }
  const budgetMs = 1000 / samplesPerSecond;
  const nextAccumulator = accumulator + elapsedMs / budgetMs;
  const steps = Math.floor(nextAccumulator + 1e-9);
  return {
    steps,
    accumulator: nextAccumulator - steps,
  };
}
