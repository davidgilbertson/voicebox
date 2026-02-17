const KERNEL_7 = [0.015625, 0.09375, 0.234375, 0.3125, 0.234375, 0.09375, 0.015625];
const RADIUS = 3;
const BLEND = 1;

function smoothFiniteRun(values, indices, start, end, output) {
  for (let point = start + RADIUS; point <= end - RADIUS; point += 1) {
    let smoothed = 0;
    for (let i = -RADIUS; i <= RADIUS; i += 1) {
      smoothed += values[indices[point + i]] * KERNEL_7[i + RADIUS];
    }
    const current = values[indices[point]];
    output[indices[point]] = current + (smoothed - current) * BLEND;
  }
}

export function smoothDisplayTimeline(
    {values, writeIndex, count},
    {output} = {}
) {
  if (!values || values.length === 0) return values;
  const length = values.length;
  if (!output || output.length !== length) {
    output = new Float32Array(length);
  }
  output.set(values);
  if (count < (RADIUS * 2) + 1) return output;

  const firstIndex = count === length ? writeIndex : 0;
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    indices[i] = (firstIndex + i) % length;
  }

  let runStart = -1;
  for (let i = 0; i < count; i += 1) {
    const value = values[indices[i]];
    if (Number.isFinite(value)) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      smoothFiniteRun(values, indices, runStart, i - 1, output);
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    smoothFiniteRun(values, indices, runStart, count - 1, output);
  }
  return output;
}
