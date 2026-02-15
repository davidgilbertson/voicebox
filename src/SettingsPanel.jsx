import {useEffect, useRef} from "react";

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
                                        useLegacyAutocorr,
                                        onUseLegacyAutocorrChange,
                                        runAt30Fps,
                                        onRunAt30FpsChange,
                                        v5Settings,
                                        onV5SettingChange,
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
                <span>Use legacy autocorr</span>
                <span className="text-xs text-slate-400">
                  Use autocorrelation for pitch/vibrato instead of the shared-FFT detector.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={useLegacyAutocorr}
                  onChange={(event) => onUseLegacyAutocorrChange(event.target.checked)}
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
            {batteryUsageDisplay ? (
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span>Battery use</span>
                  <span>{batteryUsageDisplay}</span>
                </div>
            ) : null}
            <div className="rounded-md border border-slate-700/80 bg-slate-800/50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">
                V5 Detector
              </div>
              <div className="space-y-3">
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>Max P hypothesis</span>
                    <span className="text-xs text-slate-400">2-12</span>
                  </div>
                  <div className="text-xs text-slate-400">Higher can recover more octave-down cases, too high can drift and slow down.</div>
                  <input
                      type="number"
                      min="2"
                      max="12"
                      step="1"
                      value={v5Settings.maxP}
                      onChange={(event) => onV5SettingChange("maxP", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>Scored partial count</span>
                    <span className="text-xs text-slate-400">4-24</span>
                  </div>
                  <div className="text-xs text-slate-400">Too low misses harmonic structure. Too high can overfit noisy tails.</div>
                  <input
                      type="number"
                      min="4"
                      max="24"
                      step="1"
                      value={v5Settings.pCount}
                      onChange={(event) => onV5SettingChange("pCount", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>Refinement partials</span>
                    <span className="text-xs text-slate-400">1-8</span>
                  </div>
                  <div className="text-xs text-slate-400">Too low is jittery. Too high may pull toward bad higher partials.</div>
                  <input
                      type="number"
                      min="1"
                      max="8"
                      step="1"
                      value={v5Settings.pRefineCount}
                      onChange={(event) => onV5SettingChange("pRefineCount", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>Search radius (bins)</span>
                    <span className="text-xs text-slate-400">0-6</span>
                  </div>
                  <div className="text-xs text-slate-400">Too low can miss shifted peaks. Too high can latch onto neighbors.</div>
                  <input
                      type="number"
                      min="0"
                      max="6"
                      step="1"
                      value={v5Settings.searchRadiusBins}
                      onChange={(event) => onV5SettingChange("searchRadiusBins", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>Off-partial penalty</span>
                    <span className="text-xs text-slate-400">0.00-2.00</span>
                  </div>
                  <div className="text-xs text-slate-400">Too low ignores troughs. Too high can punish valid broad peaks.</div>
                  <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={v5Settings.offWeight}
                      onChange={(event) => onV5SettingChange("offWeight", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>P0 expected ratio</span>
                    <span className="text-xs text-slate-400">0.00-1.00</span>
                  </div>
                  <div className="text-xs text-slate-400">Higher rejects P1+ guesses unless P0 is visible. Too high can miss weak fundamentals.</div>
                  <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={v5Settings.expectedP0MinRatio}
                      onChange={(event) => onV5SettingChange("expectedP0MinRatio", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>P0 penalty weight</span>
                    <span className="text-xs text-slate-400">0.00-5.00</span>
                  </div>
                  <div className="text-xs text-slate-400">Higher strongly favors visible fundamentals. Too high can over-penalize good hypotheses.</div>
                  <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.05"
                      value={v5Settings.expectedP0PenaltyWeight}
                      onChange={(event) => onV5SettingChange("expectedP0PenaltyWeight", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>Downward bias per P</span>
                    <span className="text-xs text-slate-400">0.00-0.20</span>
                  </div>
                  <div className="text-xs text-slate-400">Higher prefers lower P hypotheses. Too high can force octave-down errors.</div>
                  <input
                      type="number"
                      min="0"
                      max="0.2"
                      step="0.005"
                      value={v5Settings.downwardBiasPerP}
                      onChange={(event) => onV5SettingChange("downwardBiasPerP", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span>RMS gate</span>
                    <span className="text-xs text-slate-400">0.000-0.100</span>
                  </div>
                  <div className="text-xs text-slate-400">Higher suppresses background noise more aggressively, but can mute quiet singing.</div>
                  <input
                      type="number"
                      min="0"
                      max="0.1"
                      step="0.001"
                      value={v5Settings.minRms}
                      onChange={(event) => onV5SettingChange("minRms", event.target.valueAsNumber)}
                      className="settings-number-input mt-1 h-9 w-full rounded-md border border-slate-600 bg-slate-900 px-2 text-sm text-slate-100"
                  />
                </label>
              </div>
            </div>

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
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Pitch detect on spectrogram</span>
                <span className="text-xs text-slate-400">
                  Keep pitch/vibrato data live while spectrogram is active.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={pitchDetectionOnSpectrogram}
                  onChange={(event) => onPitchDetectionOnSpectrogramChange(event.target.checked)}
                  className={SETTINGS_CHECKBOX_CLASS}
              />
            </label>
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
                      value={spectrogramMinHz}
                      onChange={(event) => onSpectrogramMinHzChange(event.target.valueAsNumber)}
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
                      value={spectrogramMaxHz}
                      onChange={(event) => onSpectrogramMaxHzChange(event.target.valueAsNumber)}
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
