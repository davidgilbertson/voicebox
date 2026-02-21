import colors from "tailwindcss/colors";

let cachedColorPalette = null;

// Linear interpolate between two values.
export function lerp(current, next, factor) {
  return current + (next - current) * factor;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getColorPalette() {
  if (cachedColorPalette) return cachedColorPalette;

  const palette = new Uint8ClampedArray(256 * 3);
  const infernoStops = [
    [0, 0, 0],
    [0.095, 0.043, 0.265],
    [0.341, 0.062, 0.429],
    [0.63, 0.17, 0.388],
    [0.895, 0.392, 0.204],
    [0.988, 0.998, 0.645],
  ];
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const scaled = t * (infernoStops.length - 1);
    const leftIndex = Math.floor(scaled);
    const rightIndex = Math.min(infernoStops.length - 1, leftIndex + 1);
    const mix = scaled - leftIndex;
    const left = infernoStops[leftIndex];
    const right = infernoStops[rightIndex];
    const base = i * 3;
    palette[base] = Math.round((left[0] + (right[0] - left[0]) * mix) * 255);
    palette[base + 1] = Math.round((left[1] + (right[1] - left[1]) * mix) * 255);
    palette[base + 2] = Math.round((left[2] + (right[2] - left[2]) * mix) * 255);
  }

  cachedColorPalette = palette;
  return cachedColorPalette;
}

export const ls = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      window.localStorage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
  },
};

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
  ctx.fillStyle = colors.slate[300];
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const plotHeight = Math.max(1, labelBottom - labelTop);
  const midY = labelTop + (plotHeight / 2);
  const scaleY = (plotHeight / 2) / waveRange;
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  for (const step of steps) {
    const cents = step * 100;
    const y = midY - cents * scaleY;
    const label = step > 0 ? `+${step}` : `${step}`;
    ctx.fillText(label, labelX, y);
  }
}
