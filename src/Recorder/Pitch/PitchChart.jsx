import {forwardRef, useEffect, useImperativeHandle, useRef} from "react";
import {PitchChartRenderer} from "./pitchTools.js";

const PitchChart = forwardRef(function PitchChart({
  minCents,
  maxCents,
  lineColorMode,
  renderScale,
}, ref) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(new PitchChartRenderer());

  useEffect(() => {
    rendererRef.current.setCanvas(canvasRef.current);
  }, []);

  useEffect(() => {
    rendererRef.current.updateOptions({
      minCents,
      maxCents,
      lineColorMode,
      renderScale,
    });
  }, [lineColorMode, maxCents, minCents, renderScale]);

  useImperativeHandle(ref, () => ({
    draw(data) {
      rendererRef.current.setCanvas(canvasRef.current);
      rendererRef.current.draw(data);
    },
  }), []);

  return (
      <div className="relative min-h-0 flex-[2] p-0">
        <canvas
            ref={canvasRef}
            className="h-full w-full"
            style={{imageRendering: "auto"}}
        />
      </div>
  );
});

export default PitchChart;
