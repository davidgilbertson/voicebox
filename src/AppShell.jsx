import {Settings} from "lucide-react";
import {useEffect, useState} from "react";
import Recorder from "./Recorder/Recorder.jsx";
import ScalesPage from "./ScalesPage/ScalesPage.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import {readActiveView, writeActiveView} from "./AppShell/config.js";
import {PITCH_NOTE_OPTIONS} from "./pitchScale.js";
import {
  readScaleMaxNote,
  readScaleMinNote,
  writeScaleMaxNote,
  writeScaleMinNote,
} from "./ScalesPage/config.js";
import {
  readAutoPauseOnSilence,
  readHalfResolutionCanvas,
  readKeepRunningInBackground,
  readPitchMaxNote,
  readPitchMinNote,
  readRunAt30Fps,
  readSpectrogramMaxHz,
  readSpectrogramMinHz,
  writeAutoPauseOnSilence,
  writeHalfResolutionCanvas,
  writeKeepRunningInBackground,
  writePitchMaxNote,
  writePitchMinNote,
  writeRunAt30Fps,
  writeSpectrogramMaxHz,
  writeSpectrogramMinHz,
} from "./Recorder/config.js";

export default function AppShell() {
  const [activeView, setActiveView] = useState(() => readActiveView());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scaleMinNote, setScaleMinNote] = useState(() => readScaleMinNote());
  const [scaleMaxNote, setScaleMaxNote] = useState(() => readScaleMaxNote());
  const [keepRunningInBackground, setKeepRunningInBackground] = useState(() => readKeepRunningInBackground());
  const [autoPauseOnSilence, setAutoPauseOnSilence] = useState(() => readAutoPauseOnSilence());
  const [runAt30Fps, setRunAt30Fps] = useState(() => readRunAt30Fps());
  const [halfResolutionCanvas, setHalfResolutionCanvas] = useState(() => readHalfResolutionCanvas());
  const [pitchMinNote, setPitchMinNote] = useState(() => readPitchMinNote());
  const [pitchMaxNote, setPitchMaxNote] = useState(() => readPitchMaxNote());
  const [spectrogramMinHz, setSpectrogramMinHz] = useState(() => readSpectrogramMinHz());
  const [spectrogramMaxHz, setSpectrogramMaxHz] = useState(() => readSpectrogramMaxHz());
  const [runtimeSettings, setRuntimeSettings] = useState({
    spectrogramNoiseCalibrating: false,
    spectrogramNoiseProfileReady: false,
    onNoiseCalibratePointerDown: () => {
    },
    onNoiseCalibratePointerUp: () => {
    },
    onNoiseCalibrateContextMenu: () => {
    },
    onClearSpectrogramNoiseProfile: () => {
    },
    batteryUsagePerMinute: null,
  });
  const showingScales = activeView === "scales";

  useEffect(() => {
    writeActiveView(activeView);
  }, [activeView]);

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
    writePitchMinNote(pitchMinNote);
    writePitchMaxNote(pitchMaxNote);
  }, [pitchMaxNote, pitchMinNote]);

  useEffect(() => {
    writeSpectrogramMinHz(spectrogramMinHz);
    writeSpectrogramMaxHz(spectrogramMaxHz);
  }, [spectrogramMaxHz, spectrogramMinHz]);

  const onViewChange = (nextView) => {
    setActiveView(nextView);
  };

  const onOpenSettings = () => {
    setSettingsOpen(true);
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
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-black md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
            {showingScales ? (
                <ScalesPage
                    scaleMinNote={scaleMinNote}
                    scaleMaxNote={scaleMaxNote}
                />
            ) : (
                <Recorder
                    activeView={activeView}
                    settingsOpen={settingsOpen}
                    keepRunningInBackground={keepRunningInBackground}
                    autoPauseOnSilence={autoPauseOnSilence}
                    runAt30Fps={runAt30Fps}
                    halfResolutionCanvas={halfResolutionCanvas}
                    pitchMinNote={pitchMinNote}
                    pitchMaxNote={pitchMaxNote}
                    spectrogramMinHz={spectrogramMinHz}
                    spectrogramMaxHz={spectrogramMaxHz}
                    onSettingsRuntimeChange={setRuntimeSettings}
                />
            )}
            <footer className="relative flex h-12 items-stretch gap-2 pr-2 pt-0 pb-0 pl-0 text-xs text-slate-300">
              <div className="flex flex-1 items-stretch">
                <button
                    type="button"
                    onClick={() => onViewChange("scales")}
                    aria-pressed={activeView === "scales"}
                    className={`relative h-full flex-1 rounded-none px-1 text-[15px] font-semibold transition-colors ${
                        activeView === "scales"
                            ? "text-sky-400"
                            : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                    }`}
                >
                  Scales
                  {activeView === "scales" ? (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-sky-400"/>
                  ) : null}
                </button>
                <button
                    type="button"
                    onClick={() => onViewChange("spectrogram")}
                    aria-pressed={activeView === "spectrogram"}
                    className={`relative h-full flex-[1.25] rounded-none px-1 text-[15px] font-semibold transition-colors ${
                        activeView === "spectrogram"
                            ? "text-sky-400"
                            : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                    }`}
                >
                  Spectrogram
                  {activeView === "spectrogram" ? (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-sky-400"/>
                  ) : null}
                </button>
                <button
                    type="button"
                    onClick={() => onViewChange("pitch")}
                    aria-pressed={activeView === "pitch"}
                    className={`relative h-full flex-1 rounded-none px-1 text-[15px] font-semibold transition-colors ${
                        activeView === "pitch"
                            ? "text-sky-400"
                            : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                    }`}
                >
                  Pitch
                  {activeView === "pitch" ? (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-sky-400"/>
                  ) : null}
                </button>
                <button
                    type="button"
                    onClick={() => onViewChange("vibrato")}
                    aria-pressed={activeView === "vibrato"}
                    className={`relative h-full flex-1 rounded-none px-1 text-[15px] font-semibold transition-colors ${
                        activeView === "vibrato"
                            ? "text-sky-400"
                            : "text-slate-300 hover:text-slate-100 active:text-slate-200"
                    }`}
                >
                  Vibrato
                  {activeView === "vibrato" ? (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-sky-400"/>
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
                  <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.8}/>
                </button>
              </div>
            </footer>
          </main>
          {settingsOpen ? (
              <SettingsPanel
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
                  runAt30Fps={runAt30Fps}
                  onRunAt30FpsChange={setRunAt30Fps}
                  halfResolutionCanvas={halfResolutionCanvas}
                  onHalfResolutionCanvasChange={setHalfResolutionCanvas}
                  pitchMinNote={pitchMinNote}
                  pitchMaxNote={pitchMaxNote}
                  pitchNoteOptions={PITCH_NOTE_OPTIONS}
                  onPitchMinNoteChange={onPitchMinNoteChange}
                  onPitchMaxNoteChange={onPitchMaxNoteChange}
                  spectrogramMinHz={spectrogramMinHz}
                  spectrogramMaxHz={spectrogramMaxHz}
                  onSpectrogramMinHzChange={onSpectrogramMinHzChange}
                  onSpectrogramMaxHzChange={onSpectrogramMaxHzChange}
                  spectrogramNoiseCalibrating={runtimeSettings.spectrogramNoiseCalibrating}
                  spectrogramNoiseProfileReady={runtimeSettings.spectrogramNoiseProfileReady}
                  onNoiseCalibratePointerDown={runtimeSettings.onNoiseCalibratePointerDown}
                  onNoiseCalibratePointerUp={runtimeSettings.onNoiseCalibratePointerUp}
                  onNoiseCalibrateContextMenu={runtimeSettings.onNoiseCalibrateContextMenu}
                  onClearSpectrogramNoiseProfile={runtimeSettings.onClearSpectrogramNoiseProfile}
                  batteryUsagePerMinute={runtimeSettings.batteryUsagePerMinute}
                  disableNoiseSampling={activeView === "scales"}
              />
          ) : null}
        </div>
      </div>
  );
}
