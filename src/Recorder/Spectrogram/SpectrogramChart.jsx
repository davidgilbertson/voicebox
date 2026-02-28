import {forwardRef, useEffect, useImperativeHandle, useRef} from "react";
import {SpectrogramChartRenderer} from "./spectrogramTools.js";

const SpectrogramChart = forwardRef(function SpectrogramChart({
  className,
  minHz,
  maxHz,
  renderScale,
}, ref) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(new SpectrogramChartRenderer());

  useEffect(() => {
    rendererRef.current.setCanvas(canvasRef.current);
  }, []);

  useEffect(() => {
    rendererRef.current.updateOptions({
      minHz,
      maxHz,
      renderScale,
    });
  }, [maxHz, minHz, renderScale]);

  useImperativeHandle(ref, () => ({
    appendColumn(spectrumNormalized) {
      rendererRef.current.appendColumn(spectrumNormalized);
    },
    clear() {
      rendererRef.current.clear();
    },
    draw(frameData) {
      rendererRef.current.setCanvas(canvasRef.current);
      rendererRef.current.draw(frameData);
    },
  }), []);

  return (
      <div className="relative min-h-0 flex-[2] p-0">
        <canvas
            ref={canvasRef}
            className={className}
            style={{imageRendering: "pixelated"}}
        />
      </div>
  );
});

export default SpectrogramChart;
