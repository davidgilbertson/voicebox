import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import {clamp, getColorPalette} from "../tools.js";

const LABEL_X = 4;
const PLOT_LEFT = 0;
const PLOT_Y_INSET = 0;
const C1_HZ = 32.7031956626;
const EXTRA_HZ_LABELS = [
  {hz: 3000, label: "3k"},
  {hz: 5000, label: "5k"},
  {hz: 10000, label: "10k"},
];
const LABEL_FONT = "12px system-ui";
const LABEL_STROKE_WIDTH = 3;
const MIN_PENDING_COLUMN_CAPACITY = 1024;
const DEFAULT_PENDING_COLUMN_CAPACITY = 8192;

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
  bins,
  binCount,
}) {
  const pixels = imageData.data;
  for (let y = 0; y < renderHeight; y += 1) {
    const low = yBinLow[y];
    const high = Math.min(binCount - 1, low + 1);
    const mix = yBinMix[y];
    const lowValue = bins[low] ?? 0;
    const highValue = bins[high] ?? 0;
    const value = lowValue + (highValue - lowValue) * mix;
    const valueIndex = clamp(Math.round(value * 255), 0, 255);
    const colorOffset = valueIndex * 3;
    const pixelOffset = ((y * imageWidth) + xOffset) * 4;
    pixels[pixelOffset] = palette[colorOffset];
    pixels[pixelOffset + 1] = palette[colorOffset + 1];
    pixels[pixelOffset + 2] = palette[colorOffset + 2];
    pixels[pixelOffset + 3] = 255;
  }
}

