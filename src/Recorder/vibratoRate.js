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
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function estimateTimelineVibratoRateHz({
  values,
  writeIndex,
  count,
  samplesPerSecond,
  minRateHz = 4,
  maxRateHz = 10,
  analysisWindowSeconds = 2.5,
  minContinuousSeconds = 0.6,
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

  let sumSquares = 0;
  const centered = new Array(tail.length);
  for (let i = 0; i < tail.length; i += 1) {
    const delta = tail[i] - mean;
    centered[i] = delta;
    sumSquares += delta * delta;
  }
  const rms = Math.sqrt(sumSquares / centered.length);
  if (rms < 5) return null;

  const crossings = [];
  const epsilon = 1e-6;
  for (let i = 1; i < centered.length; i += 1) {
    const prev = centered[i - 1];
    const next = centered[i];
    if (!(prev <= 0 && next > 0)) continue;
    const slope = next - prev;
    if (Math.abs(slope) <= epsilon) continue;
    const t = (0 - prev) / slope;
    crossings.push((i - 1) + t);
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
  if (rateHz < minRateHz || rateHz > maxRateHz) return null;
  return rateHz;
}
