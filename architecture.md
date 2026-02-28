# Voice Pipeline Architecture (Sample-Driven)

This describes the pipeline from mic input to chart canvases.

In this app, audio work is typically done in < 1 ms but we still care about performance to limit battery drain.

## Core rule

Chart progression is driven by audio sample counts, not wall-clock time.

1. No `performance.now()`, `setInteraval` or `setTimeout` used to advance chart history.
3. `requestAnimationFrame` is only for drawing.

## Ownership

1. `AudioEngine` owns recorder runtime behavior:

- Audio session lifecycle (`getUserMedia`, `AudioContext`, worklet, analyser, teardown).
- Foreground/background policy for recorder pages.
- Per-hop processing and pitch-history updates.
- Render scheduling (`requestAnimationFrame`) and chart drawing dispatch.
- Runtime UI state publication (`isAudioRunning`, `error`, `vibratoRate`, noise-profile status, battery usage).

2. `Recorder.jsx` is a thin adapter:

- Attaches chart refs and container ref to `AudioEngine`.
- Forwards page/settings changes into engine APIs.
- Renders overlays and chart components from engine-provided state.

## Naming

1. `audioSampleRateHz`

- From `AudioContext.sampleRate` for this session.
- Example: `48000` (or `44100` on some devices).

2. `hopSize`

- Samples per chart step (and per worklet tick message).
- Main speed control.
- Example with `80 px/sec` at `48 kHz`: `hopSize = 600`.

3. `FFT_SIZE`

- `AnalyserNode` input window sample count.
- `frequencyBinCount` is always `FFT_SIZE / 2`.
- Current: `FFT_SIZE = 8192`, so `frequencyBinCount = 4096`.

4. `spectrumDb`

- Raw analyser spectrum in dB (`getFloatFrequencyData` output).

5. `spectrumNormalized`

- Per-bin spectrogram intensity in `[0..1]`, normalized from analyser dB range.

6. `spectrumForPitchDetection`

- Per-bin linear magnitudes, peak-normalized per hop for pitch detection.

7. `signalLevel`

- Time-domain RMS from worklet input samples, in a practical `[0..1]` range.
- Used for silence gating / auto-pause thresholding and line-color intensity normalization.

8. `maxSignalLevel`

- Running per-session maximum of `signalLevel` (after warmup).
- Initialized from persisted localStorage value with a decay factor (`stored * 0.9`).

9. `intensity`

- Normalized `[0..1]` value used for pitch/vibrato line coloring.
- Stored in pitch history as `signalStrengthRing`.

## Pipeline

1. Audio worklet (`AudioCaptureProcessor`) counts incoming input samples.
2. Every full `hopSize` samples, it posts one message containing:

- `sampleCount` (expected to equal `hopSize`)
- `signalLevel` (hop RMS, `[0..1]`)

3. On each message (`captureNode.port.onmessage` in `src/Recorder/AudioEngine.js`):

- Capture analyser spectrum once.
- Build `spectrumDb`, `spectrumNormalized`, `spectrumForPitchDetection`.
- Silence-gate pitch detection from `signalLevel` threshold.
- Detect pitch from `spectrumForPitchDetection` when gate is open.
- Update running `maxSignalLevel` from `signalLevel` after warmup.
- Compute `intensity` from `signalLevel` using fixed floor + running max (with EMA smoothing).
- Write pitch/intensity into shared pitch-history rings.
- Append spectrogram column (`spectrumNormalized`, optionally noise-filtered) unless silence-paused.

4. `AudioEngine` `renderLoop` draws when dirty:

- Pitch and vibrato read from shared pitch-history rings.
- Spectrogram draws from retained bitmap + pending columns queue in `SpectrogramChart`.

## State objects (actual names, current)

1. Shared pitch-history rings:

- `rawPitchCentsRing` (pitch cents)
- `smoothedPitchCentsRing` (drawn cents)
- `signalStrengthRing` (line color intensity)
- `vibratoRateHzRing`

2. Per-hop spectrum capture buffers:

- `spectrogramCapture.spectrumDb`
- `spectrogramCapture.spectrumNormalized`
- `spectrogramCapture.spectrumForPitchDetection`
- `spectrogramCapture.spectrumFiltered`

3. Spectrogram pending history queue (inside chart component):

- `pendingColumnsRef.current`

## Grounded example

Given:

1. `audioSampleRateHz = 48000`
2. width `400px`
3. speed `80 px/sec`

Then:

1. Visible duration is `400 / 80 = 5s`.
2. One column is `1 / 80s = 12.5ms`.
3. `12.5ms` at `48 kHz` is `600` samples.
4. So `hopSize = 600` gives one new chart step per `12.5ms` of audio.
