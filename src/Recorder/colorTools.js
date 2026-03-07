import colors from "tailwindcss/colors";
import { clamp } from "../tools.js";

export const PITCH_LINE_COLOR_MODES = [
  { value: "terrain", label: "Terrain" },
  { value: "gist_rainbow", label: "Gist Rainbow" },
  { value: "cool", label: "Cool" },
  { value: "autumn", label: "Autumn" },
  { value: "blue", label: "Blue" },
  { value: "orange", label: "Orange" },
  { value: "green", label: "Green" },
];

const WAVEFORM_COLOR_MODE_SET = new Set(PITCH_LINE_COLOR_MODES.map((item) => item.value));
const MIN_WAVEFORM_COLOR_INDEX = 36;
const PITCH_LINE_COLOR_MODE_DEFAULT = "terrain";
const paletteByMode = new Map();
const colorStringsByMode = new Map();
const FIXED_COLOR_BY_MODE = {
  blue: colorStringToRgb(colors.blue[400]),
  orange: colorStringToRgb(colors.orange[400]),
  green: colorStringToRgb(colors.green[400]),
};

function colorStringToRgb(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [red, green, blue] = ctx.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

function createPaletteFromStops(stops) {
  const palette = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const scaled = t * (stops.length - 1);
    const leftIndex = Math.floor(scaled);
    const rightIndex = Math.min(stops.length - 1, leftIndex + 1);
    const mix = scaled - leftIndex;
    const left = stops[leftIndex];
    const right = stops[rightIndex];
    const base = i * 3;
    palette[base] = Math.round((left[0] + (right[0] - left[0]) * mix) * 255);
    palette[base + 1] = Math.round((left[1] + (right[1] - left[1]) * mix) * 255);
    palette[base + 2] = Math.round((left[2] + (right[2] - left[2]) * mix) * 255);
  }
  return palette;
}

function resolvePitchLineColorMode(mode) {
  return WAVEFORM_COLOR_MODE_SET.has(mode) ? mode : PITCH_LINE_COLOR_MODE_DEFAULT;
}

function isFixedColorMode(mode) {
  return Object.hasOwn(FIXED_COLOR_BY_MODE, mode);
}

function getPaletteForMode(mode) {
  const resolved = resolvePitchLineColorMode(mode);
  if (isFixedColorMode(resolved)) return null;
  if (paletteByMode.has(resolved)) {
    return paletteByMode.get(resolved);
  }

  let palette;
  if (resolved === "cool") {
    palette = createPaletteFromStops([
      [0, 1, 1],
      [1, 0, 1],
    ]);
  } else if (resolved === "autumn") {
    palette = createPaletteFromStops([
      [1, 1, 0],
      [1, 0, 0],
    ]);
  } else if (resolved === "gist_rainbow") {
    palette = createPaletteFromStops([
      [1, 0, 0],
      [1, 0.5, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
      [1, 0, 1],
    ]);
  } else {
    // Approximate matplotlib "terrain" stops (RGB in 0..1).
    palette = createPaletteFromStops([
      [0.2, 0.2, 0.6],
      [0.0, 0.6, 1.0],
      [0.2, 0.8, 0.4],
      [0.8, 0.8, 0.3],
      [0.6, 0.45, 0.3],
      [0.95, 0.95, 0.95],
    ]);
  }
  paletteByMode.set(resolved, palette);
  return palette;
}

function scaleRgb(rgb, brightness) {
  return [
    Math.round(rgb[0] * brightness),
    Math.round(rgb[1] * brightness),
    Math.round(rgb[2] * brightness),
  ];
}

function rgbToString(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function mapWaveformIntensityToNormalized(intensity) {
  if (!Number.isFinite(intensity)) return Number.NaN;
  return clamp(intensity, 0, 1);
}

function mapWaveformIntensityToPaletteIndex(intensity, mode) {
  if (isFixedColorMode(resolvePitchLineColorMode(mode))) return null;
  const normalized = mapWaveformIntensityToNormalized(intensity);
  if (!Number.isFinite(normalized)) return null;
  return clamp(
    Math.round(MIN_WAVEFORM_COLOR_INDEX + normalized * (255 - MIN_WAVEFORM_COLOR_INDEX)),
    MIN_WAVEFORM_COLOR_INDEX,
    255,
  );
}

export function mapWaveformIntensityToStrokeColor(intensity, fallbackColor, mode, brightness = 1) {
  const resolved = resolvePitchLineColorMode(mode);
  const clampedBrightness = clamp(brightness, 0, 1);
  if (isFixedColorMode(resolved)) {
    return rgbToString(
      scaleRgb(FIXED_COLOR_BY_MODE[resolved], clampedBrightness),
    );
  }
  const colorIndex = mapWaveformIntensityToPaletteIndex(intensity, resolved);
  if (colorIndex === null) {
    return rgbToString(scaleRgb(colorStringToRgb(fallbackColor), clampedBrightness));
  }
  const cacheKey = `${resolved}:${clampedBrightness}`;
  if (!colorStringsByMode.has(cacheKey)) {
    const palette = getPaletteForMode(resolved);
    colorStringsByMode.set(
      cacheKey,
      Array.from({ length: 256 }, (_, index) => {
        const offset = index * 3;
        return rgbToString([
          Math.round(palette[offset] * clampedBrightness),
          Math.round(palette[offset + 1] * clampedBrightness),
          Math.round(palette[offset + 2] * clampedBrightness),
        ]);
      }),
    );
  }
  return colorStringsByMode.get(cacheKey)[colorIndex];
}
