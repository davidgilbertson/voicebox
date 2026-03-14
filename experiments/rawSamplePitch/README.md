# Raw Sample Pitch Experiment

This playground keeps the FFT-based pitch timeline for now, but swaps the lower chart to a raw waveform view.

## What it does

- Loads an audio sample from `.private/assets` or records 5 seconds from the microphone
- Runs the existing FFT pitch detector to produce the top pitch timeline
- Lets you click a point in that timeline to inspect the raw waveform around the corresponding FFT window center

## Window choice

- Target low note: E1 (`41.20 Hz`)
- Window size: 2 cycles
- Assumed sample rate for sizing: `48 kHz`
- Result: `2330` samples, about `48.5 ms`

That is a pragmatic minimum for a direct sample-domain experiment: one cycle is theoretically smaller, but too fragile to be useful.
