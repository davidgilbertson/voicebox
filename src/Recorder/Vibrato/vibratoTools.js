import colors from "tailwindcss/colors";
import {clearCanvasWithViewport, createCanvasViewportState, drawWaveformTrace, syncCanvasViewport} from "../canvasTools.js";
import {
  VIBRATO_ANALYSIS_WINDOW_SECONDS,
  VIBRATO_MIN_CONTIGUOUS_SECONDS,
  VIBRATO_RATE_MAX_HZ,
  VIBRATO_RATE_MIN_HZ,
} from "../config.js";
import {mapWaveformIntensityToStrokeColor} from "../waveformColor.js";

const WAVEFORM_LINE_COLOR = colors.blue[400];
const Y_RANGE = 405; // in cents
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 5;
const DEFAULT_CENTER_CENTS = 1200 * Math.log2(220);

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

function centeredFiniteTail({
  ring,
  samplesPerSecond,
}) {
  if (!ring || ring.sampleCount <= 0 || samplesPerSecond <= 0) return null;
  const values = ring.values();
  const maxSamples = Math.max(1, Math.floor(samplesPerSecond * VIBRATO_ANALYSIS_WINDOW_SECONDS));
  const tail = contiguousFiniteTail(values, maxSamples);
  const minSamples = Math.max(8, Math.floor(samplesPerSecond * VIBRATO_MIN_CONTIGUOUS_SECONDS));
  if (tail.length < minSamples) return null;

  let sum = 0;
  for (const value of tail) {
    sum += value;
  }
  const mean = sum / tail.length;

  const centered = new Array(tail.length);
  let sumSquares = 0;
  for (let i = 0; i < tail.length; i += 1) {
    const delta = tail[i] - mean;
    centered[i] = delta;
    sumSquares += delta * delta;
  }
  const rms = Math.sqrt(sumSquares / centered.length);
  return {
    centered,
    rms,
  };
}

function rateFromLastTwoPeaks(centered, samplesPerSecond) {
  if (!centered || centered.length < 5) return null;
  // Keep slope probe aligned with the first extrema candidate index (length - 3).
  let expectedType = centered[centered.length - 2] - centered[centered.length - 3] >= 0 ? "trough" : "peak";
  const extrema = [];
  let peakCount = 0;
  let troughCount = 0;
  let index = centered.length - 3;
  while (index >= 2 && (peakCount < 2 || troughCount < 2)) {
    const left2 = centered[index - 2];
    const left1 = centered[index - 1];
    const value = centered[index];
    const right1 = centered[index + 1];
    const right2 = centered[index + 2];
    if (expectedType === "trough") {
      const isTrough = value <= left2
          && value <= left1
          && value <= right1
          && value <= right2
          && (value < left2 || value < left1 || value < right1 || value < right2);
      if (isTrough) {
        extrema.push({type: "trough", index});
        troughCount += 1;
        expectedType = "peak";
        // Skip one sample to avoid duplicate detections on flat bottoms.
        index -= 2;
        continue;
      }
    } else {
      const isPeak = value >= left2
          && value >= left1
          && value >= right1
          && value >= right2
          && (value > left2 || value > left1 || value > right1 || value > right2);
      if (isPeak) {
        extrema.push({type: "peak", index});
        peakCount += 1;
        expectedType = "trough";
        // Skip one sample to avoid duplicate detections on flat tops.
        index -= 2;
        continue;
      }
    }
    index -= 1;
  }

  if (peakCount < 2 || troughCount < 2 || extrema.length < 4) return null;
  const leg1 = extrema[0].index - extrema[1].index;
  const leg2 = extrema[1].index - extrema[2].index;
  const leg3 = extrema[2].index - extrema[3].index;
  if (!(leg1 > 0 && leg2 > 0 && leg3 > 0)) return null;
  const legSamples = (leg1 + leg2 + leg3) / 3;
  let minInWindow = Number.POSITIVE_INFINITY;
  let maxInWindow = Number.NEGATIVE_INFINITY;
  for (const value of centered) {
    if (value < minInWindow) minInWindow = value;
    if (value > maxInWindow) maxInWindow = value;
  }
  if ((maxInWindow - minInWindow) < 12) return null;
  const rateHz = samplesPerSecond / (legSamples * 2);
  return Number.isFinite(rateHz) ? rateHz : null;
}

export function estimateTimelineVibratoRate({
  ring,
  samplesPerSecond,
}) {
  const tailData = centeredFiniteTail({
    ring,
    samplesPerSecond,
  });
  if (!tailData) return null;
  if (tailData.rms < 5) return null;

  const rateHz = rateFromLastTwoPeaks(tailData.centered, samplesPerSecond);
  if (!Number.isFinite(rateHz)) return null;
  if (rateHz < VIBRATO_RATE_MIN_HZ || rateHz > VIBRATO_RATE_MAX_HZ) return null;
  return rateHz;
}

