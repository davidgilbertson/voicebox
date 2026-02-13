# Voicebox Performance Experiments

## Scope
This file now tracks only meaningful experiments (new method, major benchmark, or clear quality/perf decision point). Minor refactors and one-line tweaks are intentionally not logged.

## Major Results

### 2026-02-11 - Baseline Node Harness (Autocorr-Dominant Cost)
1. Added a Node harness that replays audio and measures per-frame work without browser layout/paint.
2. Baseline finding: autocorrelation pitch work dominated runtime; spectrogram write cost was much smaller.
3. This established `ms/frame` and component timing as the core perf metric for iteration.

### 2026-02-11 - FFT Family Comparison (Speed vs Accuracy Tradeoff)
1. Added FFT pitch paths and compared them against autocorr in the same harness.
2. Key result: `fft_raw` was much faster than autocorr in harness runs while staying competitive on synthetic accuracy fixtures.
3. Refined FFT variants that reintroduced autocorr-like refinement recovered some behavior but largely gave up FFT speed advantage.

### 2026-02-11 - Residual-Score FFT Experiment
1. Implemented and benchmarked a residual-score FFT detector (`fft_residual`).
2. Harness result: residual mode was among the fastest tested FFT methods in this workload class.
3. Real-vocal behavior still required manual inspection for octave-jump robustness.

### 2026-02-12 - Full-File Playground + Interactive Candidate-Score Inspector
1. Upgraded the FFT playground from single-window snapshots to full-track analysis at app-like cadence.
2. Added linked Plotly inspection to select a window and inspect candidate score curves for that exact frame.
3. This became the main debugging surface for diagnosing octave jumps and candidate-scoring behavior.

### 2026-02-12 - Browser-Analyser Parity Alignment (Mock FFT)
1. Playground mock FFT settings were aligned toward browser analyser behavior (Blackman-style configuration and analyser-like bin semantics).
2. Purpose: make offline experiments better reflect the browser FFT context while keeping float magnitudes for detector quality experiments.

## Current Focus
1. Improve FFT-only pitch robustness on real vocals (especially octave errors) while preserving low `ms/frame`.
2. Keep playground/app settings aligned for apples-to-apples comparisons.
3. Continue using:
   1. Node harness for speed.
   2. Interactive score inspector for behavior debugging.
