import {forwardRef, useImperativeHandle, useMemo, useRef} from "react";
import colors from "tailwindcss/colors";

const LEVEL_FLOOR = 0.02;
const LEVEL_GAMMA = 1.6;
const DARK_LIFT = 0.06;
const HIGHLIGHT_KNEE = 0.72;
const HIGHLIGHT_GAMMA = 0.55;
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 0;
const C1_HZ = 32.7031956626;

function createPalette() {
  const palette = new Uint8ClampedArray(256 * 3);
  const infernoStops = [
    [0.001, 0.000, 0.014],
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
  return palette;
}

function createToneLut() {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    const normalized = i / 255;
    const lifted = Math.max(0, normalized - LEVEL_FLOOR) / (1 - LEVEL_FLOOR);
    let mapped = Math.pow(lifted, LEVEL_GAMMA);
    if (mapped > HIGHLIGHT_KNEE) {
      const normalizedHighlight = (mapped - HIGHLIGHT_KNEE) / (1 - HIGHLIGHT_KNEE);
      const separatedHighlight = Math.pow(normalizedHighlight, HIGHLIGHT_GAMMA);
      mapped = HIGHLIGHT_KNEE + separatedHighlight * (1 - HIGHLIGHT_KNEE);
    }
    mapped = DARK_LIFT + mapped * (1 - DARK_LIFT);
    lut[i] = Math.max(0, Math.min(255, Math.round(mapped * 255)));
  }
  return lut;
}

function fillSpectrogramColumns({
  imageData,
  imageStartX,
  imageWidth,
  renderHeight,
  yBinLow,
  yBinMix,
  palette,
  toneLut,
  values,
  binCount,
  getColumnIndex,
}) {
  const pixels = imageData.data;
  for (let y = 0; y < renderHeight; y += 1) {
    const low = yBinLow[y];
    const high = Math.min(binCount - 1, low + 1);
    const mix = yBinMix[y];
    for (let x = 0; x < imageWidth; x += 1) {
      const columnIndex = getColumnIndex(x);
      let value = 0;
      if (columnIndex >= 0) {
        const base = columnIndex * binCount;
        const lowValue = values[base + low];
        const highValue = values[base + high];
        value = lowValue + (highValue - lowValue) * mix;
      }
      const valueIndex = Math.max(0, Math.min(255, Math.round(value * 255)));
      const paletteIndex = toneLut[valueIndex];
      const colorOffset = paletteIndex * 3;
      const pixelOffset = (y * imageWidth + x) * 4;
      pixels[pixelOffset] = palette[colorOffset];
      pixels[pixelOffset + 1] = palette[colorOffset + 1];
      pixels[pixelOffset + 2] = palette[colorOffset + 2];
      pixels[pixelOffset + 3] = 255;
    }
  }
  return imageStartX;
}

