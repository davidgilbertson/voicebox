import { forwardRef } from "react";

const PitchChart = forwardRef(function PitchChart(_props, ref) {
  return (
    <div className="relative min-h-0 flex-[2] p-0">
      <canvas ref={ref} className="h-full w-full" style={{ imageRendering: "auto" }} />
    </div>
  );
});

export default PitchChart;
