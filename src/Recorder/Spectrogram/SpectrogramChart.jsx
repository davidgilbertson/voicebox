import { forwardRef } from "react";

const SpectrogramChart = forwardRef(function SpectrogramChart({ className }, ref) {
  return (
    <div className="relative min-h-0 flex-[2] p-0">
      <canvas ref={ref} className={className} style={{ imageRendering: "pixelated" }} />
    </div>
  );
});

export default SpectrogramChart;
