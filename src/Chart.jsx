import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import {smoothDisplayTimeline} from "./displaySmoothing.js";

const Chart = forwardRef(function Chart({className = ""}, ref) {
  const canvasRef = useRef(null);
  const smoothedValuesRef = useRef(null);

  const draw = ({
                  values,
                  writeIndex,
                  count,
                  yOffset = 0,
                  yRange = 1,
                  lineColor = colors.sky[400],
                  lineWidth = 1,
                  gapThreshold = Number.POSITIVE_INFINITY,
                  drawBackground,
                }) => {
    const canvas = canvasRef.current;
    if (!canvas || !values || count <= 0 || yRange <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (drawBackground) {
      drawBackground(ctx, cssWidth, cssHeight);
    }

    if (!smoothedValuesRef.current || smoothedValuesRef.current.length !== values.length) {
      smoothedValuesRef.current = new Float32Array(values.length);
    }
    const drawValues = smoothDisplayTimeline(
        {values, writeIndex, count},
        {output: smoothedValuesRef.current}
    );

    const midY = cssHeight / 2;
    const scaleY = (cssHeight / 2) / yRange;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = lineColor;
    ctx.beginPath();
    let hasActivePath = false;
    let lastValue = null;
    let lastY = null;
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
      const x = totalSlots > 1 ? (slot / (totalSlots - 1)) * cssWidth : cssWidth;
      const centered = value - yOffset;
      const y = midY - centered * scaleY;
      if (lastValue === null || Math.abs(value - lastValue) > gapThreshold || lastY === null) {
        if (hasActivePath) {
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x, y);
        hasActivePath = true;
      } else {
        ctx.lineTo(x, y);
      }
      lastValue = value;
      lastY = y;
    }
    if (hasActivePath) {
      ctx.stroke();
    }
  };

  useImperativeHandle(ref, () => ({
    draw,
  }));

  return <canvas ref={canvasRef} className={className}/>;
});

export default Chart;
