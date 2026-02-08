import {useEffect, useRef} from "react";

export default function SettingsPanel({
                                        open,
                                        onClose,
                                        keepRunningInBackground,
                                        onKeepRunningInBackgroundChange,
                                      }) {
  const dialogRef = useRef(null);

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
          className="fixed inset-0 m-0 hidden h-[var(--app-height)] w-screen max-h-none max-w-none border-0 bg-transparent p-3 sm:p-4 backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm open:grid open:place-items-center"
      >
        <section className="relative flex h-[calc(var(--app-height)*0.88)] max-h-full w-full max-w-[440px] flex-col gap-6 rounded-xl border border-slate-400/70 bg-slate-900/90 p-6 text-slate-100 shadow-2xl">
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