const SpectrogramChart = forwardRef(function SpectrogramChart({className = "", minHz, maxHz}, ref) {
  const canvasRef = useRef(null);
  const palette = useMemo(() => createPalette(), []);
  const toneLut = useMemo(() => createToneLut(), []);
  const renderCanvasRef = useRef(null);
  const labelCanvasRef = useRef(null);
  const yBinCacheRef = useRef(null);
  const frameStateRef = useRef({
    renderWidth: 0,
    renderHeight: 0,
    columnCount: 0,
    lastWriteIndex: 0,
    lastCount: 0,
  });
  const labelStateRef = useRef({
    cssWidth: 0,
    cssHeight: 0,
    minHz: 0,
    maxHz: 0,
  });

  useImperativeHandle(ref, () => ({
    draw({values, writeIndex, count, binCount, sampleRate}) {
      const canvas = canvasRef.current;
      if (!canvas || !values || !binCount || !sampleRate) return;

      const {clientWidth, clientHeight} = canvas;
      const cssWidth = Math.max(1, Math.floor(clientWidth));
      const cssHeight = Math.max(1, Math.floor(clientHeight));
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const plotLeft = Math.max(0, PLOT_LEFT);
      const plotTop = Math.max(0, PLOT_Y_INSET);
      const plotBottom = Math.max(plotTop + 1, cssHeight - PLOT_Y_INSET);
      const plotWidth = Math.max(1, cssWidth - plotLeft);
      const plotHeight = Math.max(1, plotBottom - plotTop);

      const columnCount = values.length / binCount;
      if (!columnCount || count <= 0) return;
      const startSlot = count < columnCount ? columnCount - count : 0;
      const firstIndex = count === columnCount ? writeIndex : 0;

      const renderWidth = columnCount;
      const renderHeight = Math.max(1, Math.round(plotHeight * dpr));
      if (!renderCanvasRef.current) {
        renderCanvasRef.current = document.createElement("canvas");
      }
      const renderCanvas = renderCanvasRef.current;
      const renderResized = renderCanvas.width !== renderWidth || renderCanvas.height !== renderHeight;
      if (renderResized) {
        renderCanvas.width = renderWidth;
        renderCanvas.height = renderHeight;
      }
      const renderCtx = renderCanvas.getContext("2d");
      if (!renderCtx) return;

      const clampedMinHz = Math.max(1e-3, Math.min(minHz, maxHz));
      const clampedMaxHz = Math.max(clampedMinHz + 1e-3, Math.max(minHz, maxHz));
      const hzPerBin = (sampleRate / 2) / Math.max(1, binCount - 1);

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
          const binFloat = Math.max(0, Math.min(binCount - 1, hz / hzPerBin));
          const binLow = Math.floor(binFloat);
          low[y] = Math.max(0, Math.min(binCount - 1, binLow));
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

      const frameState = frameStateRef.current;
      const needsFullRedraw =
          renderResized ||
          frameState.renderWidth !== renderWidth ||
          frameState.renderHeight !== renderHeight ||
          frameState.columnCount !== columnCount ||
          frameState.lastCount === 0 ||
          count < columnCount;

      if (needsFullRedraw) {
        const image = renderCtx.createImageData(renderWidth, renderHeight);
        fillSpectrogramColumns({
          imageData: image,
          imageStartX: 0,
          imageWidth: renderWidth,
          renderHeight,
          yBinLow,
          yBinMix,
          palette,
          toneLut,
          values,
          binCount,
          getColumnIndex: (x) => {
            if (x < startSlot) return -1;
            const slotFromStart = x - startSlot;
            return (firstIndex + slotFromStart) % columnCount;
          },
        });
        renderCtx.putImageData(image, 0, 0);
      } else {
        const rawDelta = (writeIndex - frameState.lastWriteIndex + columnCount) % columnCount;
        const delta = Math.min(columnCount, rawDelta);
        if (delta > 0) {
          if (delta < renderWidth) {
            renderCtx.drawImage(
                renderCanvas,
                delta,
                0,
                renderWidth - delta,
                renderHeight,
                0,
                0,
                renderWidth - delta,
                renderHeight
            );
          }
          const strip = renderCtx.createImageData(delta, renderHeight);
          fillSpectrogramColumns({
            imageData: strip,
            imageStartX: renderWidth - delta,
            imageWidth: delta,
            renderHeight,
            yBinLow,
            yBinMix,
            palette,
            toneLut,
            values,
            binCount,
            getColumnIndex: (x) => (writeIndex - delta + x + columnCount) % columnCount,
          });
          renderCtx.putImageData(strip, renderWidth - delta, 0);
        }
      }

      frameState.renderWidth = renderWidth;
      frameState.renderHeight = renderHeight;
      frameState.columnCount = columnCount;
      frameState.lastWriteIndex = writeIndex;
      frameState.lastCount = count;

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
          labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          labelCtx.fillStyle = colors.slate[300];
          labelCtx.font = "12px system-ui";
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
              labelCtx.fillText(`C${octave}`, LABEL_X, y);
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
  }), [maxHz, minHz, palette, toneLut]);

  return (
      <div className="relative min-h-0 flex-[2] p-0">
        <canvas ref={canvasRef} className={className}/>
      </div>
  );
});

export default SpectrogramChart;