const SpectrogramChart = forwardRef(function SpectrogramChart({
  className = "",
  minHz,
  maxHz,
  renderScale = 1,
}, ref) {
  const canvasRef = useRef(null);
  const palette = getColorPalette();
  const renderCanvasRef = useRef(null);
  const labelCanvasRef = useRef(null);
  const yBinCacheRef = useRef(null);
  const labelStateRef = useRef({
    cssWidth: 0,
    cssHeight: 0,
    minHz: 0,
    maxHz: 0,
  });
  const pendingColumnsRef = useRef([]);
  const pendingColumnCountRef = useRef(0);
  const pendingColumnCapacityRef = useRef(DEFAULT_PENDING_COLUMN_CAPACITY);
  const frameStateRef = useRef({
    renderWidth: 0,
    renderHeight: 0,
    binCount: 0,
    minHz: 0,
    maxHz: 0,
    sampleRate: 0,
  });

  const trimPendingColumnsToCapacity = () => {
    let pendingCount = pendingColumnCountRef.current;
    const pending = pendingColumnsRef.current;
    const capacity = Math.max(1, Math.floor(pendingColumnCapacityRef.current));
    while (pendingCount > capacity && pending.length > 0) {
      const item = pending[0];
      const overflow = pendingCount - capacity;
      const dropped = Math.min(item.repeats, overflow);
      item.repeats -= dropped;
      pendingCount -= dropped;
      if (item.repeats <= 0) {
        pending.shift();
      }
    }
    pendingColumnCountRef.current = pendingCount;
  };

  const collectTailColumns = (columnCount) => {
    const pending = pendingColumnsRef.current;
    const tailColumns = new Array(columnCount);
    let writeIndex = columnCount - 1;
    let remaining = columnCount;
    for (let i = pending.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const item = pending[i];
      const useCount = Math.min(remaining, item.repeats);
      for (let j = 0; j < useCount; j += 1) {
        tailColumns[writeIndex] = item.bins;
        writeIndex -= 1;
      }
      remaining -= useCount;
    }
    return tailColumns;
  };

  useImperativeHandle(ref, () => ({
    appendColumn(normalizedBins, repeats = 1) {
      if (!normalizedBins?.length) return;
      const count = Math.max(1, Math.floor(repeats));
      const copy = new Float32Array(normalizedBins.length);
      copy.set(normalizedBins);
      pendingColumnsRef.current.push({
        bins: copy,
        repeats: count,
      });
      pendingColumnCountRef.current += count;
      trimPendingColumnsToCapacity();
    },
    clear() {
      pendingColumnsRef.current = [];
      pendingColumnCountRef.current = 0;
      if (renderCanvasRef.current) {
        const renderCtx = renderCanvasRef.current.getContext("2d");
        renderCtx?.clearRect(0, 0, renderCanvasRef.current.width, renderCanvasRef.current.height);
      }
      yBinCacheRef.current = null;
      frameStateRef.current = {
        renderWidth: 0,
        renderHeight: 0,
        binCount: 0,
        minHz: 0,
        maxHz: 0,
        sampleRate: 0,
      };
    },
    draw({binCount, sampleRate}) {
      const canvas = canvasRef.current;
      if (!canvas || !binCount || !sampleRate) return;

      const {clientWidth, clientHeight} = canvas;
      const cssWidth = Math.max(1, Math.floor(clientWidth));
      const cssHeight = Math.max(1, Math.floor(clientHeight));
      const dpr = window.devicePixelRatio || 1;
      const effectiveScale = clamp(renderScale, 0.25, 1);
      const renderDpr = dpr * effectiveScale;
      const width = Math.max(1, Math.round(cssWidth * renderDpr));
      const height = Math.max(1, Math.round(cssHeight * renderDpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const actualScaleX = width / cssWidth;
      const actualScaleY = height / cssHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(actualScaleX, 0, 0, actualScaleY, 0, 0);

      const plotLeft = Math.max(0, PLOT_LEFT);
      const plotTop = Math.max(0, PLOT_Y_INSET);
      const plotBottom = Math.max(plotTop + 1, cssHeight - PLOT_Y_INSET);
      const plotWidth = Math.max(1, cssWidth - plotLeft);
      const plotHeight = Math.max(1, plotBottom - plotTop);
      const renderWidth = Math.max(1, Math.round(plotWidth));
      const renderHeight = Math.max(1, Math.round(plotHeight * dpr));

      if (!renderCanvasRef.current) {
        renderCanvasRef.current = document.createElement("canvas");
      }
      const renderCanvas = renderCanvasRef.current;
      const renderResized = renderCanvas.width !== renderWidth || renderCanvas.height !== renderHeight;
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
      if (pendingColumnCapacityRef.current !== pendingCapacity) {
        pendingColumnCapacityRef.current = pendingCapacity;
        trimPendingColumnsToCapacity();
      }

      const clampedMinHz = clamp(minHz, 1e-3, maxHz);
      const clampedMaxHz = Math.max(clampedMinHz + 1e-3, Math.max(minHz, maxHz));
      const hzPerBin = (sampleRate / 2) / Math.max(1, binCount - 1);
      const frameState = frameStateRef.current;
      const mappingChanged =
          frameState.binCount !== binCount ||
          frameState.minHz !== clampedMinHz ||
          frameState.maxHz !== clampedMaxHz ||
          frameState.sampleRate !== sampleRate;
      if (mappingChanged) {
        renderCtx.clearRect(0, 0, renderWidth, renderHeight);
        const filteredPending = [];
        let filteredPendingCount = 0;
        for (const item of pendingColumnsRef.current) {
          if (item.bins?.length !== binCount) continue;
          filteredPending.push(item);
          filteredPendingCount += item.repeats;
        }
        pendingColumnsRef.current = filteredPending;
        pendingColumnCountRef.current = filteredPendingCount;
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
              renderHeight
          );
        } else {
          renderCtx.clearRect(0, 0, renderWidth, renderHeight);
        }
      }

      const yCache = yBinCacheRef.current;
      const needsYCache =
          !yCache ||
          yCache.height !== renderHeight ||
          yCache.binCount !== binCount ||
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
          const binFloat = clamp(hz / hzPerBin, 0, binCount - 1);
          const binLow = Math.floor(binFloat);
          low[y] = clamp(binLow, 0, binCount - 1);
          mix[y] = binFloat - binLow;
        }
        yBinCacheRef.current = {
          low,
          mix,
          height: renderHeight,
          binCount,
          minHz: clampedMinHz,
          maxHz: clampedMaxHz,
          sampleRate,
        };
      }
      const yBinLow = yBinCacheRef.current.low;
      const yBinMix = yBinCacheRef.current.mix;

      const pendingColumnCount = pendingColumnCountRef.current;
      if (pendingColumnCount > 0) {
        const columnsToDraw = Math.min(renderWidth, pendingColumnCount);
        const tailColumns = collectTailColumns(columnsToDraw);
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
              renderHeight
          );
        }
        const strip = renderCtx.createImageData(columnsToDraw, renderHeight);
        for (let x = 0; x < columnsToDraw; x += 1) {
          drawColumnImage({
            imageData: strip,
            xOffset: x,
            imageWidth: columnsToDraw,
            renderHeight,
            yBinLow,
            yBinMix,
            palette,
            bins: tailColumns[x],
            binCount,
          });
        }
        renderCtx.putImageData(strip, renderWidth - columnsToDraw, 0);
        pendingColumnsRef.current = [];
        pendingColumnCountRef.current = 0;
      }

      frameState.renderWidth = renderWidth;
      frameState.renderHeight = renderHeight;
      frameState.binCount = binCount;
      frameState.minHz = clampedMinHz;
      frameState.maxHz = clampedMaxHz;
      frameState.sampleRate = sampleRate;

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(renderCanvas, plotLeft, plotTop, plotWidth, plotHeight);

      if (!labelCanvasRef.current) {
        labelCanvasRef.current = document.createElement("canvas");
      }
      const labelCanvas = labelCanvasRef.current;
      const labelResized = labelCanvas.width !== width || labelCanvas.height !== height;
      if (labelResized) {
        labelCanvas.width = width;
        labelCanvas.height = height;
      }
      const labelState = labelStateRef.current;
      const needsLabelRedraw =
          labelResized ||
          labelState.cssWidth !== cssWidth ||
          labelState.cssHeight !== cssHeight ||
          labelState.minHz !== clampedMinHz ||
          labelState.maxHz !== clampedMaxHz;
      if (needsLabelRedraw) {
        const labelCtx = labelCanvas.getContext("2d");
        if (labelCtx) {
          labelCtx.setTransform(1, 0, 0, 1, 0, 0);
          labelCtx.clearRect(0, 0, width, height);
          labelCtx.setTransform(actualScaleX, 0, 0, actualScaleY, 0, 0);
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
        labelState.cssWidth = cssWidth;
        labelState.cssHeight = cssHeight;
        labelState.minHz = clampedMinHz;
        labelState.maxHz = clampedMaxHz;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(labelCanvas, 0, 0, width, height);
    },
  }), [maxHz, minHz, palette, renderScale]);

  return (
      <div className="relative min-h-0 flex-[2] p-0">
        <canvas
            ref={canvasRef}
            className={className}
            style={{imageRendering: "pixelated"}}
        />
      </div>
  );
});

export default SpectrogramChart;