export function estimateTimelineCenterCents({
  ring = null,
  detectionAlphas = null,
  recentSampleCount = 160,
}) {
  if (!ring || ring.sampleCount <= 0) return null;
  const start = Math.max(0, ring.sampleCount - Math.max(1, Math.floor(recentSampleCount)));
  let sum = 0;
  let finiteCount = 0;
  for (let i = start; i < ring.sampleCount; i += 1) {
    if (detectionAlphas && detectionAlphas[i] < 0.99) continue;
    const value = ring.at(i);
    if (!Number.isFinite(value)) continue;
    sum += value;
    finiteCount += 1;
  }
  if (finiteCount === 0) return null;
  return sum / finiteCount;
}

function getSemitoneSteps(waveRange) {
  const maxStep = Math.max(1, Math.floor(waveRange / 100));
  const steps = [];
  for (let step = -maxStep; step <= maxStep; step += 1) {
    steps.push(step);
  }
  return steps;
}

function drawGrid(ctx, width, height, waveRange, options) {
  const {
    gridLeft = 0,
    gridTop = 0,
    gridBottom = height,
  } = options;
  const plotHeight = Math.max(1, gridBottom - gridTop);
  const midY = gridTop + (plotHeight / 2);
  const scaleY = (plotHeight / 2) / waveRange;
  const steps = getSemitoneSteps(waveRange);

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
}

export function drawSemitoneLabels(ctx, width, height, waveRange, options) {
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
  const steps = getSemitoneSteps(waveRange);
  for (const step of steps) {
    const cents = step * 100;
    const y = midY - cents * scaleY;
    const label = step > 0 ? `+${step}` : `${step}`;
    ctx.fillText(label, labelX, y);
  }
}

export class VibratoChartRenderer {
  constructor() {
    this.canvas = null;
    this.lineColorMode = "";
    this.renderScale = 0;
    this.viewportState = createCanvasViewportState();
    this.backgroundCache = null;
    this.centerCents = DEFAULT_CENTER_CENTS;
    this.detectionAlphas = null;
  }

  setCanvas(canvas) {
    this.canvas = canvas;
  }

  updateOptions({
    lineColorMode,
    renderScale,
  }) {
    this.lineColorMode = lineColorMode;
    this.renderScale = renderScale;
  }

  drawBackground(ctx, width, height) {
    const cached = this.backgroundCache;
    const cacheValid = cached
        && cached.width === width
        && cached.height === height
        && cached.yRange === Y_RANGE;
    if (cacheValid) {
      ctx.drawImage(cached.canvas, 0, 0);
      return;
    }

    const bgCanvas = cached?.canvas ?? document.createElement("canvas");
    if (bgCanvas.width !== width) bgCanvas.width = width;
    if (bgCanvas.height !== height) bgCanvas.height = height;
    const bgCtx = bgCanvas.getContext("2d");
    if (!bgCtx) return;

    bgCtx.clearRect(0, 0, width, height);
    bgCtx.imageSmoothingEnabled = true;
    bgCtx.lineWidth = 1;
    drawGrid(bgCtx, width, height, Y_RANGE, {
      gridLeft: PLOT_LEFT,
      gridTop: PLOT_Y_INSET,
      gridBottom: height - PLOT_Y_INSET,
    });
    drawSemitoneLabels(bgCtx, width, height, Y_RANGE, {
      labelX: LABEL_X,
      labelTop: PLOT_Y_INSET,
      labelBottom: height - PLOT_Y_INSET,
    });
    bgCtx.imageSmoothingEnabled = true;

    this.backgroundCache = {
      canvas: bgCanvas,
      width,
      height,
      yRange: Y_RANGE,
    };
    ctx.drawImage(bgCanvas, 0, 0);
  }

  draw({
    smoothedPitchCentsRing,
    rawPitchCentsRing,
    signalStrengthRing,
    vibratoRateHzRing,
  }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const visibleSamples = vibratoRateHzRing.sampleCount;
    if (!this.detectionAlphas || this.detectionAlphas.length !== visibleSamples) {
      this.detectionAlphas = new Float32Array(visibleSamples);
    }
    for (let i = 0; i < visibleSamples; i += 1) {
      const rate = vibratoRateHzRing.at(i);
      this.detectionAlphas[i] = Number.isFinite(rate) ? 1 : 0.25;
    }
    const centerFromVibrato = estimateTimelineCenterCents({
      ring: rawPitchCentsRing,
      detectionAlphas: this.detectionAlphas,
    });
    if (centerFromVibrato !== null) {
      this.centerCents = centerFromVibrato;
    }

    const viewport = syncCanvasViewport({
      canvas,
      renderScale: this.renderScale,
      state: this.viewportState,
    });
    clearCanvasWithViewport(ctx, viewport);
    this.drawBackground(ctx, viewport.cssWidth, viewport.cssHeight);

    drawWaveformTrace({
      ctx,
      valuesRing: smoothedPitchCentsRing,
      colorValuesRing: signalStrengthRing,
      alphaValues: this.detectionAlphas,
      yOffset: this.centerCents,
      yRange: Y_RANGE,
      xInsetLeft: PLOT_LEFT,
      yInsetTop: PLOT_Y_INSET,
      yInsetBottom: PLOT_Y_INSET,
      mapColorValueToStroke: (intensity) => mapWaveformIntensityToStrokeColor(intensity, WAVEFORM_LINE_COLOR, this.lineColorMode),
      plotWidth: viewport.cssWidth,
      plotHeight: viewport.cssHeight,
    });
  }
}
