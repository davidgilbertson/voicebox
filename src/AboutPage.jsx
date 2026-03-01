import {useEffect, useId} from "react";

const screenshotThumbClass =
    "h-auto w-full max-h-[50vh] max-w-[420px] rounded-lg border border-slate-700/90 bg-slate-900 object-contain lg:max-h-none lg:w-[210px]";

function ScreenshotPopover({src, alt, openLabel}) {
  const popoverId = useId().replace(/:/g, "");

  return (
      <>
        <button
            type="button"
            popoverTarget={popoverId}
            popoverTargetAction="toggle"
            className="mx-auto my-5 w-fit rounded-lg p-0 lg:mx-0 lg:my-0"
            aria-label={`Open ${openLabel} screenshot`}
        >
          <img src={src} alt={alt} className={screenshotThumbClass}/>
        </button>
        <div
            id={popoverId}
            popover="auto"
            className="m-auto rounded-lg border border-slate-600/90 bg-slate-950 p-2 backdrop:bg-black/80"
        >
          <div className="mb-2 flex justify-end">
            <button
                type="button"
                popoverTarget={popoverId}
                popoverTargetAction="hide"
                className="rounded-md bg-slate-800 px-2 py-1 text-sm font-semibold text-slate-100"
            >
              Close
            </button>
          </div>
          <img
              src={src}
              alt={`${alt} full size`}
              className="h-auto max-h-[90vh] w-full max-w-[420px] rounded-md object-contain"
          />
        </div>
      </>
  );
}

