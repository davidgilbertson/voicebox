import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import Chart from "./Chart.jsx";
import {clamp} from "../tools.js";
import {mapWaveformIntensityToStrokeColor} from "./waveformColor.js";

const WAVEFORM_LINE_COLOR = colors.blue[400];
const Y_RANGE = 405; // in cents
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 5;

function getSemitoneSteps(waveRange) {
  const maxStep = Math.max(1, Math.floor(waveRange / 100));
  const steps = [];
  for (let step = -maxStep; step <= maxStep; step += 1) {
    steps.push(step);
  }
  return steps;
}

function drawGrid(ctx, width, height, waveRange, options = {}) {
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

export function drawSemitoneLabels(ctx, width, height, waveRange, options = {}) {
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

const VibratoChart = forwardRef(function VibratoChart({
                                                        maxDrawJumpCents,
                                                        lineColorMode = "terrain",
                                                        vibratoRate,
                                                        vibratoRateMinHz,
                                                        vibratoRateMaxHz,
                                                        vibratoSweetMinHz,
                                                        vibratoSweetMaxHz,
                                                        renderScale = 1,
                                                      }, ref) {
  const chartRef = useRef(null);
  const backgroundCacheRef = useRef(null);

  useImperativeHandle(ref, () => ({
    draw({values, intensities, detectionAlphas, writeIndex, count, yOffset}) {
      chartRef.current?.draw({
        values,
        colorValues: intensities,
        alphaValues: detectionAlphas,
        writeIndex,
        count,
        yOffset,
        yRange: Y_RANGE,
        xInsetLeft: PLOT_LEFT,
        yInsetTop: PLOT_Y_INSET,
        yInsetBottom: PLOT_Y_INSET,
        lineColor: WAVEFORM_LINE_COLOR,
        mapColorValueToStroke: (intensity) => mapWaveformIntensityToStrokeColor(intensity, WAVEFORM_LINE_COLOR, lineColorMode),
        gapThreshold: maxDrawJumpCents,
        drawBackground: (ctx, width, height) => {
          const cached = backgroundCacheRef.current;
          const cacheValid = cached &&
              cached.width === width &&
              cached.height === height &&
              cached.yRange === Y_RANGE;

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

          backgroundCacheRef.current = {
            canvas: bgCanvas,
            width,
            height,
            yRange: Y_RANGE,
          };
          ctx.drawImage(bgCanvas, 0, 0);
        },
      });
    },
  }), [lineColorMode, maxDrawJumpCents]);

  const vibratoRatePositionPct = vibratoRate === null
      ? null
      : ((vibratoRate - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100;
  const vibratoRatePillPct = vibratoRatePositionPct === null
      ? null
      : clamp(vibratoRatePositionPct, 8, 92);
  const sweetStartPct = ((vibratoSweetMinHz - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100;
  const sweetEndPct = ((vibratoSweetMaxHz - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100;
  const sweetSpanHz = Math.max(1e-3, vibratoSweetMaxHz - vibratoSweetMinHz);
  const fadePct = clamp((1 / sweetSpanHz) * 100, 0, 50);
  const intermediateHzLabels = [];
  for (let hz = Math.ceil(vibratoRateMinHz) + 1; hz < Math.floor(vibratoRateMaxHz); hz += 1) {
    if (hz === vibratoSweetMinHz || hz === vibratoSweetMaxHz) continue;
    intermediateHzLabels.push(hz);
  }
  const sweetGradient = `linear-gradient(to right,
    rgba(52, 211, 153, 0) 0%,
    rgba(52, 211, 153, 0.85) ${fadePct}%,
    rgba(52, 211, 153, 0.85) ${100 - fadePct}%,
    rgba(52, 211, 153, 0) 100%)`;

  return (
      <>
        <div className="relative min-h-0 flex-[2] p-0">
          <Chart
              ref={chartRef}
              className="h-full w-full"
              renderScale={renderScale}
          />
        </div>
        <div className="pointer-events-none px-2 pb-2 pt-1">
          <div className="relative">
            <div className="relative h-3 w-full overflow-hidden rounded-none bg-slate-600/80">
              <div
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${sweetStartPct}%`,
                    width: `${sweetEndPct - sweetStartPct}%`,
                    background: sweetGradient,
                  }}
              />
            </div>
            {vibratoRatePositionPct !== null ? (
                <>
                  <div
                      className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-full border border-slate-300/20 bg-slate-900/85 px-2 py-0.5 text-xs font-medium text-slate-100"
                      style={{left: `${vibratoRatePillPct}%`}}
                  >
                    {vibratoRate.toFixed(1)} Hz
                  </div>
                  <div
                      className="absolute -top-3 bottom-0 w-0.5 bg-white/90"
                      style={{left: `${vibratoRatePositionPct}%`, transform: "translateX(-1px)"}}
                  />
                </>
            ) : null}
          </div>
          <div className="relative mt-1 h-3 text-xs leading-none text-slate-400/65">
            <span className="absolute left-0 top-0">{vibratoRateMinHz} Hz</span>
            <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetStartPct}%`}}>
              {vibratoSweetMinHz} Hz
            </span>
            <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetEndPct}%`}}>
              {vibratoSweetMaxHz} Hz
            </span>
            {intermediateHzLabels.map((hz) => (
                <span
                    key={hz}
                    className="absolute top-0 -translate-x-1/2 text-slate-300/85"
                    style={{left: `${((hz - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100}%`}}
                >
                  {hz} Hz
                </span>
            ))}
            <span className="absolute right-0 top-0">{vibratoRateMaxHz} Hz</span>
          </div>
        </div>
      </>
  );
});

export default VibratoChart;
