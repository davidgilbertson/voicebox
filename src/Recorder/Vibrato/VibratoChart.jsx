import {forwardRef, useEffect, useImperativeHandle, useRef} from "react";
import {clamp} from "../../tools.js";
import {
  VIBRATO_RATE_MAX_HZ,
  VIBRATO_RATE_MIN_HZ,
  VIBRATO_SWEET_MAX_HZ,
  VIBRATO_SWEET_MIN_HZ,
} from "../config.js";
import {VibratoChartRenderer} from "./vibratoTools.js";

const VibratoChart = forwardRef(function VibratoChart({
  lineColorMode,
  vibratoRate,
  renderScale,
}, ref) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(new VibratoChartRenderer());

  useEffect(() => {
    rendererRef.current.setCanvas(canvasRef.current);
  }, []);

  useEffect(() => {
    rendererRef.current.updateOptions({
      lineColorMode,
      renderScale,
    });
  }, [lineColorMode, renderScale]);

  useImperativeHandle(ref, () => ({
    draw(data) {
      rendererRef.current.setCanvas(canvasRef.current);
      rendererRef.current.draw(data);
    },
  }), []);

  const vibratoRatePositionPct = vibratoRate === null
      ? null
      : ((vibratoRate - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100;
  const vibratoRatePillPct = vibratoRatePositionPct === null
      ? null
      : clamp(vibratoRatePositionPct, 8, 92);
  const sweetStartPct = ((VIBRATO_SWEET_MIN_HZ - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100;
  const sweetEndPct = ((VIBRATO_SWEET_MAX_HZ - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100;
  const sweetSpanHz = Math.max(1e-3, VIBRATO_SWEET_MAX_HZ - VIBRATO_SWEET_MIN_HZ);
  const fadePct = clamp((1 / sweetSpanHz) * 100, 0, 50);
  const intermediateHzLabels = [];
  for (let hz = Math.ceil(VIBRATO_RATE_MIN_HZ) + 1; hz < Math.floor(VIBRATO_RATE_MAX_HZ); hz += 1) {
    if (hz === VIBRATO_SWEET_MIN_HZ || hz === VIBRATO_SWEET_MAX_HZ) continue;
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
          <canvas
              ref={canvasRef}
              className="h-full w-full"
              style={{imageRendering: "auto"}}
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
            <span className="absolute left-0 top-0">{VIBRATO_RATE_MIN_HZ} Hz</span>
            <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetStartPct}%`}}>
              {VIBRATO_SWEET_MIN_HZ} Hz
            </span>
            <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetEndPct}%`}}>
              {VIBRATO_SWEET_MAX_HZ} Hz
            </span>
            {intermediateHzLabels.map((hz) => (
                <span
                    key={hz}
                    className="absolute top-0 -translate-x-1/2 text-slate-300/85"
                    style={{left: `${((hz - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100}%`}}
                >
                  {hz} Hz
                </span>
            ))}
            <span className="absolute right-0 top-0">{VIBRATO_RATE_MAX_HZ} Hz</span>
          </div>
        </div>
      </>
  );
});

export default VibratoChart;
