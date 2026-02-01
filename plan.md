# Plan: Vibrato Monitor (Web, Android Chrome PWA)

## Tasks

- [x] Confirm scope + constraints
  - [x] Chrome Android PWA target (offline via service worker) and portrait-only UI.
  - [x] Desktop mode uses a phone-sized panel (~450x800).
  - [x] Voice-only range C2–C6 (+margin if helpful).

- [x] Feasibility spike (do early)
  - [x] Prototype mic capture + permission flow with explicit user action; observe what survives between sessions.
  - [x] Measure mobile Web Audio latency/jitter; confirm 30 FPS loop is sustainable.
  - [ ] Verify pitch detection on vowel “ee” with real voice samples (no synth).

- [x] Analysis approach selection (prototype-friendly)
  - [x] Evaluate pitch detection options: autocorrelation vs YIN vs FFT peak.
  - [x] If using libs, pick 2–3 likely candidates (e.g., aubio.js, pitchy) and wire a UI toggle to compare outputs side-by-side or switchable.
  - [x] Decide FFT source: Web Audio AnalyserNode vs custom FFT (bundle size + control).

- [x] UI skeleton (chart-first)
  - [x] Build full-height panel layout with maximal chart area; no heavy headers.
  - [x] Add a floating start/stop control over the chart (for mic access).
  - [x] Constrain desktop to ~450x800 with centered panel.

- [x] Main waveform chart MVP (Canvas or uPlot)
  - [x] Implement a 5-second x-axis timeline.
  - [x] Render main waveform centered around a current ~0.5s window.
  - [x] Y-axis fixed to -200..200 cents.
  - [x] No pitch labels.

- [x] Audio pipeline + draw loop
  - [x] Wire mic stream into AudioContext.
  - [x] Use rAF-driven drawing at ~30 FPS; throttle if needed.
  - [x] If rAF decouples from analysis, assume 10ms/update budget and show running mean of analysis + render step times (ms) on screen.

- [ ] Vibrato metrics v1
  - [ ] Track pitch over time and compute rate (Hz) and depth (cents).
  - [ ] Display Hz and BPM (BPM = Hz * 60).
  - [ ] Choose a reasonable “good” range for rate/depth and visualize it on the charts.

- [ ] Secondary charts (rate + depth)
  - [ ] Add two mini charts (5s x-axis) for rate and depth.
  - [ ] Do not include the redundant bar indicators from Android app.

- [x] Prototyping controls + experiments
  - [ ] Add temporary UI toggles for buffer sizes, hop sizes, FFT sizes.
  - [x] If multiple libs are used, allow selection or side-by-side display.
  - [x] Log sparingly; leave key debug values visible in UI.

- [ ] Human vibrato samples (non-synth)
  - [ ] Find or record a small set of real voice vibrato samples for testing.
  - [ ] If external samples are used, confirm licensing and store locally.

- [ ] PWA + offline
  - [ ] Add service worker + manifest; ensure offline load works.
  - [ ] Verify mic permission + offline behavior on Android Chrome.

- [x] QA on device
  - [x] Test on Android Chrome installed as app.
  - [ ] Tune buffers + smoothing for best “ee” vowel tracking.
  - [x] Validate 30 FPS target and CPU usage.

## Open questions
- [x] Should we use uPlot for charts or a bespoke canvas renderer?
- [x] Any preferred pitch detection method or library to prioritize first?
- [x] Is a single toggle to switch algorithms enough, or do you want side-by-side outputs?
