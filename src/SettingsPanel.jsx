import {useEffect, useRef, useState} from "react";

const SETTINGS_CHECKBOX_CLASS = "settings-checkbox h-5 w-5";

export default function SettingsPanel({
                                        open,
                                        onClose,
                                        keepRunningInBackground,
                                        onKeepRunningInBackgroundChange,
                                        autoPauseOnSilence,
                                        onAutoPauseOnSilenceChange,
                                        showStats,
                                        onShowStatsChange,
                                        pitchDetectionOnSpectrogram,
                                        onPitchDetectionOnSpectrogramChange,
                                        runAt30Fps,
                                        onRunAt30FpsChange,
                                        halfResolutionCanvas,
                                        onHalfResolutionCanvasChange,
                                        pitchMinNote,
                                        pitchMaxNote,
                                        pitchNoteOptions,
                                        onPitchMinNoteChange,
                                        onPitchMaxNoteChange,
                                        spectrogramMinHz,
                                        spectrogramMaxHz,
                                        onSpectrogramMinHzChange,
                                        onSpectrogramMaxHzChange,
                                        spectrogramNoiseCalibrating,
                                        spectrogramNoiseProfileReady,
                                        onNoiseCalibratePointerDown,
                                        onNoiseCalibratePointerUp,
                                        onNoiseCalibrateContextMenu,
                                        onClearSpectrogramNoiseProfile,
                                        batteryUsageDisplay,
}) {
  const dialogRef = useRef(null);
  const [spectrogramMinHzDraft, setSpectrogramMinHzDraft] = useState(() => String(spectrogramMinHz));
  const [spectrogramMaxHzDraft, setSpectrogramMaxHzDraft] = useState(() => String(spectrogramMaxHz));
  const pitchMinIndex = pitchNoteOptions.indexOf(pitchMinNote);
  const pitchMaxIndex = pitchNoteOptions.indexOf(pitchMaxNote);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    setSpectrogramMinHzDraft(String(spectrogramMinHz));
  }, [spectrogramMinHz]);

  useEffect(() => {
    setSpectrogramMaxHzDraft(String(spectrogramMaxHz));
  }, [spectrogramMaxHz]);

  const onSpectrogramMinHzBlur = () => {
    const nextValue = Number(spectrogramMinHzDraft);
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setSpectrogramMinHzDraft(String(spectrogramMinHz));
      return;
    }
    onSpectrogramMinHzChange(nextValue);
  };

  const onSpectrogramMaxHzBlur = () => {
    const nextValue = Number(spectrogramMaxHzDraft);
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setSpectrogramMaxHzDraft(String(spectrogramMaxHz));
      return;
    }
    onSpectrogramMaxHzChange(nextValue);
  };

  return (
      <dialog
          ref={dialogRef}
          onClose={onClose}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
          className="fixed inset-0 m-0 hidden h-[var(--app-height)] w-screen max-h-none max-w-none border-0 bg-transparent p-2 sm:p-3 backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm open:grid open:place-items-center"
      >
        <section className="relative flex h-[calc(var(--app-height)*0.98)] max-h-full w-full max-w-[440px] flex-col overflow-hidden rounded-lg border border-slate-400/70 bg-slate-900/90 text-slate-100 shadow-2xl">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-300">
              Settings
            </div>
            <button
                type="button"
                onClick={onClose}
                className="text-3xl leading-none text-slate-200 transition hover:text-white"
                aria-label="Close settings"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">General</div>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Keep running in background</span>
                <span className="text-xs text-slate-400">
                  When off, recording stops if the app loses focus.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={keepRunningInBackground}
                  onChange={(event) => onKeepRunningInBackgroundChange(event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Auto pause on silence</span>
                <span className="text-xs text-slate-400">
                  Pause timeline writes after brief silence.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={autoPauseOnSilence}
                  onChange={(event) => onAutoPauseOnSilenceChange(event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
            {batteryUsageDisplay ? (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span>Battery use</span>
                  <span>{batteryUsageDisplay}</span>
                </div>
            ) : null}
            <div className="border-t border-slate-700/80"/>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">Pitch Page</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-400">Min</div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-slate-800/80 p-2">
                  <button
                      type="button"
                      onClick={() => onPitchMinNoteChange(pitchNoteOptions[pitchMinIndex - 1])}
                      disabled={pitchMinIndex <= 0}
                      className="h-10 w-10 rounded-md bg-slate-700 text-lg font-semibold text-slate-100 disabled:opacity-40"
                      aria-label="Decrease pitch minimum"
                  >
                    -
                  </button>
                  <div className="min-w-14 text-center text-base font-semibold text-slate-100">{pitchMinNote}</div>
                  <button
                      type="button"
                      onClick={() => onPitchMinNoteChange(pitchNoteOptions[pitchMinIndex + 1])}
                      disabled={pitchMinIndex >= pitchMaxIndex - 1}
                      className="h-10 w-10 rounded-md bg-slate-700 text-lg font-semibold text-slate-100 disabled:opacity-40"
                      aria-label="Increase pitch minimum"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-400">Max</div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-slate-800/80 p-2">
                  <button
                      type="button"
                      onClick={() => onPitchMaxNoteChange(pitchNoteOptions[pitchMaxIndex - 1])}
                      disabled={pitchMaxIndex <= pitchMinIndex + 1}
                      className="h-10 w-10 rounded-md bg-slate-700 text-lg font-semibold text-slate-100 disabled:opacity-40"
                      aria-label="Decrease pitch maximum"
                  >
                    -
                  </button>
                  <div className="min-w-14 text-center text-base font-semibold text-slate-100">{pitchMaxNote}</div>
                  <button
                      type="button"
                      onClick={() => onPitchMaxNoteChange(pitchNoteOptions[pitchMaxIndex + 1])}
                      disabled={pitchMaxIndex >= pitchNoteOptions.length - 1}
                      className="h-10 w-10 rounded-md bg-slate-700 text-lg font-semibold text-slate-100 disabled:opacity-40"
                      aria-label="Increase pitch maximum"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-700/80"/>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">Spectrogram Page</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <label htmlFor="spectrogram-min-hz" className="block text-xs uppercase tracking-wide text-slate-400">
                  Min
                </label>
                <div className="rounded-md bg-slate-800/80 p-2">
                  <input
                      id="spectrogram-min-hz"
                      type="number"
                      inputMode="decimal"
                      value={spectrogramMinHzDraft}
                      onChange={(event) => setSpectrogramMinHzDraft(event.target.value)}
                      onBlur={onSpectrogramMinHzBlur}
                      className="settings-number-input h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100"
                      aria-label="Spectrogram minimum frequency (Hz)"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="spectrogram-max-hz" className="block text-xs uppercase tracking-wide text-slate-400">
                  Max
                </label>
                <div className="rounded-md bg-slate-800/80 p-2">
                  <input
                      id="spectrogram-max-hz"
                      type="number"
                      inputMode="decimal"
                      value={spectrogramMaxHzDraft}
                      onChange={(event) => setSpectrogramMaxHzDraft(event.target.value)}
                      onBlur={onSpectrogramMaxHzBlur}
                      className="settings-number-input h-10 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-slate-100"
                      aria-label="Spectrogram maximum frequency (Hz)"
                  />
                </div>
              </div>
            </div>
            <div className="rounded-md bg-slate-800/80 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onPointerDown={onNoiseCalibratePointerDown}
                    onPointerUp={onNoiseCalibratePointerUp}
                    onPointerCancel={onNoiseCalibratePointerUp}
                    onContextMenu={onNoiseCalibrateContextMenu}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        spectrogramNoiseCalibrating
                            ? "bg-amber-400 text-amber-950"
                            : "bg-slate-600 text-slate-100"
                    } select-none touch-manipulation`}
                >
                  Hold to sample
                </button>
                <button
                    type="button"
                    onClick={onClearSpectrogramNoiseProfile}
                    disabled={!spectrogramNoiseProfileReady}
                    className="rounded-md bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 disabled:opacity-40"
                >
                  Clear
                </button>
                <div className="text-[11px] text-slate-300">
                  {spectrogramNoiseProfileReady ? "Noise profile on" : "Noise profile off"}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Hold to record background noise to subtract from chart.
              </div>
            </div>
            <div className="border-t border-slate-700/80"/>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">Performance</div>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Show stats</span>
                <span className="text-xs text-slate-400">
                  Show perf + signal stats under the chart.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={showStats}
                  onChange={(event) => onShowStatsChange(event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Run at 30 FPS</span>
                <span className="text-xs text-slate-400">
                  Limit rendering to 30 FPS to reduce battery use.<br/>Default is 60 FPS for most devices.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={runAt30Fps}
                  onChange={(event) => onRunAt30FpsChange(event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Half-resolution canvas</span>
                <span className="text-xs text-slate-400">
                  Render charts at 50% pixel density to reduce GPU/CPU cost.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={halfResolutionCanvas}
                  onChange={(event) => onHalfResolutionCanvasChange(event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Disable pitch detection while on spectrogram page</span>
                <span className="text-xs text-slate-400">
                  Faster while spectrogram is active, but pitch/vibrato data pauses.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={!pitchDetectionOnSpectrogram}
                  onChange={(event) => onPitchDetectionOnSpectrogramChange(!event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
            <a
                href="https://github.com/davidgilbertson/voicebox"
                target="_blank"
                rel="noreferrer"
                className="block pt-3 text-xs text-slate-400 underline decoration-slate-500/80 underline-offset-4 transition hover:text-slate-200"
            >
              About
            </a>
          </div>
        </section>
      </dialog>
  );
}
