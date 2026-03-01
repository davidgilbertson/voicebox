export function interpolateFillValues(previousValue, nextValue, steps) {
  if (steps <= 0) return [];
  if (steps === 1) return [nextValue];
  if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) {
    return Array.from({length: steps}, () => nextValue);
  }
  const values = new Array(steps);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    values[i - 1] = previousValue + (nextValue - previousValue) * t;
  }
  return values;
}
