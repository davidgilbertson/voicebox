import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import Recorder from "./Recorder/Recorder.jsx";
import ScalesPage from "./ScalesPage/ScalesPage.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import { RecordingEngine } from "./Recorder/RecordingEngine.js";
import { PlaybackEngine } from "./ScalesPage/PlaybackEngine.js";
import { calibrateMinVolumeThreshold } from "./Recorder/micCalibration.js";
import { writeActiveView } from "./AppShell/config.js";
import { PITCH_NOTE_OPTIONS } from "./pitchScale.js";
import { computeIsForeground, subscribeToForegroundChanges } from "./foreground.js";
import { writeScaleMaxNote, writeScaleMinNote } from "./ScalesPage/config.js";
import {
  writeAutoPauseOnSilence,
  writeHighResSpectrogram,
  writeHalfResolutionCanvas,
  writeKeepRunningInBackground,
  writeMinVolumeThreshold,
  writePitchMaxNote,
  writePitchMinNote,
  writePitchLineColorMode,
  writeRunAt30Fps,
  writeSpectrogramMaxHz,
  writeSpectrogramMinHz,
} from "./Recorder/config.js";
import { readConfig } from "./config.js";

export default function AppShell({ downloadingUpdate = false }) {
  const [isForeground, setIsForeground] = useState(computeIsForeground);
  const [config] = useState(readConfig);
  const [activeView, setActiveView] = useState(() => config.app.activeView);
  const [recorderEngine] = useState(
    () => new RecordingEngine({ ...config.shared, ...config.recorder, isForeground, activeView }),
  );
  const [scalesPlaybackEngine] = useState(
    () =>
      new PlaybackEngine({
        ...config.shared,
        ...config.scales,
        isForeground,
      }),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scaleMinNote, setScaleMinNote] = useState(() => config.scales.scaleMinNote);
  const [scaleMaxNote, setScaleMaxNote] = useState(() => config.scales.scaleMaxNote);
  const [keepRunningInBackground, setKeepRunningInBackground] = useState(
    () => config.shared.keepRunningInBackground,
  );
  const [autoPauseOnSilence, setAutoPauseOnSilence] = useState(
    () => config.recorder.autoPauseOnSilence,
  );
  const [runAt30Fps, setRunAt30Fps] = useState(() => config.recorder.runAt30Fps);
  const [halfResolutionCanvas, setHalfResolutionCanvas] = useState(
    () => config.recorder.halfResolutionCanvas,
  );
  const [highResSpectrogram, setHighResSpectrogram] = useState(
    () => config.recorder.highResSpectrogram,
  );
  const [minVolumeThreshold, setMinVolumeThreshold] = useState(
    () => config.recorder.minVolumeThreshold,
  );
  const [pitchMinNote, setPitchMinNote] = useState(() => config.recorder.pitchMinNote);
  const [pitchMaxNote, setPitchMaxNote] = useState(() => config.recorder.pitchMaxNote);
  const [pitchLineColorMode, setPitchLineColorMode] = useState(
    () => config.recorder.pitchLineColorMode,
  );
  const [spectrogramMinHz, setSpectrogramMinHz] = useState(() => config.recorder.spectrogramMinHz);
  const [spectrogramMaxHz, setSpectrogramMaxHz] = useState(() => config.recorder.spectrogramMaxHz);
  const [runtimeSettings, setRuntimeSettings] = useState({
    batteryUsagePerMinute: null,
  });
  const onScalesPage = activeView === "scales";

  useEffect(() => {
    if (import.meta.env.MODE !== "test") return;
    globalThis.__appRecordingEngineForTests = recorderEngine;
    globalThis.__appPlaybackEngineForTests = scalesPlaybackEngine;
    return () => {
      delete globalThis.__appRecordingEngineForTests;
      delete globalThis.__appPlaybackEngineForTests;
    };
  }, [recorderEngine, scalesPlaybackEngine]);

  useEffect(() => {
    writeActiveView(activeView);
  }, [activeView]);

  useEffect(() => subscribeToForegroundChanges(setIsForeground), []);

  useEffect(() => {
    return () => {
      recorderEngine.destroy();
      scalesPlaybackEngine.destroy();
    };
  }, [recorderEngine, scalesPlaybackEngine]);

  useEffect(() => {
    writeScaleMinNote(scaleMinNote);
    writeScaleMaxNote(scaleMaxNote);
  }, [scaleMaxNote, scaleMinNote]);

  useEffect(() => {
    writeKeepRunningInBackground(keepRunningInBackground);
  }, [keepRunningInBackground]);

  useEffect(() => {
    writeAutoPauseOnSilence(autoPauseOnSilence);
  }, [autoPauseOnSilence]);

  useEffect(() => {
    writeRunAt30Fps(runAt30Fps);
  }, [runAt30Fps]);

  useEffect(() => {
    writeHalfResolutionCanvas(halfResolutionCanvas);
  }, [halfResolutionCanvas]);

  useEffect(() => {
    writeHighResSpectrogram(highResSpectrogram);
  }, [highResSpectrogram]);

  useEffect(() => {
    writeMinVolumeThreshold(minVolumeThreshold);
  }, [minVolumeThreshold]);

  useEffect(() => {
    writePitchMinNote(pitchMinNote);
    writePitchMaxNote(pitchMaxNote);
  }, [pitchMaxNote, pitchMinNote]);

  useEffect(() => {
    writePitchLineColorMode(pitchLineColorMode);
  }, [pitchLineColorMode]);

  useEffect(() => {
    writeSpectrogramMinHz(spectrogramMinHz);
    writeSpectrogramMaxHz(spectrogramMaxHz);
  }, [spectrogramMaxHz, spectrogramMinHz]);

  useEffect(() => {
    recorderEngine.setActiveView(activeView);
  }, [activeView, recorderEngine]);

  useEffect(() => {
    recorderEngine.updateSettings({
      keepRunningInBackground,
      autoPauseOnSilence,
      runAt30Fps,
      highResSpectrogram,
      minVolumeThreshold,
      pitchMinNote,
      pitchMaxNote,
      pitchLineColorMode,
      halfResolutionCanvas,
      spectrogramMinHz,
      spectrogramMaxHz,
    });
  }, [
    autoPauseOnSilence,
    halfResolutionCanvas,
    highResSpectrogram,
    keepRunningInBackground,
    minVolumeThreshold,
    pitchMaxNote,
    pitchMinNote,
    pitchLineColorMode,
    recorderEngine,
    runAt30Fps,
    spectrogramMaxHz,
    spectrogramMinHz,
  ]);

  useEffect(() => {
    scalesPlaybackEngine.updateSettings({
      scaleMinNote,
      scaleMaxNote,
      keepRunningInBackground,
      isForeground,
    });
  }, [isForeground, keepRunningInBackground, scaleMaxNote, scaleMinNote, scalesPlaybackEngine]);

  const onViewChange = (nextView) => {
    setActiveView(nextView);
  };

  const onOpenSettings = () => {
    setSettingsOpen(true);
  };

  const onCalibrateMicFloor = async () => {
    const measuredVolume = onScalesPage
      ? await calibrateMinVolumeThreshold()
      : await recorderEngine.calibrateMinVolumeThreshold();
    const threshold = Math.max(0.1, measuredVolume * 0.7);
    setMinVolumeThreshold(threshold);
    return { measuredVolume, threshold };
  };

  const onPitchMinNoteChange = (nextNote) => {
    const lastIndex = PITCH_NOTE_OPTIONS.length - 1;
    let nextMinIndex = PITCH_NOTE_OPTIONS.indexOf(nextNote);
    let nextMaxIndex = PITCH_NOTE_OPTIONS.indexOf(pitchMaxNote);
    if (nextMinIndex < 0 || nextMaxIndex < 0) return;
    if (nextMinIndex >= nextMaxIndex) {
      nextMaxIndex = Math.min(lastIndex, nextMinIndex + 1);
      if (nextMinIndex >= nextMaxIndex) {
        nextMinIndex = Math.max(0, nextMaxIndex - 1);
      }
    }
    setPitchMinNote(PITCH_NOTE_OPTIONS[nextMinIndex]);
    setPitchMaxNote(PITCH_NOTE_OPTIONS[nextMaxIndex]);
  };

  const onPitchMaxNoteChange = (nextNote) => {
    const lastIndex = PITCH_NOTE_OPTIONS.length - 1;
    let nextMaxIndex = PITCH_NOTE_OPTIONS.indexOf(nextNote);
    let nextMinIndex = PITCH_NOTE_OPTIONS.indexOf(pitchMinNote);
    if (nextMinIndex < 0 || nextMaxIndex < 0) return;
    if (nextMaxIndex <= nextMinIndex) {
      nextMinIndex = Math.max(0, nextMaxIndex - 1);
      if (nextMaxIndex <= nextMinIndex) {
        nextMaxIndex = Math.min(lastIndex, nextMinIndex + 1);
      }
    }
    setPitchMinNote(PITCH_NOTE_OPTIONS[nextMinIndex]);
    setPitchMaxNote(PITCH_NOTE_OPTIONS[nextMaxIndex]);
  };

  const onSpectrogramMinHzChange = (nextValue) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;
    setSpectrogramMinHz(nextValue);
    if (nextValue >= spectrogramMaxHz) {
      setSpectrogramMaxHz(nextValue + 1);
    }
  };

  const onSpectrogramMaxHzChange = (nextValue) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;
    setSpectrogramMaxHz(nextValue);
    if (nextValue <= spectrogramMinHz) {
      setSpectrogramMinHz(Math.max(1e-3, nextValue - 1));
    }
  };

  const onScaleMinNoteChange = (nextNote) => {
    const lastIndex = PITCH_NOTE_OPTIONS.length - 1;
    let nextMinIndex = PITCH_NOTE_OPTIONS.indexOf(nextNote);
    let nextMaxIndex = PITCH_NOTE_OPTIONS.indexOf(scaleMaxNote);
    if (nextMinIndex < 0 || nextMaxIndex < 0) return;
    if (nextMinIndex >= nextMaxIndex) {
      nextMaxIndex = Math.min(lastIndex, nextMinIndex + 1);
      if (nextMinIndex >= nextMaxIndex) {
        nextMinIndex = Math.max(0, nextMaxIndex - 1);
      }
    }
    setScaleMinNote(PITCH_NOTE_OPTIONS[nextMinIndex]);
    setScaleMaxNote(PITCH_NOTE_OPTIONS[nextMaxIndex]);
  };

  const onScaleMaxNoteChange = (nextNote) => {
    const lastIndex = PITCH_NOTE_OPTIONS.length - 1;
    let nextMaxIndex = PITCH_NOTE_OPTIONS.indexOf(nextNote);
    let nextMinIndex = PITCH_NOTE_OPTIONS.indexOf(scaleMinNote);
    if (nextMinIndex < 0 || nextMaxIndex < 0) return;
    if (nextMaxIndex <= nextMinIndex) {
      nextMinIndex = Math.max(0, nextMaxIndex - 1);
      if (nextMaxIndex <= nextMinIndex) {
        nextMaxIndex = Math.min(lastIndex, nextMinIndex + 1);
      }
    }
    setScaleMinNote(PITCH_NOTE_OPTIONS[nextMinIndex]);
    setScaleMaxNote(PITCH_NOTE_OPTIONS[nextMaxIndex]);
  };

  return (
    <div className="h-[var(--app-height)] w-full overflow-hidden bg-black text-slate-100 select-none">
      <div
        data-testid="sw-update-banner"
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-2 transition-all duration-200 ${
          downloadingUpdate ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        <div className="mt-1 flex h-7 items-center rounded-md bg-green-500 px-3 text-[11px] font-semibold tracking-wide text-green-950 uppercase">
          Downloading a new version
        </div>
      </div>
      <div className="flex h-full w-full items-stretch">
        <main className="relative flex min-h-0 flex-1 flex-col bg-black md:h-full md:w-full md:flex-none">
          {onScalesPage ? (
            <ScalesPage
              scaleMinNote={scaleMinNote}
              scaleMaxNote={scaleMaxNote}
              engine={scalesPlaybackEngine}
            />
          ) : (
            <Recorder
              activeView={activeView}
              settingsOpen={settingsOpen}
              onSettingsRuntimeChange={setRuntimeSettings}
              engine={recorderEngine}
            />
          )}
          <footer className="relative flex h-12 items-stretch gap-2 pt-0 pr-2 pb-0 pl-0 text-xs text-slate-300">
            <div className="flex flex-1 items-stretch">
              <button
                type="button"
                onClick={() => onViewChange("scales")}
                aria-pressed={activeView === "scales"}
                className={`relative h-full flex-1 rounded-none px-1 text-[15px] font-semibold transition-colors ${
                  activeView === "scales"
                    ? "text-blue-400"
                    : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                }`}
              >
                Scales
                {activeView === "scales" ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-blue-400" />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onViewChange("spectrogram")}
                aria-pressed={activeView === "spectrogram"}
                className={`relative h-full flex-[1.25] rounded-none px-1 text-[15px] font-semibold transition-colors ${
                  activeView === "spectrogram"
                    ? "text-blue-400"
                    : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                }`}
              >
                Spectrogram
                {activeView === "spectrogram" ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-blue-400" />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onViewChange("pitch")}
                aria-pressed={activeView === "pitch"}
                className={`relative h-full flex-1 rounded-none px-1 text-[15px] font-semibold transition-colors ${
                  activeView === "pitch"
                    ? "text-blue-400"
                    : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                }`}
              >
                Pitch
                {activeView === "pitch" ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-blue-400" />
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onViewChange("vibrato")}
                aria-pressed={activeView === "vibrato"}
                className={`relative h-full flex-1 rounded-none px-1 text-[15px] font-semibold transition-colors ${
                  activeView === "vibrato"
                    ? "text-blue-400"
                    : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                }`}
              >
                Vibrato
                {activeView === "vibrato" ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-blue-400" />
                ) : null}
              </button>
            </div>
            <div className="flex w-9 items-stretch justify-end sm:w-10">
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex h-full w-full items-center justify-center rounded-none text-slate-400 transition-colors hover:text-slate-100 active:text-white disabled:opacity-40 disabled:hover:text-slate-400"
                aria-label="Open settings"
              >
                <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </div>
          </footer>
        </main>
        {settingsOpen ? (
          <SettingsPanel
            recorderEngine={recorderEngine}
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            scaleMinNote={scaleMinNote}
            scaleMaxNote={scaleMaxNote}
            scaleNoteOptions={PITCH_NOTE_OPTIONS}
            onScaleMinNoteChange={onScaleMinNoteChange}
            onScaleMaxNoteChange={onScaleMaxNoteChange}
            keepRunningInBackground={keepRunningInBackground}
            onKeepRunningInBackgroundChange={setKeepRunningInBackground}
            autoPauseOnSilence={autoPauseOnSilence}
            onAutoPauseOnSilenceChange={setAutoPauseOnSilence}
            onCalibrateMicFloor={onCalibrateMicFloor}
            runAt30Fps={runAt30Fps}
            onRunAt30FpsChange={setRunAt30Fps}
            halfResolutionCanvas={halfResolutionCanvas}
            onHalfResolutionCanvasChange={setHalfResolutionCanvas}
            highResSpectrogram={highResSpectrogram}
            onHighResSpectrogramChange={setHighResSpectrogram}
            minVolumeThreshold={minVolumeThreshold}
            pitchMinNote={pitchMinNote}
            pitchMaxNote={pitchMaxNote}
            pitchLineColorMode={pitchLineColorMode}
            onPitchLineColorModeChange={setPitchLineColorMode}
            pitchNoteOptions={PITCH_NOTE_OPTIONS}
            onPitchMinNoteChange={onPitchMinNoteChange}
            onPitchMaxNoteChange={onPitchMaxNoteChange}
            spectrogramMinHz={spectrogramMinHz}
            spectrogramMaxHz={spectrogramMaxHz}
            onSpectrogramMinHzChange={onSpectrogramMinHzChange}
            onSpectrogramMaxHzChange={onSpectrogramMaxHzChange}
            batteryUsagePerMinute={runtimeSettings.batteryUsagePerMinute}
            showRecorderShare={!onScalesPage}
          />
        ) : null}
      </div>
    </div>
  );
}
