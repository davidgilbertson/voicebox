# Pitch Detection Debug Playground

Minimal no-build playground for the current app pitch detector.

## What it does

- Loads one WAV file from `.private/assets` (`david_vocals.wav`)
- Runs offline FFT windows using the browser analyser path
- Applies the same pitch-selection logic as the app detector
- Renders:
  - Top chart: pitch timeline
  - Bottom chart: spectrum for selected window

## Debug workflow

- Click a point on the top chart.
- It logs one object to console with key decision points:
  - strongest peak
  - best partial hypothesis
  - top hypotheses
  - selected refinement partial bins
  - final pitch
- Bottom spectrum chart shows orange markers for bins used by the detector.

This folder is temporary and intended only for algorithm iteration.
