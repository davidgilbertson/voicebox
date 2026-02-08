import colors from "tailwindcss/colors";

// Linear interpolate between two values.
export function lerp(current, next, factor) {
  return current + (next - current) * factor;
}

// Draw grid lines at each semitone and vertical divisions.
export function drawGrid(ctx, width, height, waveRange, options = {}) {
  const {
    gridLeft = 0,
    gridTop = 0,
    gridBottom = height,
  } = options;
  const plotHeight = Math.max(1, gridBottom - gridTop);
  const midY = gridTop + (plotHeight / 2);
  const scaleY = (plotHeight / 2) / waveRange;
  const steps = [-3, -2, -1, 0, 1, 2, 3];

  // Horizontal lines at each semitone
  ctx.strokeStyle = colors.slate[700];
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const step of steps) {
    const cents = step * 100;
    const y = midY - cents * scaleY;
    ctx.moveTo(gridLeft, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Vertical lines
  const gridCount = 4;
  ctx.strokeStyle = colors.slate[700];
  ctx.beginPath();
  for (let i = 1; i < gridCount; i += 1) {
    const x = gridLeft + ((width - gridLeft) / gridCount) * i;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
}

// Draw semitone labels along the left edge.
export function drawSemitoneLabels(ctx, width, height, waveRange, options = {}) {
  const {
    labelX = 8,
    labelTop = 0,
    labelBottom = height,
  } = options;
  ctx.fillStyle = colors.slate[500];
  ctx.font = "12px system-ui";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const plotHeight = Math.max(1, labelBottom - labelTop);
  const midY = labelTop + (plotHeight / 2);
  const scaleY = (plotHeight / 2) / waveRange;
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  for (const step of steps) {
    const cents = step * 100;
    const y = midY - cents * scaleY;
    ctx.fillText(`${step}`, labelX, y);
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
  const correlations = new Float64Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    for (let i = 0; i < size - lag; i += 1) {
      corr += data[i] * data[i + lag];
    }
    correlations[lag] = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (!bestLag) return 0;
  const corrRatio = energy > 0 ? bestCorr / energy : 0;
  if (corrRatio < 0.25) return 0;
  // Refine the lag peak with a 3-point parabolic fit to reduce quantization.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = correlations[bestLag - 1];
    const mid = correlations[bestLag];
    const right = correlations[bestLag + 1];
    const denom = left - 2 * mid + right;
    if (denom !== 0) {
      const offset = 0.5 * (left - right) / denom;
      if (Number.isFinite(offset)) {
        refinedLag = bestLag + Math.max(-1, Math.min(1, offset));
      }
    }
  }
  if (!Number.isFinite(refinedLag) || refinedLag <= 0) return 0;
  return sampleRate / refinedLag;
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
