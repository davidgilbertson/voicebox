import {forwardRef, useImperativeHandle, useRef} from "react";
import colors from "tailwindcss/colors";
import Chart from "./Chart.jsx";
import {drawGrid, drawSemitoneLabels} from "./tools.js";

const WAVEFORM_LINE_COLOR = colors.sky[400];
const LABEL_X = 4;
const PLOT_LEFT = 21;
const PLOT_Y_INSET = 5;

const VibratoChart = forwardRef(function VibratoChart({
  yRange,
  vibratoRateHz,
  vibratoRateMinHz,
  vibratoRateMaxHz,
  vibratoSweetMinHz,
  vibratoSweetMaxHz,
}, ref) {
  const chartRef = useRef(null);
  const barRef = useRef(null);

  useImperativeHandle(ref, () => ({
    draw({values, writeIndex, count, yOffset}) {
      chartRef.current?.draw({
        values,
        writeIndex,
        count,
        yOffset,
        yRange,
        xInsetLeft: PLOT_LEFT,
        yInsetTop: PLOT_Y_INSET,
        yInsetBottom: PLOT_Y_INSET,
        lineColor: WAVEFORM_LINE_COLOR,
        lineWidth: 1.5,
        gapThreshold: 300,
        drawBackground: (ctx, width, height) => {
          ctx.imageSmoothingEnabled = true;
          ctx.lineWidth = 1;
          drawGrid(ctx, width, height, yRange, {
            gridLeft: PLOT_LEFT,
            gridTop: PLOT_Y_INSET,
            gridBottom: height - PLOT_Y_INSET,
          });
          drawSemitoneLabels(ctx, width, height, yRange, {
            labelX: LABEL_X,
            labelTop: PLOT_Y_INSET,
            labelBottom: height - PLOT_Y_INSET,
          });
          ctx.imageSmoothingEnabled = true;
        },
      });
    },
    getRateBarWidth() {
      return Math.max(1, barRef.current?.clientWidth ?? 1);
    },
  }), [yRange]);

  const vibratoRatePositionPct = vibratoRateHz === null
      ? null
      : ((vibratoRateHz - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100;
  const vibratoRatePillPct = vibratoRatePositionPct === null
      ? null
      : Math.max(8, Math.min(92, vibratoRatePositionPct));
  const sweetStartPct = ((vibratoSweetMinHz - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100;
  const sweetEndPct = ((vibratoSweetMaxHz - vibratoRateMinHz) / (vibratoRateMaxHz - vibratoRateMinHz)) * 100;

  return (
      <>
        <div className="relative min-h-0 flex-[2] p-0">
          <Chart ref={chartRef} className="h-full w-full"/>
        </div>
        <div className="pointer-events-none border-t border-slate-800/70 px-2 pb-2 pt-1">
          <div className="relative">
            <div ref={barRef} className="relative h-3 w-full overflow-hidden rounded-none bg-slate-600/80">
              <div
                  className="absolute top-0 bottom-0 bg-emerald-400/85"
                  style={{
                    left: `${sweetStartPct}%`,
                    width: `${sweetEndPct - sweetStartPct}%`,
                  }}
              />
            </div>
            {vibratoRatePositionPct !== null ? (
                <>
                  <div
                      className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-full border border-slate-300/20 bg-slate-900/85 px-2 py-0.5 text-xs font-medium text-slate-100"
                      style={{left: `${vibratoRatePillPct}%`}}
                  >
                    {vibratoRateHz.toFixed(1)} Hz
                  </div>
                  <div
                      className="absolute -top-3 bottom-0 w-0.5 bg-white/90"
                      style={{left: `${vibratoRatePositionPct}%`, transform: "translateX(-1px)"}}
                  />
                </>
            ) : null}
          </div>
          <div className="relative mt-1 h-3 text-[10px] leading-none text-slate-400/65">
            <span className="absolute left-0 top-0">{vibratoRateMinHz} Hz</span>
            <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetStartPct}%`}}>
              {vibratoSweetMinHz} Hz
            </span>
            <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetEndPct}%`}}>
              {vibratoSweetMaxHz} Hz
            </span>
            <span className="absolute right-0 top-0">{vibratoRateMaxHz} Hz</span>
          </div>
        </div>
      </>
  );
});

export default VibratoChart;
