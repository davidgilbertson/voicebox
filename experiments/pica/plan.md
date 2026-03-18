# PICA Cleanup And Speed Plan

## Faster With No Expected Outcome Change

1. [x] Remove the duplicate compared-region max-abs scan by sharing one cached scale value between correlation and candidate amplitude gating.
2. [x] Replace per-window `Map` caches with array-backed caches indexed by period size.
3. [x] Skip building `foldExtrema` on the carry-forward fast path when the charts/UI do not need it for that window.
4. [x] Fold recent-fold detection and extrema extraction into one pass over the trailing waveform region.
5. [x] Reduce sorts and intermediate arrays in `getExtremaFromFold` by keeping only the strongest extrema needed for each fold.
6. [ ] Trim analysis payloads so debug-only fields are only built when the charts actually need them.
7. [ ] Move more chart/debug helpers out of `picaPitch.js` so the pitch core is easier to read and profile.

## Faster But Might Affect Outcomes

8. [x] Precompute a right-to-left rolling `maxAbs` for the window so each compared region gets exact local scaling without rescanning samples.
9. [ ] Test using whole-window `maxAbs` instead of compared-region `maxAbs` for correlation normalization.
10. [ ] Test carrying fold-level scale summaries forward into candidate generation as an approximation instead of exact region-level scaling.
11. [ ] Revisit whether the low-candidate-amplitude rejection should use compared-region amplitude, whole-window amplitude, or be removed entirely.
