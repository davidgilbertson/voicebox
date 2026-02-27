import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import {smoothDisplayTimeline} from "./displaySmoothing.js";
import {clamp} from "../tools.js";

const LINE_WIDTH = 2;

const Chart = forwardRef(function Chart({
                                          className = "",
                                          renderScale = 1,
                                        }, ref) {
  const canvasRef = useRef(null);
  const smoothedValuesRef = useRef(null);

  const draw = ({
                  values,
                  colorValues = null,
                  alphaValues = null,
                  writeIndex,
                  count,
                  yOffset = 0,
                  yRange = 1,
                  mapValueToY = null,
                  xInsetLeft = 0,
                  xInsetRight = 0,
                  yInsetTop = 0,
                  yInsetBottom = 0,
                  lineColor = colors.blue[400],
                  mapColorValueToStroke = null,
                  gapThreshold = Number.POSITIVE_INFINITY,
                  drawBackground,
                }) => {
    const canvas = canvasRef.current;
    if (!canvas || yRange <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(actualScaleX, 0, 0, actualScaleY, 0, 0);

    if (drawBackground) {
      drawBackground(ctx, cssWidth, cssHeight);
    }

    if (!values || count <= 0) {
      return;
    }

    if (!smoothedValuesRef.current || smoothedValuesRef.current.length !== values.length) {
      smoothedValuesRef.current = new Float32Array(values.length);
    }
    const drawValues = smoothDisplayTimeline(
        {values, writeIndex, count},
        {output: smoothedValuesRef.current}
    );

    const plotLeft = Math.max(0, xInsetLeft);
    const plotRight = Math.max(plotLeft + 1, cssWidth - Math.max(0, xInsetRight));
    const plotTop = Math.max(0, yInsetTop);
    const plotBottom = Math.max(plotTop + 1, cssHeight - Math.max(0, yInsetBottom));
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const plotHeight = Math.max(1, plotBottom - plotTop);
    const midY = plotTop + (plotHeight / 2);
    const scaleY = (plotHeight / 2) / yRange;
    ctx.lineWidth = LINE_WIDTH;
    const useAlphaSegments = colorValues && mapColorValueToStroke && alphaValues;
    ctx.lineJoin = useAlphaSegments ? "miter" : "round";
    ctx.lineCap = useAlphaSegments ? "butt" : "round";

    const usePerSegmentColor = colorValues && mapColorValueToStroke;
    if (!usePerSegmentColor) {
      ctx.strokeStyle = lineColor;
      ctx.beginPath();
    }
    let hasActivePath = false;
    let lastValue = null;
    let lastY = null;
    let lastX = null;
    const totalSlots = drawValues.length;
    const firstIndex = count === totalSlots ? writeIndex : 0;
    const startSlot = count < totalSlots ? totalSlots - count : 0;
    for (let i = 0; i < count; i += 1) {
      const bufferIndex = (firstIndex + i) % totalSlots;
      const value = drawValues[bufferIndex];
      if (Number.isNaN(value)) {
        lastValue = null;
        lastY = null;
        continue;
      }
      const slot = startSlot + i;
      const x = totalSlots > 1
          ? plotLeft + (slot / (totalSlots - 1)) * plotWidth
          : plotRight;
      const y = mapValueToY
          ? mapValueToY(value, cssHeight, plotTop, plotHeight)
          : midY - (value - yOffset) * scaleY;
      if (lastValue === null || Math.abs(value - lastValue) > gapThreshold || lastY === null) {
        if (!usePerSegmentColor && hasActivePath) {
          ctx.stroke();
        }
        if (!usePerSegmentColor) {
          ctx.beginPath();
          ctx.moveTo(x, y);
        }
        hasActivePath = true;
      } else {
        if (usePerSegmentColor && lastX !== null) {
          const colorValue = colorValues[bufferIndex];
          const alphaValue = alphaValues ? alphaValues[bufferIndex] : 1;
          ctx.strokeStyle = mapColorValueToStroke(colorValue);
          ctx.globalAlpha = Number.isFinite(alphaValue) ? clamp(alphaValue, 0, 1) : 1;
          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.lineTo(x, y);
        }
      }
      lastValue = value;
      lastY = y;
      lastX = x;
    }
    if (!usePerSegmentColor && hasActivePath) {
      ctx.stroke();
    }

  };

  useImperativeHandle(ref, () => ({
    draw,
  }));

  return (
      <canvas
          ref={canvasRef}
          className={className}
          style={{imageRendering: "auto"}}
      />
  );
});

export default Chart;
