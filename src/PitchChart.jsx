import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import Chart from "./Chart.jsx";
import {createPitchGridLines} from "./pitchScale.js";

const GRID_COLORS = {
  octave: colors.slate[300],
  natural: colors.slate[700],
  accidental: colors.slate[800],
};

const WAVEFORM_LINE_COLOR = colors.sky[400];
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 5;

const PitchChart = forwardRef(function PitchChart({minCents, maxCents}, ref) {
  const chartRef = useRef(null);

  useImperativeHandle(ref, () => ({
    draw({values, writeIndex, count}) {
      const centsSpan = maxCents - minCents;
      if (centsSpan <= 0) return;
      chartRef.current?.draw({
        values,
        writeIndex,
        count,
        xInsetLeft: PLOT_LEFT,
        yInsetTop: PLOT_Y_INSET,
        yInsetBottom: PLOT_Y_INSET,
        lineColor: WAVEFORM_LINE_COLOR,
        lineWidth: 1.5,
        gapThreshold: 300,
        mapValueToY: (value, _height, plotTop, plotHeight) => {
          const normalized = (value - minCents) / centsSpan;
          return plotTop + plotHeight - (normalized * plotHeight);
        },
        drawBackground: (ctx, width, height) => {
          const lines = createPitchGridLines({minCents, maxCents});
          if (!lines.length) return;
          const plotHeight = height - (PLOT_Y_INSET * 2);

          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const line of lines) {
            const normalized = (line.cents - minCents) / centsSpan;
            const y = PLOT_Y_INSET + plotHeight - (normalized * plotHeight);
            ctx.strokeStyle = GRID_COLORS[line.tier];
            ctx.moveTo(PLOT_LEFT, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.beginPath();
          }

          ctx.font = "12px system-ui";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          for (const line of lines) {
            if (!line.showLabel) continue;
            const normalized = (line.cents - minCents) / centsSpan;
            const y = PLOT_Y_INSET + plotHeight - (normalized * plotHeight);
            ctx.fillStyle = GRID_COLORS[line.tier];
            ctx.fillText(line.noteName.replace("#", ""), LABEL_X, y);
          }
        },
      });
    },
  }), [maxCents, minCents]);

  return (
      <div className="relative min-h-0 flex-[2] p-0">
        <Chart ref={chartRef} className="h-full w-full"/>
      </div>
  );
});

export default PitchChart;
