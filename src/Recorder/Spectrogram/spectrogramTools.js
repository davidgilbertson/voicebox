import colors from "tailwindcss/colors";
import { clamp, getColorPalette } from "../../tools.js";
import {
  clearCanvasWithViewport,
  createCanvasViewportState,
  syncCanvasViewport,
} from "../canvasTools.js";

const LABEL_X = 4;
const PLOT_LEFT = 0;
const PLOT_Y_INSET = 0;
const C1_HZ = 32.7031956626;
const EXTRA_HZ_LABELS = [
  { hz: 3000, label: "3k" },
  { hz: 5000, label: "5k" },
  { hz: 10000, label: "10k" },
];
const LABEL_FONT = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
const LABEL_STROKE_WIDTH = 3;
const MIN_PENDING_COLUMN_CAPACITY = 1024;
const DEFAULT_PENDING_COLUMN_CAPACITY = 8192;
const SPECTROGRAM_DISPLAY_MIN_DB = -100;
const SPECTROGRAM_DISPLAY_MAX_DB = -15;

function drawLabelWithOutline(ctx, label, x, y) {
  ctx.lineWidth = LABEL_STROKE_WIDTH;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.lineJoin = "round";
  ctx.strokeText(label, x, y);
  ctx.fillStyle = colors.white;
  ctx.fillText(label, x, y);
}

function drawColumnImage({
  imageData,
  xOffset,
  imageWidth,
  renderHeight,
  yBinLow,
  yBinMix,
  palette,
  spectrumValues,
  binCount,
}) {
  const pixels = imageData.data;
  for (let y = 0; y < renderHeight; y += 1) {
    const low = yBinLow[y];
    const high = Math.min(binCount - 1, low + 1);
    const mix = yBinMix[y];
    const lowValue = spectrumValues[low] ?? 0;
    const highValue = spectrumValues[high] ?? 0;
    const value = lowValue + (highValue - lowValue) * mix;
    const valueIndex = clamp(Math.round(value * 255), 0, 255);
    const colorOffset = valueIndex * 3;
    const pixelOffset = (y * imageWidth + xOffset) * 4;
    pixels[pixelOffset] = palette[colorOffset];
    pixels[pixelOffset + 1] = palette[colorOffset + 1];
    pixels[pixelOffset + 2] = palette[colorOffset + 2];
    pixels[pixelOffset + 3] = 255;
  }
}

export class SpectrogramChartRenderer {
  constructor({ minHz, maxHz, renderScale }) {
    this.canvas = null;
    this.renderScale = renderScale;
    this.minHz = minHz;
    this.maxHz = maxHz;
    this.palette = getColorPalette();
    this.viewportState = createCanvasViewportState();
    this.renderCanvas = null;
    this.labelCanvas = null;
    this.yBinCache = null;
    this.labelState = {
      cssWidth: 0,
      cssHeight: 0,
      minHz: 0,
      maxHz: 0,
    };
    this.pendingColumns = [];
    this.pendingColumnCapacity = DEFAULT_PENDING_COLUMN_CAPACITY;
    this.canvasNeedsClearing = true;
    this.frameState = {
      renderWidth: 0,
      renderHeight: 0,
      minHz: 0,
      maxHz: 0,
      sampleRate: 0,
    };
  }

  setCanvas(canvas) {
    this.canvas = canvas;
  }

  updateOptions({ minHz, maxHz, renderScale }) {
    if (this.minHz !== minHz || this.maxHz !== maxHz || this.renderScale !== renderScale) {
      this.canvasNeedsClearing = true;
    }
    this.minHz = minHz;
    this.maxHz = maxHz;
    this.renderScale = renderScale;
  }

  trimPendingColumnsToCapacity() {
    const capacity = Math.max(1, Math.floor(this.pendingColumnCapacity));
    while (this.pendingColumns.length > capacity) {
      this.pendingColumns.shift();
    }
  }

  collectTailColumns(columnCount) {
    const tailColumns = new Array(columnCount);
    let tailInsertIndex = columnCount - 1;
    for (let i = this.pendingColumns.length - 1; i >= 0 && tailInsertIndex >= 0; i -= 1) {
      tailColumns[tailInsertIndex] = this.pendingColumns[i];
      tailInsertIndex -= 1;
    }
    return tailColumns;
  }

  appendColumn(spectrumDb, maxHeardVolume) {
    if (!spectrumDb?.length) return;
    // If the user changes the resolution of the spectrogram,
    //  buffer sizes will change, so we drop any old ones.
    const pendingColumnCount = this.pendingColumns.length;
    if (
      pendingColumnCount > 0 &&
      this.pendingColumns[pendingColumnCount - 1].length !== spectrumDb.length
    ) {
      this.pendingColumns = [];
      this.canvasNeedsClearing = true;
    }
    const copy = new Float32Array(spectrumDb.length);
    const dbRange = SPECTROGRAM_DISPLAY_MAX_DB - SPECTROGRAM_DISPLAY_MIN_DB;
    const invDbRange = dbRange > 0 ? 1 / dbRange : 0;
    const gain = maxHeardVolume > 0 ? 10 / maxHeardVolume : 1;
    for (let i = 0; i < spectrumDb.length; i += 1) {
      const normalized =
        (Math.max(spectrumDb[i], SPECTROGRAM_DISPLAY_MIN_DB) - SPECTROGRAM_DISPLAY_MIN_DB) *
        invDbRange;
      const value = clamp(normalized * gain, 0, 1);
      copy[i] = value;
    }
    this.pendingColumns.push(copy);
    this.trimPendingColumnsToCapacity();
  }

