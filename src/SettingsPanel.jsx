import {useEffect, useRef, useState} from "react";
import StepperControl from "./components/StepperControl.jsx";
import {PITCH_LINE_COLOR_MODES} from "./Recorder/waveformColor.js";

const settingsCheckboxClass = "settings-checkbox h-5 w-5 shrink-0";
const settingsSectionHeadingClass = "font-semibold uppercase tracking-[0.18em] text-blue-400";
const PITCH_LINE_MODE_PREVIEW_CLASS_BY_MODE = {
  blue: "pitch-line-mode-preview pitch-line-mode-blue",
  orange: "pitch-line-mode-preview pitch-line-mode-orange",
  green: "pitch-line-mode-preview pitch-line-mode-green",
  cool: "pitch-line-mode-preview pitch-line-mode-cool",
  autumn: "pitch-line-mode-preview pitch-line-mode-autumn",
  terrain: "pitch-line-mode-preview pitch-line-mode-terrain",
  inferno: "pitch-line-mode-preview pitch-line-mode-inferno",
  gist_rainbow: "pitch-line-mode-preview pitch-line-mode-gist-rainbow",
};

export default function SettingsPanel({
                                        open,
                                        onClose,
                                        scaleMinNote,
                                        scaleMaxNote,
                                        scaleNoteOptions,
                                        onScaleMinNoteChange,
                                        onScaleMaxNoteChange,
                                        keepRunningInBackground,
                                        onKeepRunningInBackgroundChange,
                                        autoPauseOnSilence,
                                        onAutoPauseOnSilenceChange,
                                        runAt30Fps,
                                        onRunAt30FpsChange,
                                        halfResolutionCanvas,
                                        onHalfResolutionCanvasChange,
                                        pitchMinNote,
                                        pitchMaxNote,
                                        pitchLineColorMode,
                                        onPitchLineColorModeChange,
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
                                        batteryUsagePerMinute,
                                        disableNoiseSampling,
                                      }) {
  const dialogRef = useRef(null);
  const [spectrogramMinHzDraft, setSpectrogramMinHzDraft] = useState(() => String(spectrogramMinHz));
  const [spectrogramMaxHzDraft, setSpectrogramMaxHzDraft] = useState(() => String(spectrogramMaxHz));
  const scaleMinIndex = scaleNoteOptions.indexOf(scaleMinNote);
  const scaleMaxIndex = scaleNoteOptions.indexOf(scaleMaxNote);
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
  const batteryUsageDisplay =
      batteryUsagePerMinute === null
          ? "NA"
          : batteryUsagePerMinute === "--"
              ? "-- %/min"
              : `${batteryUsagePerMinute.toFixed(2)} %/min`;

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
        <section className="relative flex h-full max-h-none w-full max-w-[600px] flex-col overflow-hidden rounded-lg border border-slate-400/70 bg-slate-900/90 text-slate-100 shadow-2xl">
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
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pt-2 pb-4">
            <div className="font-semibold uppercase tracking-[0.18em] text-blue-400">General</div>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Keep running in background</span>
                <span className="text-xs text-slate-400">
                  Keep recording and scales playback running even if the app doesn't have focus.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={keepRunningInBackground}
                  onChange={(event) => onKeepRunningInBackgroundChange(event.target.checked)}
                  className={settingsCheckboxClass}
              />
            </label>
            <label className="flex items-start justify-between gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <span>Auto pause on silence</span>
                <span className="text-xs text-slate-400">
                  Pause pitch-history writes after brief silence.
                </span>
              </div>
              <input
                  type="checkbox"
                  checked={autoPauseOnSilence}
                  onChange={(event) => onAutoPauseOnSilenceChange(event.target.checked)}
                  className={settingsCheckboxClass}
              />
            </label>
            <div className="h-2 border-t border-slate-700/80"/>
            <div className={settingsSectionHeadingClass}>Scales Page</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-400">Min</div>
                <StepperControl
                    value={scaleMinNote}
                    onDecrement={() => onScaleMinNoteChange(scaleNoteOptions[scaleMinIndex - 1])}
                    onIncrement={() => onScaleMinNoteChange(scaleNoteOptions[scaleMinIndex + 1])}
                    decrementDisabled={scaleMinIndex <= 0}
                    incrementDisabled={scaleMinIndex >= scaleMaxIndex - 1}
                    decrementAriaLabel="Decrease scales minimum"
                    incrementAriaLabel="Increase scales minimum"
                    contentWidth="4ch"
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-400">Max</div>
                <StepperControl
                    value={scaleMaxNote}
                    onDecrement={() => onScaleMaxNoteChange(scaleNoteOptions[scaleMaxIndex - 1])}
                    onIncrement={() => onScaleMaxNoteChange(scaleNoteOptions[scaleMaxIndex + 1])}
                    decrementDisabled={scaleMaxIndex <= scaleMinIndex + 1}
                    incrementDisabled={scaleMaxIndex >= scaleNoteOptions.length - 1}
                    decrementAriaLabel="Decrease scales maximum"
                    incrementAriaLabel="Increase scales maximum"
                    contentWidth="4ch"
                />
              </div>
            </div>
            <div className={settingsSectionHeadingClass}>Spectrogram Page</div>
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
                    disabled={disableNoiseSampling}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        spectrogramNoiseCalibrating
                            ? "bg-amber-400 text-amber-950"
                            : "bg-slate-600 text-slate-100"
                    } select-none touch-manipulation disabled:opacity-40`}
                >
                  Hold to sample
                </button>
                <button
                    type="button"
                    onClick={onClearSpectrogramNoiseProfile}
                    disabled={disableNoiseSampling || !spectrogramNoiseProfileReady}
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
            <div className="h-2 border-t border-slate-700/80"/>
            <div className={settingsSectionHeadingClass}>Pitch Page</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-400">Min</div>
                <StepperControl
                    value={pitchMinNote}
                    onDecrement={() => onPitchMinNoteChange(pitchNoteOptions[pitchMinIndex - 1])}
                    onIncrement={() => onPitchMinNoteChange(pitchNoteOptions[pitchMinIndex + 1])}
                    decrementDisabled={pitchMinIndex <= 0}
                    incrementDisabled={pitchMinIndex >= pitchMaxIndex - 1}
                    decrementAriaLabel="Decrease pitch minimum"
                    incrementAriaLabel="Increase pitch minimum"
                    contentWidth="4ch"
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-slate-400">Max</div>
                <StepperControl
                    value={pitchMaxNote}
                    onDecrement={() => onPitchMaxNoteChange(pitchNoteOptions[pitchMaxIndex - 1])}
                    onIncrement={() => onPitchMaxNoteChange(pitchNoteOptions[pitchMaxIndex + 1])}
                    decrementDisabled={pitchMaxIndex <= pitchMinIndex + 1}
                    incrementDisabled={pitchMaxIndex >= pitchNoteOptions.length - 1}
                    decrementAriaLabel="Decrease pitch maximum"
                    incrementAriaLabel="Increase pitch maximum"
                    contentWidth="4ch"
                />
              </div>
            </div>
            <div className="h-2 border-t border-slate-700/80"/>
            <div className={settingsSectionHeadingClass}>Pitch + Vibrato Pages</div>
            <fieldset className="space-y-2">
              <legend className="block text-xs uppercase tracking-wide text-slate-400">
                Pitch line color
              </legend>
              <div className="rounded-md border border-slate-800 bg-black p-2">
                <div className="space-y-2">
                  {PITCH_LINE_COLOR_MODES.map((mode) => (
                      <label key={mode.value} className="pitch-line-mode-option">
                        <input
                            type="radio"
                            name="pitch-line-color-mode"
                            value={mode.value}
                            checked={pitchLineColorMode === mode.value}
                            onChange={(event) => onPitchLineColorModeChange(event.target.value)}
                            className="h-4 w-4 accent-blue-400"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="text-sm font-medium text-slate-200">
                            {mode.label}
                          </span>
                          <span className={PITCH_LINE_MODE_PREVIEW_CLASS_BY_MODE[mode.value]}/>
                        </div>
                      </label>
                  ))}
                </div>
              </div>
              <div className="text-xs text-slate-400">
                The gradient options respond to volume in real time.
              </div>
            </fieldset>
            <div className="h-2 border-t border-slate-700/80"/>
            <div className={settingsSectionHeadingClass}>Performance</div>
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
                  className={settingsCheckboxClass}
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
                  className={settingsCheckboxClass}
              />
            </label>

            <div className="flex items-center justify-between gap-4 text-sm">
              <span>Battery use</span>
              <span>{batteryUsageDisplay}</span>
            </div>
            <div className="flex items-center justify-between gap-3 pt-3">
              <a
                  href="https://github.com/davidgilbertson/voicebox"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-slate-400 underline decoration-slate-500/80 underline-offset-4 transition hover:text-slate-200"
              >
                About
              </a>
              <div className="text-right text-xs text-slate-500">Build: {__BUILD_TIME_SYDNEY__}</div>
            </div>
          </div>
        </section>
      </dialog>
  );
}
