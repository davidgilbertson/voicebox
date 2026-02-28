import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import Chart from "./Chart.jsx";
import {createPitchGridLines} from "../pitchScale.js";
import {mapWaveformIntensityToStrokeColor} from "./waveformColor.js";

const GRID_COLORS = {
  octave: colors.slate[300],
  natural: colors.slate[600],
  accidental: colors.slate[800],
};

const WAVEFORM_LINE_COLOR = colors.blue[400];
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 5;
const MAX_DRAW_JUMP_CENTS = 80;

const PitchChart = forwardRef(function PitchChart({
                                                    minCents,
                                                    maxCents,
                                                    maxDrawJumpCents = MAX_DRAW_JUMP_CENTS,
                                                    lineColorMode = "terrain",
                                                    renderScale = 1,
                                                  }, ref) {
  const chartRef = useRef(null);
  const backgroundCacheRef = useRef(null);

  useImperativeHandle(ref, () => ({
    draw({smoothedPitchCentsRing, signalStrengthRing}) {
      const centsSpan = maxCents - minCents;
      if (centsSpan <= 0) return;
      chartRef.current?.draw({
        valuesRing: smoothedPitchCentsRing,
        colorValuesRing: signalStrengthRing,
        xInsetLeft: PLOT_LEFT,
        yInsetTop: PLOT_Y_INSET,
        yInsetBottom: PLOT_Y_INSET,
        lineColor: WAVEFORM_LINE_COLOR,
        mapColorValueToStroke: (intensity) => mapWaveformIntensityToStrokeColor(intensity, WAVEFORM_LINE_COLOR, lineColorMode),
        gapThreshold: maxDrawJumpCents,
        mapValueToY: (value, _height, plotTop, plotHeight) => {
          const normalized = (value - minCents) / centsSpan;
          return plotTop + plotHeight - (normalized * plotHeight);
        },
        drawBackground: (ctx, width, height) => {
          const cached = backgroundCacheRef.current;
          const cacheValid = cached &&
              cached.width === width &&
              cached.height === height &&
              cached.minCents === minCents &&
              cached.maxCents === maxCents;

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
          const lines = createPitchGridLines({minCents, maxCents});
          if (lines.length) {
            const plotHeight = height - (PLOT_Y_INSET * 2);

            bgCtx.lineWidth = 1;
            bgCtx.beginPath();
            for (const line of lines) {
              const normalized = (line.cents - minCents) / centsSpan;
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
              const normalized = (line.cents - minCents) / centsSpan;
              const y = PLOT_Y_INSET + plotHeight - (normalized * plotHeight);
              bgCtx.fillStyle = GRID_COLORS[line.tier];
              bgCtx.fillText(line.noteName.replace("#", ""), LABEL_X, y);
            }
          }

          backgroundCacheRef.current = {
            canvas: bgCanvas,
            width,
            height,
            minCents,
            maxCents,
          };
          ctx.drawImage(bgCanvas, 0, 0);
        },
      });
    },
  }), [lineColorMode, maxCents, maxDrawJumpCents, minCents]);

  return (
      <div className="relative min-h-0 flex-[2] p-0">
        <Chart
            ref={chartRef}
            className="h-full w-full"
            renderScale={renderScale}
        />
      </div>
  );
});

export default PitchChart;
