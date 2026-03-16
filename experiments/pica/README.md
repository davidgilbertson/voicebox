# PICA - Pitch Inference from Candidate Analysis

This experiment compares the existing FFT-based pitch timeline against a newer pica-sample detector and gives you a quick way to build hand-labeled ground truth.

## High-level flow

1. Load an audio sample from the asset list, or record a short sample from the microphone.
2. Run the existing FFT detector across the whole file. That provides the blue dashed pitch timeline at the top and acts as the initial rough baseline.
3. For each selected timestep, take a short waveform window ending at that FFT frame time.
4. Run the pica-sample detector on that window by:
   1. collecting recent folds between zero crossings,
   2. extracting strong local extrema from those folds,
   3. turning extremum spacing into candidate periods,
   4. walking each candidate period to a nearby local correlation peak,
   5. scoring candidates using correlation, octave bias, and peakiness,
   6. choosing the best surviving candidate as the pitch.
5. Show the selected window in detail:
   1. top chart: FFT, pica, and hand-labeled actual pitch over time,
   2. middle chart: waveform window and selected extrema,
   3. bottom chart: correlation histogram for the selected window.

This stays intentionally lightweight. It is a playground for detector behavior and labeling, not a polished production tool.

## Window choice

- Target low note: E1 (`41.20 Hz`)
- Window size: 2 cycles
- Assumed sample rate for sizing: `48 kHz`
- Result: `2330` samples, about `48.5 ms`

That is a practical minimum for this experiment: smaller windows are cheaper, but much less stable at low pitches.

## Actual labels

Actual labels are stored sparsely in local storage, keyed by source and window index. Only the points you touch are stored.

- A numeric value means "this frame is voiced at about this pitch".
- `null` means "this frame is not vocal".
- Missing means "unlabeled".

The `Auto Fix Actuals` button seeds the local labels by taking each FFT pitch and walking it to a nearby local correlation peak. It rewrites the current source's stored labels, so you can run it when you want that one-off bootstrap pass and leave it off the normal page load path.

## Keyboard shortcuts

- `A`: move one timestep left, always
- `D`: move one timestep right, always
- `Q`: in labeling mode, move left and copy the current pitch estimate into the new timestep, then walk it to the nearest local correlation peak
- `E`: in labeling mode, move right and copy the current pitch estimate into the new timestep, then walk it to the nearest local correlation peak
- `W`: in labeling mode, mark the current timestep as `null` and move to the next timestep
- `S`: in labeling mode, forget the current label and move to the next timestep

You can also click a marker in the bottom correlation chart to set the current timestep's actual pitch directly to that clicked candidate.

## Current use

The intended workflow is to start from places where FFT is already close, then use `Q`, `W`, and `E` to mow across stretches of similar pitch, especially octave-error regions. Use `S` to remove a label when the carried-over value is no longer useful.