  clear() {
    this.pendingColumns = [];
    this.canvasNeedsClearing = true;
    if (this.renderCanvas) {
      const renderCtx = this.renderCanvas.getContext("2d");
      renderCtx?.clearRect(0, 0, this.renderCanvas.width, this.renderCanvas.height);
    }
    this.yBinCache = null;
    this.frameState = {
      renderWidth: 0,
      renderHeight: 0,
      minHz: 0,
      maxHz: 0,
      sampleRate: 0,
    };
  }

  draw({ binCount, sampleRate }) {
    const canvas = this.canvas;
    if (!canvas || !binCount || !sampleRate) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const viewport = syncCanvasViewport({
      canvas,
      renderScale: this.renderScale,
      state: this.viewportState,
    });
    clearCanvasWithViewport(ctx, viewport);

    const plotLeft = Math.max(0, PLOT_LEFT);
    const plotTop = Math.max(0, PLOT_Y_INSET);
    const plotBottom = Math.max(plotTop + 1, viewport.cssHeight - PLOT_Y_INSET);
    const plotWidth = Math.max(1, viewport.cssWidth - plotLeft);
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const renderWidth = Math.max(1, Math.round(plotWidth));
    const renderHeight = Math.max(1, Math.round(plotHeight * viewport.dpr));

    if (!this.renderCanvas) {
      this.renderCanvas = document.createElement("canvas");
    }
    const renderCanvas = this.renderCanvas;
    const renderResized =
      renderCanvas.width !== renderWidth || renderCanvas.height !== renderHeight;
    let previousCanvas = null;
    if (renderResized && renderCanvas.width > 0 && renderCanvas.height > 0) {
      previousCanvas = document.createElement("canvas");
      previousCanvas.width = renderCanvas.width;
      previousCanvas.height = renderCanvas.height;
      const previousCtx = previousCanvas.getContext("2d");
      if (previousCtx) {
        previousCtx.drawImage(renderCanvas, 0, 0, renderCanvas.width, renderCanvas.height);
      }
    }
    if (renderResized) {
      renderCanvas.width = renderWidth;
      renderCanvas.height = renderHeight;
    }
    const renderCtx = renderCanvas.getContext("2d");
    if (!renderCtx) return;

    const pendingCapacity = Math.max(MIN_PENDING_COLUMN_CAPACITY, renderWidth * 2);
    if (this.pendingColumnCapacity !== pendingCapacity) {
      this.pendingColumnCapacity = pendingCapacity;
      this.trimPendingColumnsToCapacity();
    }

    const pendingColumnCount = this.pendingColumns.length;
    const pendingBinCount =
      pendingColumnCount > 0 ? this.pendingColumns[pendingColumnCount - 1].length : 0;
    const effectiveBinCount = pendingBinCount || binCount;

    // TODO (@davidgilbertson): clamping should happen in updateOptions, not on every draw
    const clampedMinHz = clamp(this.minHz, 1e-3, this.maxHz);
    const clampedMaxHz = Math.max(clampedMinHz + 1e-3, Math.max(this.minHz, this.maxHz));
    const frameState = this.frameState;
    const sampleRateChanged = frameState.sampleRate > 0 && frameState.sampleRate !== sampleRate;
    if (this.canvasNeedsClearing || sampleRateChanged) {
      renderCtx.clearRect(0, 0, renderWidth, renderHeight);
      this.yBinCache = null;
      this.canvasNeedsClearing = false;
    } else if (renderResized && frameState.renderWidth > 0 && frameState.renderHeight > 0) {
      const previousWidth = frameState.renderWidth;
      const previousHeight = frameState.renderHeight;
      if (previousCanvas) {
        renderCtx.clearRect(0, 0, renderWidth, renderHeight);
        const sourceWidth = Math.min(previousWidth, renderWidth);
        const sourceX = previousWidth - sourceWidth;
        const targetX = renderWidth - sourceWidth;
        renderCtx.drawImage(
          previousCanvas,
          sourceX,
          0,
          sourceWidth,
          previousHeight,
          targetX,
          0,
          sourceWidth,
          renderHeight,
        );
      } else {
        renderCtx.clearRect(0, 0, renderWidth, renderHeight);
      }
    }

    if (pendingColumnCount > 0) {
      const hzPerBin = sampleRate / 2 / Math.max(1, effectiveBinCount - 1);
      const yCache = this.yBinCache;
      const needsYCache =
        !yCache ||
        yCache.height !== renderHeight ||
        yCache.binCount !== effectiveBinCount ||
        yCache.minHz !== clampedMinHz ||
        yCache.maxHz !== clampedMaxHz ||
        yCache.sampleRate !== sampleRate;
      if (needsYCache) {
        const low = new Uint16Array(renderHeight);
        const mix = new Float32Array(renderHeight);
        const freqSpanRatio = clampedMinHz / clampedMaxHz;
        for (let y = 0; y < renderHeight; y += 1) {
          const normalizedY = renderHeight <= 1 ? 0 : y / (renderHeight - 1);
          const hz = clampedMaxHz * Math.pow(freqSpanRatio, normalizedY);
          const binFloat = clamp(hz / hzPerBin, 0, effectiveBinCount - 1);
          const binLow = Math.floor(binFloat);
          low[y] = clamp(binLow, 0, effectiveBinCount - 1);
          mix[y] = binFloat - binLow;
        }
        this.yBinCache = {
          low,
          mix,
          height: renderHeight,
          binCount: effectiveBinCount,
          minHz: clampedMinHz,
          maxHz: clampedMaxHz,
          sampleRate,
        };
      }
      const yBinLow = this.yBinCache.low;
      const yBinMix = this.yBinCache.mix;
      const columnsToDraw = Math.min(renderWidth, pendingColumnCount);
      const tailColumns = this.collectTailColumns(columnsToDraw);
      if (columnsToDraw < renderWidth) {
        renderCtx.drawImage(
          renderCanvas,
          columnsToDraw,
          0,
          renderWidth - columnsToDraw,
          renderHeight,
          0,
          0,
          renderWidth - columnsToDraw,
          renderHeight,
        );
      }
      const strip = renderCtx.createImageData(columnsToDraw, renderHeight);
      for (let x = 0; x < columnsToDraw; x += 1) {
        const spectrumColumn = tailColumns[x];
        drawColumnImage({
          imageData: strip,
          xOffset: x,
          imageWidth: columnsToDraw,
          renderHeight,
          yBinLow,
          yBinMix,
          palette: this.palette,
          spectrumValues: spectrumColumn,
          binCount: effectiveBinCount,
        });
      }
      renderCtx.putImageData(strip, renderWidth - columnsToDraw, 0);
      this.pendingColumns = [];
    }

    frameState.renderWidth = renderWidth;
    frameState.renderHeight = renderHeight;
    frameState.minHz = clampedMinHz;
    frameState.maxHz = clampedMaxHz;
    frameState.sampleRate = sampleRate;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(renderCanvas, plotLeft, plotTop, plotWidth, plotHeight);

    if (!this.labelCanvas) {
      this.labelCanvas = document.createElement("canvas");
    }
    const labelCanvas = this.labelCanvas;
    const labelResized =
      labelCanvas.width !== viewport.width || labelCanvas.height !== viewport.height;
    if (labelResized) {
      labelCanvas.width = viewport.width;
      labelCanvas.height = viewport.height;
    }
    const labelState = this.labelState;
    const needsLabelRedraw =
      labelResized ||
      viewport.changed ||
      labelState.cssWidth !== viewport.cssWidth ||
      labelState.cssHeight !== viewport.cssHeight ||
      labelState.minHz !== clampedMinHz ||
      labelState.maxHz !== clampedMaxHz;
    if (needsLabelRedraw) {
      const labelCtx = labelCanvas.getContext("2d");
      if (labelCtx) {
        labelCtx.setTransform(1, 0, 0, 1, 0, 0);
        labelCtx.clearRect(0, 0, viewport.width, viewport.height);
        labelCtx.setTransform(viewport.actualScaleX, 0, 0, viewport.actualScaleY, 0, 0);
        labelCtx.font = LABEL_FONT;
        labelCtx.textAlign = "left";
        labelCtx.textBaseline = "middle";
        const freqSpanRatio = clampedMinHz / clampedMaxHz;
        const denom = Math.log(freqSpanRatio);
        if (Number.isFinite(denom) && denom !== 0) {
          for (let octave = 1; octave <= 7; octave += 1) {
            const hz = C1_HZ * Math.pow(2, octave - 1);
            if (hz < clampedMinHz || hz > clampedMaxHz) continue;
            const normalizedY = Math.log(hz / clampedMaxHz) / denom;
            if (normalizedY < 0 || normalizedY > 1) continue;
            const y = plotTop + normalizedY * plotHeight;
            drawLabelWithOutline(labelCtx, `C${octave}`, LABEL_X, y);
          }
          for (const item of EXTRA_HZ_LABELS) {
            if (item.hz < clampedMinHz || item.hz > clampedMaxHz) continue;
            const normalizedY = Math.log(item.hz / clampedMaxHz) / denom;
            if (normalizedY < 0 || normalizedY > 1) continue;
            const y = plotTop + normalizedY * plotHeight;
            drawLabelWithOutline(labelCtx, item.label, LABEL_X, y);
          }
        }
      }
      labelState.cssWidth = viewport.cssWidth;
      labelState.cssHeight = viewport.cssHeight;
      labelState.minHz = clampedMinHz;
      labelState.maxHz = clampedMaxHz;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(labelCanvas, 0, 0, viewport.width, viewport.height);
  }
}
