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
                                        pitchMinNote,
                                        pitchMaxNote,
                                        pitchNoteOptions,
                                        onPitchMinNoteChange,
                                        onPitchMaxNoteChange,
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
        <section className="relative flex h-[calc(var(--app-height)*0.88)] max-h-full w-full max-w-[440px] flex-col gap-4 rounded-xl border border-slate-400/70 bg-slate-900/90 p-4 text-slate-100 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
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
          <label className="mt-2 flex items-start justify-between gap-4 text-sm">
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
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-slate-400">Min pitch</div>
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
              <div className="text-xs uppercase tracking-wide text-slate-400">Max pitch</div>
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
          <div className="mt-auto">
            <a
                href="https://github.com/davidgilbertson/voicebox"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-slate-400 underline decoration-slate-500/80 underline-offset-4 transition hover:text-slate-200"
            >
              About
            </a>
          </div>
        </section>
      </dialog>
  );
}
