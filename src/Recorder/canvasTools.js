import {clamp} from "../tools.js";
import {MAX_DRAW_JUMP_CENTS} from "./config.js";

const MIN_RENDER_SCALE = 0.25;
const MAX_RENDER_SCALE = 1;
const DEFAULT_LINE_WIDTH = 2;

export function createCanvasViewportState() {
  return {
    cssWidth: 0,
    cssHeight: 0,
    width: 0,
    height: 0,
    dpr: 0,
    effectiveScale: 0,
    actualScaleX: 1,
    actualScaleY: 1,
    changed: true,
  };
}

export function syncCanvasViewport({
  canvas,
  renderScale,
  state,
}) {
  const cssWidth = Math.max(1, Math.floor(canvas.clientWidth));
  const cssHeight = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  const effectiveScale = clamp(renderScale, MIN_RENDER_SCALE, MAX_RENDER_SCALE);
  const renderDpr = dpr * effectiveScale;
  const width = Math.max(1, Math.round(cssWidth * renderDpr));
  const height = Math.max(1, Math.round(cssHeight * renderDpr));

  const didSizeInputsChange = state.cssWidth !== cssWidth
      || state.cssHeight !== cssHeight
      || state.dpr !== dpr
      || state.effectiveScale !== effectiveScale
      || state.width !== width
      || state.height !== height;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  state.cssWidth = cssWidth;
  state.cssHeight = cssHeight;
  state.width = width;
  state.height = height;
  state.dpr = dpr;
  state.effectiveScale = effectiveScale;
  state.actualScaleX = width / cssWidth;
  state.actualScaleY = height / cssHeight;
  state.changed = didSizeInputsChange;
  return state;
}

export function clearCanvasWithViewport(ctx, viewportState) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, viewportState.width, viewportState.height);
  ctx.setTransform(viewportState.actualScaleX, 0, 0, viewportState.actualScaleY, 0, 0);
}

export function drawWaveformTrace({
  ctx,
  valuesRing,
  colorValuesRing,
  alphaValues = null,
  yOffset = 0,
  yRange = 1,
  mapValueToY = null,
  xInsetLeft = 0,
  xInsetRight = 0,
  yInsetTop = 0,
  yInsetBottom = 0,
  mapColorValueToStroke,
  plotWidth,
  plotHeight,
}) {
  const effectiveSampleCount = valuesRing.sampleCount;
  if (effectiveSampleCount <= 0 || yRange <= 0) {
    return;
  }

  const plotLeft = Math.max(0, xInsetLeft);
  const plotRight = Math.max(plotLeft + 1, plotWidth - Math.max(0, xInsetRight));
  const plotTop = Math.max(0, yInsetTop);
  const plotBottom = Math.max(plotTop + 1, plotHeight - Math.max(0, yInsetBottom));
  const availableWidth = Math.max(1, plotRight - plotLeft);
  const availableHeight = Math.max(1, plotBottom - plotTop);
  const midY = plotTop + (availableHeight / 2);
  const scaleY = (availableHeight / 2) / yRange;

  ctx.lineWidth = DEFAULT_LINE_WIDTH;
  const useAlphaSegments = Boolean(alphaValues);
  ctx.lineJoin = useAlphaSegments ? "miter" : "round";
  ctx.lineCap = useAlphaSegments ? "butt" : "round";

  let lastValue = null;
  let lastY = null;
  let lastX = null;
  const totalSlots = valuesRing.capacity;
  const startSlot = effectiveSampleCount < totalSlots ? totalSlots - effectiveSampleCount : 0;
  for (let i = 0; i < effectiveSampleCount; i += 1) {
    const value = valuesRing.at(i);
    if (Number.isNaN(value)) {
      lastValue = null;
      lastY = null;
      continue;
    }
    const slot = startSlot + i;
    const x = totalSlots > 1
        ? plotLeft + (slot / (totalSlots - 1)) * availableWidth
        : plotRight;
    const y = mapValueToY
        ? mapValueToY(value, plotHeight, plotTop, availableHeight)
        : midY - (value - yOffset) * scaleY;
    const hasGap = lastValue === null || Math.abs(value - lastValue) > MAX_DRAW_JUMP_CENTS || lastY === null;
    if (!hasGap && lastX !== null) {
      const colorValue = colorValuesRing.at(i);
      const alphaValue = alphaValues ? alphaValues[i] : 1;
      ctx.strokeStyle = mapColorValueToStroke(colorValue);
      ctx.globalAlpha = Number.isFinite(alphaValue) ? clamp(alphaValue, 0, 1) : 1;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    lastValue = value;
    lastY = y;
    lastX = x;
  }
}
