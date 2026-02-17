import {Settings} from "lucide-react";
import {useCallback, useEffect, useState} from "react";
import Recorder from "./Recorder/Recorder.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import {readActiveView, writeActiveView} from "./AppShell/config.js";

function hasSameSettingsValues(previousModel, nextModel) {
  if (!previousModel || !nextModel) return false;
  const nextKeys = Object.keys(nextModel);
  for (let i = 0; i < nextKeys.length; i += 1) {
    const key = nextKeys[i];
    if (typeof nextModel[key] === "function") continue;
    if (previousModel[key] !== nextModel[key]) return false;
  }
  return true;
}

export default function AppShell() {
  const [activeView, setActiveView] = useState(() => readActiveView());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsModel, setSettingsModel] = useState(null);

  useEffect(() => {
    writeActiveView(activeView);
  }, [activeView]);

  const onSettingsModelChange = useCallback((nextModel) => {
    setSettingsModel((previousModel) => {
      if (hasSameSettingsValues(previousModel, nextModel)) {
        return previousModel;
      }
      return nextModel;
    });
  }, []);

  return (
      <div className="h-[var(--app-height)] w-full overflow-hidden bg-black text-slate-100">
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-black md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
            <Recorder
                activeView={activeView}
                settingsOpen={settingsOpen}
                onSettingsModelChange={onSettingsModelChange}
            />
            <footer className="relative flex h-12 items-stretch gap-2 pr-2 pt-0 pb-0 pl-0 text-xs text-slate-300">
              <div className="flex flex-1 items-stretch">
                <button
                    type="button"
                    onClick={() => setActiveView("pitch")}
                    aria-pressed={activeView === "pitch"}
                    className={`relative h-full flex-1 overflow-hidden rounded-none px-2 text-[0.92rem] font-semibold transition-colors ${
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
                    onClick={() => setActiveView("vibrato")}
                    aria-pressed={activeView === "vibrato"}
                    className={`relative h-full flex-1 overflow-hidden rounded-none px-2 text-[0.92rem] font-semibold transition-colors ${
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
                <button
                    type="button"
                    onClick={() => setActiveView("spectrogram")}
                    aria-pressed={activeView === "spectrogram"}
                    className={`relative h-full flex-1 overflow-hidden rounded-none px-2 text-[0.92rem] font-semibold transition-colors ${
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
              </div>
              <div className="flex w-10 items-stretch justify-end">
                <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex h-full w-full items-center justify-center rounded-none text-slate-400 transition-colors hover:text-slate-100 active:text-white"
                    aria-label="Open settings"
                >
                  <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.8}/>
                </button>
              </div>
            </footer>
          </main>
          {settingsOpen && settingsModel ? (
              <SettingsPanel
                  open={settingsOpen}
                  onClose={() => setSettingsOpen(false)}
                  {...settingsModel}
              />
          ) : null}
        </div>
      </div>
  );
}
