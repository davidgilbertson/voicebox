# Voice Pipeline Architecture (Sample-Driven)

This describes the pipeline from mic input to chart canvases.

## Core rule

Chart progression is driven by audio sample counts, not wall-clock time.

1. No `performance.now()`, `setInteraval` or `setTimeout` used to advance chart history.
3. `requestAnimationFrame` is only for drawing.

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

7. `spectrumPeakMagnitude`

- Max linear magnitude across one hop's spectrum.
- Used for silence gating and chart intensity scaling.

8. `intensity`

- Normalized `[0..1]` value used for pitch/vibrato line coloring.
- Stored in timeline as `timelineRef.current.intensities`.

## Pipeline

1. Audio worklet (`AudioCaptureProcessor`) counts incoming input samples.
2. Every full `hopSize` samples, it posts one message containing `sampleCount` (expected to equal `hopSize`).
3. On each message (`captureNode.port.onmessage` in `src/Recorder/Recorder.jsx`):

- Capture analyser spectrum once.
- Build `spectrumDb`, `spectrumNormalized`, `spectrumForPitchDetection`, `spectrumPeakMagnitude`.
- Detect pitch from `spectrumForPitchDetection`.
- Compute `intensity` from `spectrumPeakMagnitude` (with EMA smoothing).
- Write pitch/intensity into shared timeline ring.
- Append spectrogram column (`spectrumNormalized`, optionally noise-filtered) unless silence-paused.

4. `renderLoop` draws when dirty:

- Pitch and vibrato read from shared timeline ring.
- Spectrogram draws from retained bitmap + pending columns queue in `SpectrogramChart`.

## State objects (actual names)

1. Shared pitch/vibrato timeline ring:

- `timelineRef.current.values` (pitch cents)
- `timelineRef.current.intensities` (line color intensity)
- `timelineRef.current.writeIndex`
- `timelineRef.current.count`

2. Per-hop spectrum capture buffers:

- `spectrogramCaptureRef.current.spectrumDb`
- `spectrogramCaptureRef.current.spectrumNormalized`
- `spectrogramCaptureRef.current.spectrumForPitchDetection`
- `spectrogramCaptureRef.current.spectrumFiltered`

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
