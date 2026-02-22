# Plan

## Audio-Clock Simplification (phased)

1. Derive level from spectrum bins instead of raw `windowSamples`.
1. Decide whether we need both `peak` and `rms`; prefer one metric unless both are proven useful.
1. Tune silence/voice threshold(s) to match current behavior as closely as possible.

1. Keep worklet output unchanged for now, but remove dead main-thread variables/paths that were only for raw-window level calculation.
1. Confirm no regressions in pitch/vibrato/silence pause behavior before changing cadence plumbing.

1. Stop using `rawBuffer`/`drainRawBuffer` as the scheduler on main thread.
1. Treat each worklet `onmessage` batch as one hop step (batch size already set to hop size).
1. On each batch: read analyser spectrum once, derive pitch/vibrato/spectrogram/level from that spectrum, commit one chart step.

1. Cleanup pass:
1. simplify/remove `rawBuffer` and `analysisState` plumbing if no longer needed,
1. simplify worklet messaging to minimal payload/cadence contract,
1. update architecture docs and variable naming references.

## Guardrails

1. Keep chart speed sample-driven (no wall-clock scheduler).
1. Preserve pause semantics (manual pause, silence pause, background policy).
1. Validate tab-switch and background/foreground behavior after each phase.

## Naming Consistency Pass

1. Add one short glossary for signal strength terms and apply it consistently in code/docs.
1. Use `magnitude` only for per-bin spectral magnitudes.
1. Use `peakMagnitude` for per-hop max spectral magnitude.
1. Use `level` for normalized `[0..1]` chart/UI intensity values only.
1. Avoid mixed synonyms for the same concept (`peak` vs `max`, `volume` vs `level`) unless they mean different things.
1. Rename variables opportunistically during touched-file edits to avoid a big-bang rename.

I think we can probably clean up the volume logic in general (normalizing in particular and the min/max settings).
