import colors from "tailwindcss/colors";
import {createPitchGridLines} from "../../pitchScale.js";
import {clearCanvasWithViewport, createCanvasViewportState, drawWaveformTrace, syncCanvasViewport} from "../canvasTools.js";
import {mapWaveformIntensityToStrokeColor} from "../waveformColor.js";

const GRID_COLORS = {
  octave: colors.slate[300],
  natural: colors.slate[600],
  accidental: colors.slate[800],
};

const WAVEFORM_LINE_COLOR = colors.blue[400];
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 5;

export class PitchChartRenderer {
  constructor() {
    this.canvas = null;
    this.renderScale = 0;
    this.minCents = 0;
    this.maxCents = 0;
    this.lineColorMode = "";
    this.viewportState = createCanvasViewportState();
    this.backgroundCache = null;
  }

  setCanvas(canvas) {
    this.canvas = canvas;
  }

  updateOptions({
    minCents,
    maxCents,
    lineColorMode,
    renderScale,
  }) {
    if (Number.isFinite(minCents) && this.minCents !== minCents) {
      this.minCents = minCents;
      this.backgroundCache = null;
    }
    if (Number.isFinite(maxCents) && this.maxCents !== maxCents) {
      this.maxCents = maxCents;
      this.backgroundCache = null;
    }
    this.lineColorMode = lineColorMode;
    this.renderScale = renderScale;
  }

  drawBackground(ctx, width, height, centsSpan) {
    const cached = this.backgroundCache;
    const cacheValid = cached
        && cached.width === width
        && cached.height === height
        && cached.minCents === this.minCents
        && cached.maxCents === this.maxCents;
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
    const lines = createPitchGridLines({
      minCents: this.minCents,
      maxCents: this.maxCents,
    });
    if (lines.length) {
      const plotHeight = height - (PLOT_Y_INSET * 2);
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      for (const line of lines) {
        const normalized = (line.cents - this.minCents) / centsSpan;
        const y = PLOT_Y_INSET + plotHeight - (normalized * plotHeight);
        bgCtx.strokeStyle = GRID_COLORS[line.tier];
        bgCtx.moveTo(PLOT_LEFT, y);
        bgCtx.lineTo(width, y);
        bgCtx.stroke();
        bgCtx.beginPath();
      }
      bgCtx.font = "12px system-ui";
      bgCtx.textAlign = "left";
      bgCtx.textBaseline = "middle";
      for (const line of lines) {
        if (!line.showLabel) continue;
        const normalized = (line.cents - this.minCents) / centsSpan;
        const y = PLOT_Y_INSET + plotHeight - (normalized * plotHeight);
        bgCtx.fillStyle = GRID_COLORS[line.tier];
        bgCtx.fillText(line.noteName.replace("#", ""), LABEL_X, y);
      }
    }

    this.backgroundCache = {
      canvas: bgCanvas,
      width,
      height,
      minCents: this.minCents,
      maxCents: this.maxCents,
    };
    ctx.drawImage(bgCanvas, 0, 0);
  }

  draw({
    smoothedPitchCentsRing,
    signalStrengthRing,
  }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const centsSpan = this.maxCents - this.minCents;
    if (centsSpan <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const viewport = syncCanvasViewport({
      canvas,
      renderScale: this.renderScale,
      state: this.viewportState,
    });
    clearCanvasWithViewport(ctx, viewport);
    this.drawBackground(ctx, viewport.cssWidth, viewport.cssHeight, centsSpan);

    drawWaveformTrace({
      ctx,
      valuesRing: smoothedPitchCentsRing,
      colorValuesRing: signalStrengthRing,
      xInsetLeft: PLOT_LEFT,
      yInsetTop: PLOT_Y_INSET,
      yInsetBottom: PLOT_Y_INSET,
      mapValueToY: (value, _height, plotTop, plotHeight) => {
        const normalized = (value - this.minCents) / centsSpan;
        return plotTop + plotHeight - (normalized * plotHeight);
      },
      mapColorValueToStroke: (intensity) => mapWaveformIntensityToStrokeColor(intensity, WAVEFORM_LINE_COLOR, this.lineColorMode),
      plotWidth: viewport.cssWidth,
      plotHeight: viewport.cssHeight,
    });
  }
}
