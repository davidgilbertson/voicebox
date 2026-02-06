// Linear interpolate between two values.
export function lerp(current, next, factor) {
  return current + (next - current) * factor;
}

// Draw grid lines at each semitone and vertical divisions.
export function drawGrid(ctx, width, height, waveRange) {
  const midY = height / 2;
  const scaleY = (height / 2) / waveRange;
  const steps = [-3, -2, -1, 0, 1, 2, 3];

  // Horizontal lines at each semitone
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const step of steps) {
    const cents = step * 100;
    const y = midY - cents * scaleY;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Vertical lines
  const gridCount = 4;
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
  ctx.beginPath();
  for (let i = 1; i < gridCount; i += 1) {
    const x = (width / gridCount) * i;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
}

// Draw semitone labels (-2..2) along the left edge.
export function drawSemitoneLabels(ctx, width, height, waveRange) {
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = "12px system-ui";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const midY = height / 2;
  const scaleY = (height / 2) / waveRange;
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  for (const step of steps) {
    const cents = step * 100;
    const y = midY - cents * scaleY;
    ctx.fillText(`${step}`, 8, y);
  }
}

// Estimate pitch via autocorrelation with basic confidence gating.
export function detectPitchAutocorr(data, sampleRate, minHz, maxHz) {
  const size = data.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) {
    const value = data[i];
    rms += value * value;
  }
  rms = Math.sqrt(rms / size);
  if (rms < 0.01) return 0;
  const energy = rms * rms * size;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i < size - lag; i += 1) {
      corr += data[i] * data[i + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (!bestLag) return 0;
  const corrRatio = energy > 0 ? bestCorr / energy : 0;
  if (corrRatio < 0.25) return 0;
  return sampleRate / bestLag;
}

// Return the median of finite, positive values.
export function median(values) {
  const filtered = values.filter((v) => Number.isFinite(v) && v > 0);
  if (!filtered.length) return 0;
  filtered.sort((a, b) => a - b);
  const mid = Math.floor(filtered.length / 2);
  if (filtered.length % 2 === 0) {
    return (filtered[mid - 1] + filtered[mid]) / 2;
  }
  return filtered[mid];
}
