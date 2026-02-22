import colors from "tailwindcss/colors";
import {clamp, getColorPalette} from "../tools.js";

export const PITCH_LINE_COLOR_MODES = [
  {value: "blue", label: "Blue"},
  {value: "orange", label: "Orange"},
  {value: "green", label: "Green"},
  {value: "cool", label: "Cool"},
  {value: "autumn", label: "Autumn"},
  {value: "terrain", label: "Terrain"},
  {value: "gist_rainbow", label: "Gist Rainbow"},
  {value: "inferno", label: "Inferno"},
];

const WAVEFORM_COLOR_MODE_SET = new Set(PITCH_LINE_COLOR_MODES.map((item) => item.value));
const MIN_WAVEFORM_COLOR_INDEX = 36;
const DEFAULT_PITCH_LINE_COLOR_MODE = "terrain";
const paletteByMode = new Map();
const colorStringsByMode = new Map();
const FIXED_COLOR_BY_MODE = {
  blue: colors.blue[400],
  orange: colors.orange[400],
  green: colors.green[400],
};

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
  return WAVEFORM_COLOR_MODE_SET.has(mode) ? mode : DEFAULT_PITCH_LINE_COLOR_MODE;
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
  if (resolved === "inferno") {
    palette = getColorPalette();
  } else if (resolved === "cool") {
    palette = createPaletteFromStops([
      [0, 1, 1],
      [1, 0, 1],
    ]);
  } else if (resolved === "autumn") {
    palette = createPaletteFromStops([
      [1, 0, 0],
      [1, 1, 0],
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

function getColorStringsForMode(mode) {
  const resolved = resolvePitchLineColorMode(mode);
  if (isFixedColorMode(resolved)) return null;
  if (colorStringsByMode.has(resolved)) {
    return colorStringsByMode.get(resolved);
  }
  const palette = getPaletteForMode(resolved);
  const colors = Array.from({length: 256}, (_, index) => {
    const offset = index * 3;
    return `rgb(${palette[offset]}, ${palette[offset + 1]}, ${palette[offset + 2]})`;
  });
  colorStringsByMode.set(resolved, colors);
  return colors;
}

function mapWaveformLevelToNormalized(level) {
  if (!Number.isFinite(level)) return Number.NaN;
  return clamp(level, 0, 1);
}

function mapWaveformLevelToPaletteIndex(level, mode = DEFAULT_PITCH_LINE_COLOR_MODE) {
  if (isFixedColorMode(resolvePitchLineColorMode(mode))) return null;
  const normalized = mapWaveformLevelToNormalized(level);
  if (!Number.isFinite(normalized)) return null;
  return clamp(
      Math.round(MIN_WAVEFORM_COLOR_INDEX + normalized * (255 - MIN_WAVEFORM_COLOR_INDEX)),
      MIN_WAVEFORM_COLOR_INDEX,
      255
  );
}

export function mapWaveformLevelToStrokeColor(
    level,
    fallbackColor,
    mode = DEFAULT_PITCH_LINE_COLOR_MODE
) {
  const resolved = resolvePitchLineColorMode(mode);
  if (isFixedColorMode(resolved)) return FIXED_COLOR_BY_MODE[resolved] ?? fallbackColor;
  const colorIndex = mapWaveformLevelToPaletteIndex(level, resolved);
  if (colorIndex === null) return fallbackColor;
  return getColorStringsForMode(resolved)[colorIndex];
}
