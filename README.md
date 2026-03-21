# Voice Pipeline Architecture

This is the developer-facing overview for the recorder pipeline.

Audio work per hop is small, but battery efficiency still matters.

## Core Rule

Chart progression is driven by audio sample counts, not wall-clock time.

1. No `performance.now()`, `setInterval`, or `setTimeout` is used to advance chart history.
2. `requestAnimationFrame` is only used for drawing.

## Ownership

1. `RecordingEngine` owns recorder runtime behavior:
   1. Audio session lifecycle (`getUserMedia`, `AudioContext`, worklet, analyser, teardown).
   2. Foreground/background policy for recorder pages.
   3. Per-hop processing and pitch-history updates.
   4. Render scheduling and chart drawing dispatch.
   5. Runtime UI state publication (`isAudioRunning`, `error`, `vibratoRate`, battery usage).
2. `Recorder.jsx` is a thin adapter:
   1. Attaches chart refs and container ref to `RecordingEngine`.
   2. Forwards page/settings changes into engine APIs.
   3. Renders overlays and chart components from engine-provided state.

## Adaptive Loudness Model

Voicebox uses a custom `volume` scale derived from hop RMS. It is logarithmic and mapped onto a practical `0..10` range so the numbers are easier to reason about across very quiet and very loud devices.

### Minimum Volume Threshold

This is the quietest sound the user wants to count as real input.

Why it exists:

1. Different devices have very different microphone sensitivity.
2. Different users hold the phone or tablet at different distances.
3. A sensible floor is needed so background noise does not keep the recorder active.

How it is set:

1. There is a default minimum volume threshold.
2. The user can calibrate it by making the quietest sound they want Voicebox to treat as intentional input.

Where it is used:

1. Pitch detection is skipped below this threshold.
2. Auto-pause uses the same threshold.
3. Pitch-line color normalization uses it as the floor.

### Maximum Heard Volume

This is the loudest volume Voicebox has heard recently for that user/device.

Why it exists:

1. The same singing volume can produce very different levels on different microphones.
2. Voicebox needs a device-specific sense of what "loud" looks like.
3. That lets the visuals adapt without requiring manual setup on every device.

How it adapts:

1. Within a session, it can only increase.
2. On page load, the remembered value is decayed by a small factor so it can adapt downward over time as real-world usage changes.

Where it is used:

1. Pitch-line color normalization uses it as the ceiling.
2. Spectrogram brightness uses it to scale quiet-device input up into a more useful part of the color range.

## Recorder Flow

1. The audio worklet counts input samples and posts one message per hop.
2. Each hop includes:
   1. `sampleCount`
   2. `volume`
3. On each hop, `RecordingEngine`:
   1. Captures analyser spectrum in dB.
   2. Uses the current volume threshold to decide whether to run pitch detection.
   3. Updates the running maximum volume when a new louder input is heard.
   4. Updates pitch history and line color strength.
   5. Appends a spectrogram column unless silence auto-pause is active.
4. Rendering happens separately on `requestAnimationFrame`.

## Spectrogram Notes

1. The spectrogram keeps analyser output in dB until render time.
2. The renderer maps dB values into display brightness.
3. It then applies device/session gain based on the current remembered maximum volume.

## PICA Pitch Detection

PICA stands for `Pitch Inference by Candidate Analysis`.

It is the alternate pitch detector used when the recorder is configured to use PICA instead of the older FFT-bin picker.

High-level flow:

1. Take a short trailing waveform window sized to a couple of cycles of the lowest supported pitch.
2. Bail out early if the window is too quiet or has no zero crossings.
3. Split the recent waveform into folds between zero crossings and keep the strongest local extrema from those folds.
4. Turn spacing between pairs of extrema into candidate periods.
5. For each candidate period, score waveform similarity by comparing several period-sized patches of recent audio.
6. Walk each seed period uphill to a nearby local correlation peak and refine it to a sub-sample pitch.
7. Rank surviving candidates using both correlation and octave position, then choose the best one.

If recent history is trustworthy, try a carry-forward fast path first by starting from the previous pitch and locally re-walking it instead of rebuilding candidates from scratch. The carry-forward path is intentionally conservative:

1. It only starts after several full non-carry predictions in a row, to prevent locking on to the wrong pitch before the signal is strong.
2. It uses its own minimum correlation threshold.
3. It is capped to a maximum run length before a fresh search is forced.

## Real Device Examples

`Moderate` is regular singing volume.

Volume:

| Device     | Dead Quiet | Aircon Hum | Moderate | Loud |
| ---------- | ---------- | ---------- | -------- | ---- |
| iPad       | 0.5        | 0.6        | 4.2      | 8.3  |
| Note 9     | 1.8        | 3.2        | 7.3      | 9.0  |
| Galaxy S24 | 1.8        | 3.5        | 7.8      | 9.3  |

RMS:

| Device     | Dead Quiet | Aircon Hum | Moderate | Loud   |
| ---------- | ---------- | ---------- | -------- | ------ |
| iPad       | 0.0001     | 0.0014     | 0.0130   | 0.1200 |
| Note 9     | 0.0008     | 0.0040     | 0.1540   | 0.3600 |
| Galaxy S24 | 0.0013     | 0.0045     | 0.2120   | 0.4300 |
