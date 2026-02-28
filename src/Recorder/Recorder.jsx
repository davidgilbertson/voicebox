import {useEffect, useMemo, useRef, useState} from "react";
import {Pause} from "lucide-react";
import VibratoChart from "./VibratoChart.jsx";
import PitchChart from "./PitchChart.jsx";
import SpectrogramChart from "./SpectrogramChart.jsx";
import {createAudioEngine} from "./AudioEngine.js";
import {noteNameToCents} from "../pitchScale.js";

export default function Recorder({
  activeView,
  settingsOpen,
  keepRunningInBackground,
  autoPauseOnSilence,
  runAt30Fps,
  halfResolutionCanvas,
  pitchMinNote,
  pitchMaxNote,
  pitchLineColorMode,
  spectrogramMinHz,
  spectrogramMaxHz,
  onSettingsRuntimeChange,
}) {
  const vibratoChartRef = useRef(null);
  const pitchChartRef = useRef(null);
  const spectrogramChartRef = useRef(null);
  const chartContainerRef = useRef(null);
  const engine = useMemo(() => createAudioEngine(), []);
  const [engineUi, setEngineUi] = useState(() => engine.getUiSnapshot());

  useEffect(() => engine.subscribeUi(setEngineUi), [engine]);

  useEffect(() => {
    engine.attachCharts({
      pitchChart: pitchChartRef.current,
      vibratoChart: vibratoChartRef.current,
      spectrogramChart: spectrogramChartRef.current,
      container: chartContainerRef.current,
    });
    return () => {
      engine.detachCharts();
      engine.destroy();
    };
  }, [engine]);

  useEffect(() => {
    engine.setActiveView(activeView);
  }, [activeView, engine]);

  useEffect(() => {
    engine.setSettingsOpen(settingsOpen);
    engine.updateSettings({
      keepRunningInBackground,
      autoPauseOnSilence,
      runAt30Fps,
      pitchMinNote,
      pitchMaxNote,
      spectrogramMinHz,
      spectrogramMaxHz,
    });
    engine.startIfNeeded();
  }, [
    autoPauseOnSilence,
    engine,
    keepRunningInBackground,
    pitchMaxNote,
    pitchMinNote,
    runAt30Fps,
    settingsOpen,
    spectrogramMaxHz,
    spectrogramMinHz,
  ]);

  useEffect(() => {
    onSettingsRuntimeChange({
      spectrogramNoiseCalibrating: engineUi.spectrogramNoiseCalibrating,
      spectrogramNoiseProfileReady: engineUi.spectrogramNoiseProfileReady,
      onNoiseCalibratePointerDown: engine.onNoiseCalibratePointerDown,
      onNoiseCalibratePointerUp: engine.onNoiseCalibratePointerUp,
      onNoiseCalibrateContextMenu: engine.onNoiseCalibrateContextMenu,
      onClearSpectrogramNoiseProfile: engine.clearSpectrogramNoiseProfile,
      batteryUsagePerMinute: engineUi.batteryUsagePerMinute,
    });
  }, [engine, engineUi, onSettingsRuntimeChange]);

  const onStartButtonClick = () => {
    engine.setWantsToRun(true);
    engine.startIfNeeded();
  };

  const onChartPointerDown = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (settingsOpen || !engineUi.hasEverRun) return;
    engine.setWantsToRun(!engineUi.isWantedRunning);
  };

  const showStartOverlay = !engineUi.isAudioRunning && !engineUi.isWantedRunning && (engineUi.error || !engineUi.hasEverRun);
  const showPausedOverlay = !engineUi.isWantedRunning && engineUi.hasEverRun && !engineUi.error;

  return (
    <>
      <div
        ref={chartContainerRef}
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={onChartPointerDown}
        data-testid="recorder-chart-area"
      >
        <div className={activeView === "vibrato" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}>
          <VibratoChart
            ref={vibratoChartRef}
            vibratoRate={engineUi.vibratoRate}
            renderScale={halfResolutionCanvas ? 0.5 : 1}
            lineColorMode={pitchLineColorMode}
          />
        </div>
        <div className={activeView === "spectrogram" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}>
          <SpectrogramChart
            ref={spectrogramChartRef}
            className="h-full w-full"
            minHz={spectrogramMinHz}
            maxHz={spectrogramMaxHz}
            renderScale={halfResolutionCanvas ? 0.5 : 1}
          />
        </div>
        <div className={activeView === "pitch" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}>
          <PitchChart
            ref={pitchChartRef}
            minCents={noteNameToCents(pitchMinNote)}
            maxCents={noteNameToCents(pitchMaxNote)}
            renderScale={halfResolutionCanvas ? 0.5 : 1}
            lineColorMode={pitchLineColorMode}
          />
        </div>
        {showStartOverlay ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={onStartButtonClick}
              className="rounded-full bg-blue-400 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-blue-400/30"
            >
              Start
            </button>
          </div>
        ) : null}
        {showPausedOverlay ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div
              role="status"
              className="pause-pill bg-slate-800/80 text-base font-semibold uppercase tracking-wide text-slate-100 shadow-lg"
            >
              <Pause aria-hidden="true" className="pause-pill-icon h-5 w-5"/>
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
