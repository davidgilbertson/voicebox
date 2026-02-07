import {useEffect, useRef, useState} from "react";

export default function SettingsPanel({
  open,
  onClose,
  keepRunningInBackground,
  onKeepRunningInBackgroundChange,
  samplesPerSecond,
  onSamplesPerSecondChange,
}) {
  const dialogRef = useRef(null);
  const [samplesPerSecondDraft, setSamplesPerSecondDraft] = useState(String(samplesPerSecond));

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
    setSamplesPerSecondDraft(String(samplesPerSecond));
  }, [samplesPerSecond]);

  const commitSamplesPerSecond = () => {
    const parsed = Number.parseInt(samplesPerSecondDraft, 10);
    if (!Number.isFinite(parsed)) {
      setSamplesPerSecondDraft(String(samplesPerSecond));
      return;
    }
    const clamped = Math.min(600, Math.max(20, parsed));
    onSamplesPerSecondChange(clamped);
    setSamplesPerSecondDraft(String(clamped));
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
          className="m-0 hidden h-full w-full border-0 bg-transparent p-3 sm:p-4 backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm open:flex open:items-center open:justify-center"
      >
        <section className="relative flex h-[88dvh] w-full max-w-[440px] flex-col gap-6 rounded-xl border border-slate-400/70 bg-slate-900/90 p-6 text-slate-100 shadow-2xl">
          <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-3 text-3xl font-semibold text-slate-200 transition hover:text-white"
              aria-label="Close settings"
          >
            &times;
          </button>
          <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">
            Settings
          </div>
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
                className="h-5 w-5 accent-slate-100"
            />
          </label>
          <label className="flex items-start justify-between gap-4 text-sm">
            <div className="flex flex-col gap-1">
              <span>Samples per second</span>
              <span className="text-xs text-slate-400">
                Pitch analysis updates per second. Higher is smoother but uses more CPU.
              </span>
            </div>
            <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={samplesPerSecondDraft}
                onChange={(event) => {
                  const next = event.target.value;
                  if (/^\d*$/.test(next)) {
                    setSamplesPerSecondDraft(next);
                  }
                }}
                onBlur={commitSamplesPerSecond}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-right text-sm text-slate-100"
            />
          </label>
        </section>
      </dialog>
  );
}
