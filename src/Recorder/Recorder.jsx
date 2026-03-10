import { useEffect, useRef, useState } from "react";
import { Pause } from "lucide-react";
import VibratoChart from "./Vibrato/VibratoChart.jsx";
import PitchChart from "./Pitch/PitchChart.jsx";
import SpectrogramChart from "./Spectrogram/SpectrogramChart.jsx";

export default function Recorder({
  activeView,
  settingsOpen,
  engine,
}) {
  const vibratoChartRef = useRef(null);
  const pitchChartRef = useRef(null);
  const spectrogramChartRef = useRef(null);
  const chartContainerRef = useRef(null);
  const [engineUi, setEngineUi] = useState(() => engine.getUiSnapshot());

  useEffect(() => engine.subscribeUi(setEngineUi), [engine]);

  useEffect(() => {
    engine.attachCharts({
      pitchCanvas: pitchChartRef.current,
      vibratoCanvas: vibratoChartRef.current,
      spectrogramCanvas: spectrogramChartRef.current,
      container: chartContainerRef,
    });
    return () => {
      engine.detachCharts();
    };
  }, [engine]);
  const onStartButtonClick = () => {
    engine.setWantsToRun(true);
    engine.startIfNeeded();
  };

  const onChartPointerDown = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (settingsOpen || !engineUi.hasEverRun) return;
    engine.setWantsToRun(!engineUi.isWantedRunning);
  };

  const showStartOverlay =
    !engineUi.isAudioRunning &&
    !engineUi.isWantedRunning &&
    (engineUi.error || !engineUi.hasEverRun);
  const showPausedOverlay = !engineUi.isWantedRunning && engineUi.hasEverRun && !engineUi.error;
  const showMicPermissionHint = showStartOverlay && engineUi.hasRejectedMicPermission;

  return (
    <>
      <div
        ref={chartContainerRef}
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={onChartPointerDown}
        data-testid="recorder-chart-area"
      >
        <div
          className={
            activeView === "vibrato"
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden min-h-0 flex-1 flex-col"
          }
        >
          <VibratoChart ref={vibratoChartRef} vibratoRate={engineUi.vibratoRate} />
        </div>
        <div
          className={
            activeView === "spectrogram"
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden min-h-0 flex-1 flex-col"
          }
        >
          <SpectrogramChart ref={spectrogramChartRef} className="h-full w-full" />
        </div>
        <div
          className={
            activeView === "pitch"
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden min-h-0 flex-1 flex-col"
          }
        >
          <PitchChart ref={pitchChartRef} />
        </div>
        {showStartOverlay ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex max-w-xs flex-col items-center gap-3 px-4 text-center">
              {showMicPermissionHint ? (
                <p className="text-sm text-slate-200">
                  Microphone access is blocked. Allow it in site settings, then try again.
                </p>
              ) : null}
              <button
                type="button"
                onClick={onStartButtonClick}
                className="rounded-full bg-blue-400 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-blue-400/30"
              >
                {showMicPermissionHint ? "Try again" : "Start"}
              </button>
            </div>
          </div>
        ) : null}
        {showPausedOverlay ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div
              role="status"
              className="pause-pill bg-slate-800/80 text-base font-semibold tracking-wide text-slate-100 uppercase shadow-lg"
            >
              <Pause aria-hidden="true" className="pause-pill-icon h-5 w-5" />
              <span className="pause-pill-label">Paused</span>
            </div>
          </div>
        ) : null}
      </div>
      {engineUi.error && !showStartOverlay ? (
        <div className="absolute inset-x-3 top-14 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-200">
          {engineUi.error}
        </div>
      ) : null}
    </>
  );
}
