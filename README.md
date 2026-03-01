# Voice Pipeline Architecture (Sample-Driven)

This is the developer-facing architecture reference for the recorder pipeline (mic input to chart rendering).

Audio work is usually under 1 ms per hop, but battery efficiency is still a priority.

## Core Rule

Chart progression is driven by audio sample counts, not wall-clock time.

1. No `performance.now()`, `setInterval`, or `setTimeout` is used to advance chart history.
2. `requestAnimationFrame` is only used for drawing.

## Ownership

1. `AudioEngine` owns recorder runtime behavior:
   1. Audio session lifecycle (`getUserMedia`, `AudioContext`, worklet, analyser, teardown).
   2. Foreground/background policy for recorder pages.
   3. Per-hop processing and pitch-history updates.
   4. Render scheduling (`requestAnimationFrame`) and chart drawing dispatch.
   5. Runtime UI state publication (`isAudioRunning`, `error`, `vibratoRate`, noise-profile status, battery usage).
2. `Recorder.jsx` is a thin adapter:
   1. Attaches chart refs and container ref to `AudioEngine`.
   2. Forwards page/settings changes into engine APIs.
   3. Renders overlays and chart components from engine-provided state.

## Naming

1. `audioSampleRateHz`
   1. From `AudioContext.sampleRate` for the current session.
   2. Example: `48000` (or `44100` on some devices).
2. `hopSize`
   1. Samples per chart step (and per worklet message).
   2. Main speed control.
   3. Example with `80 px/sec` at `48 kHz`: `hopSize = 600`.
3. `FFT_SIZE`
   1. `AnalyserNode` input window sample count.
   2. `frequencyBinCount` is always `FFT_SIZE / 2`.
   3. Current: `FFT_SIZE = 8192`, so `frequencyBinCount = 4096`.
4. `spectrumDb`
   1. Raw analyser spectrum in dB (`getFloatFrequencyData` output).
5. `spectrumNormalized`
   1. Per-bin spectrogram intensity in `[0..1]`, normalized from analyser dB range.
6. `spectrumForPitchDetection`
   1. Per-bin linear magnitudes, peak-normalized per hop for pitch detection.
7. `signalLevel`
   1. Time-domain RMS from worklet input samples, in a practical `[0..1]` range.
   2. Used for silence gating, auto-pause thresholding, and line-color normalization.
8. `maxSignalLevel`
   1. Running per-session maximum of `signalLevel` (after warmup).
   2. Initialized from persisted localStorage value with a decay factor (`stored * 0.9`).
9. `lineStrength`
   1. Normalized `[0..1]` value used for pitch/vibrato line coloring.
   2. Stored in pitch history as `lineStrengthRing`.

## Pipeline

1. Audio worklet (`AudioCaptureProcessor`) counts incoming input samples.
2. Every full `hopSize` samples, it posts one message containing:
   1. `sampleCount` (expected to equal `hopSize`)
   2. `signalLevel` (hop RMS, `[0..1]`)
3. On each message (`captureNode.port.onmessage` in `src/Recorder/AudioEngine.js`):
   1. Capture analyser spectrum once.
   2. Build `spectrumDb`, `spectrumNormalized`, `spectrumForPitchDetection`.
   3. Silence-gate pitch detection from `signalLevel` threshold.
   4. Detect pitch from `spectrumForPitchDetection` when the gate is open.
   5. Update running `maxSignalLevel` from `signalLevel` after warmup.
   6. Compute `lineStrength` from `signalLevel` using a fixed floor + running max (with EMA smoothing).
   7. Write pitch/lineStrength into shared pitch-history rings.
   8. Append spectrogram column (`spectrumNormalized`, optionally noise-filtered) unless silence-paused.
4. `AudioEngine` `renderLoop` draws when dirty:
   1. Pitch and vibrato read from shared pitch-history rings.
   2. Spectrogram draws from retained bitmap + pending columns queue in `SpectrogramChart`.

## State Objects (Current)

1. Shared pitch-history rings:
   1. `rawPitchCentsRing` (pitch cents)
   2. `smoothedPitchCentsRing` (drawn cents)
   3. `lineStrengthRing` (line color intensity)
   4. `vibratoRateHzRing`
2. Per-hop spectrum capture buffers:
   1. `spectrogramCapture.spectrumDb`
   2. `spectrogramCapture.spectrumNormalized`
   3. `spectrogramCapture.spectrumForPitchDetection`
   4. `spectrogramCapture.spectrumFiltered`
3. Spectrogram pending queue (inside chart component):
   1. `pendingColumnsRef.current`

## Grounded Example

Given:

1. `audioSampleRateHz = 48000`
2. Width `400 px`
3. Speed `80 px/sec`

Then:

1. Visible duration is `400 / 80 = 5 s`.
2. One column is `1 / 80 s = 12.5 ms`.
3. `12.5 ms` at `48 kHz` is `600` samples.
4. So `hopSize = 600` gives one new chart step per `12.5 ms` of audio.