export default function AboutPage() {
  useEffect(() => {
    const root = document.getElementById("root");
    const previous = {
      htmlOverflowY: document.documentElement.style.overflowY,
      bodyOverflowY: document.body.style.overflowY,
      rootOverflow: root?.style.overflow ?? "",
      rootHeight: root?.style.height ?? "",
    };

    document.documentElement.style.overflowY = "auto";
    document.body.style.overflowY = "auto";
    if (root) {
      root.style.overflow = "visible";
      root.style.height = "auto";
    }

    return () => {
      document.documentElement.style.overflowY = previous.htmlOverflowY;
      document.body.style.overflowY = previous.bodyOverflowY;
      if (root) {
        root.style.overflow = previous.rootOverflow;
        root.style.height = previous.rootHeight;
      }
    };
  }, []);

  return (
      <main className="min-h-[var(--app-height)] bg-slate-950 px-5 pt-3 pb-7 text-slate-100 sm:px-7">
        <div className="mx-auto flex w-full max-w-[980px] flex-col gap-12 text-lg">
        <header className="space-y-8">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-4xl font-semibold text-slate-100">Voicebox</h1>
            <a
                href="/"
                className="fixed top-3 right-3 z-20 inline-flex shrink-0 rounded-md bg-blue-400 px-4 py-2 font-semibold text-slate-950 transition hover:bg-blue-300 active:bg-blue-500"
            >
              Open Voicebox
            </a>
            </div>
            <p className="leading-relaxed text-slate-300">
              Voicebox is a free online vocal training app. It has a spectrogram, real-time pitch tracking, and vibrato analysis. You can also play scales or tinker on the built-in piano keyboard. And it all works offline.
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="pt-4 text-2xl font-semibold text-slate-100">Scales Page</h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <ScreenshotPopover src="/images/ScalesPage.png" alt="Scales page screenshot" openLabel="Scales"/>
              <div className="lg:flex-1">
                <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300">
                  <li>Plays guided scale patterns.</li>
                  <li>Choose pattern and BPM.</li>
                  <li>
                    By default, scales will start at the bottom of your range (as defined in settings) and increment up one semitone each
                    repeat.
                  </li>
                  <li>When the scale repeats reach the top of your range they will start descending again.</li>
                  <li>
                    Gesture area controls repeat direction:
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      <li>Swipe up: shift up a semitone on repeat</li>
                      <li>Swipe down: shift down a semitone on repeat</li>
                      <li>Swipe right: repeat at same pitch</li>
                    </ul>
                  </li>
                  <li>Swipe repeatedly if you feel like it.</li>
                  <li>Tap the gesture area to play/pause.</li>
                  <li>There's also a piano to play arbitrary notes.</li>
                  <li>In the settings you can define your vocal range. That affects the visible piano keys and the limits for the scales.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="pt-4 text-2xl font-semibold text-slate-100">Spectrogram Page</h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <ScreenshotPopover
                  src="/images/SpectrogramPage.png"
                  alt="Spectrogram page screenshot"
                  openLabel="Spectrogram"
              />
              <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300 lg:flex-1">
                <li>Shows a live frequency heatmap of your voice.</li>
                <li>Useful for seeing harmonics, noise, and overall tone energy over time.</li>
                <li>You can limit the displayed frequency range and apply background-noise subtraction in settings.</li>
                <li>
                  If you have a constant background noise (e.g. air conditioner) you can record a noise profile in settings which will be
                  subtracted from your voice.
                </li>
                <li>Tap the screen to pause/resume.</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="pt-4 text-2xl font-semibold text-slate-100">Pitch Page</h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <ScreenshotPopover src="/images/PitchPage.png" alt="Pitch page screenshot" openLabel="Pitch"/>
              <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300 lg:flex-1">
                <li>Shows your detected pitch trace over time.</li>
                <li>You can define the visible pitch range in settings.</li>
                <li>Tap the screen to pause/resume.</li>
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="pt-4 text-2xl font-semibold text-slate-100">Vibrato Page</h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <ScreenshotPopover src="/images/VibratoPage.png" alt="Vibrato page screenshot" openLabel="Vibrato"/>
              <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300 lg:flex-1">
                <li>Shows pitch movement plus live vibrato-rate readout (Hz).</li>
                <li>Follows your vibrato, zoomed right in so you can see the shape clearly.</li>
                <li>Includes a target zone on the rate bar to help you stay in a desired vibrato range.</li>
                <li>Tap the screen to pause/resume.</li>
              </ul>
            </div>
          </section>

          <hr className="border-slate-700/80"/>

          <p className="leading-relaxed text-slate-300">
            The Spectrogram, Pitch, and Vibrato pages are all linked, so you can switch between them to see different views of your
            voice, while playing or while paused.
          </p>

          <section className="space-y-4">
            <h2 className="pt-4 text-2xl font-semibold text-slate-100">Settings Panel</h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <ScreenshotPopover src="/images/SettingsPage.png" alt="Settings page screenshot" openLabel="Settings"/>
              <div className="space-y-4 lg:flex-1">
                <h3 className="pt-4 text-lg font-semibold text-slate-200">General</h3>
                <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300">
                  <li>
                    <strong>Keep running in background</strong>: continue recording when app loses focus.
                  </li>
                  <li>
                    <strong>Auto pause on silence</strong>: pauses pitch-history writes during silence.
                  </li>
                </ul>

                <h3 className="pt-4 text-lg font-semibold text-slate-200">Scales Page</h3>
                <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300">
                  <li>
                    <strong>Min / Max</strong>: note range used for scale playback.
                  </li>
                </ul>

                <h3 className="pt-4 text-lg font-semibold text-slate-200">Spectrogram Page</h3>
                <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300">
                  <li>
                    <strong>Min / Max</strong>: frequency range shown on the spectrogram (Hz).
                  </li>
                  <li>
                    <strong>Hold to sample</strong>: captures background noise profile.
                  </li>
                  <li>
                    <strong>Clear</strong>: removes saved noise profile.
                  </li>
                </ul>

                <h3 className="pt-4 text-lg font-semibold text-slate-200">Pitch Page</h3>
                <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300">
                  <li>
                    <strong>Min / Max</strong>: note range shown on the pitch chart.
                  </li>
                </ul>

                <h3 className="pt-4 text-lg font-semibold text-slate-200">Performance</h3>
                <ul className="list-disc space-y-1 pl-5 leading-relaxed text-slate-300">
                  <li>
                    <strong>Run at 30 FPS</strong>: lowers frame rate to reduce battery use. This makes quite a big difference to battery use
                    and is barely noticable.
                  </li>
                  <li>
                    <strong>Half-resolution canvas</strong>: lowers chart render resolution for lower CPU/GPU use.
                  </li>
                  <li>
                    <strong>Battery use</strong>: estimated battery drain rate (<code>%/min</code>). Shows <code>NA</code> when battery stats
                    are unavailable. This reading only makes sense if Voicebox is the only app you're using and it stays active. It updates
                    once per minute.
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </main>
  );
}
