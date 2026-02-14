# Migration Plan: Experiments -> App Integration

## Phase 1: Baseline Cleanup ✅

1. Remove experiment clutter from app root:

- Delete `scripts/` (experiment scripts only).
- Delete `experiments.md`.

2. Remove temporary detector modes from app UI/state:

- Remove `pitchDetectorModeRef` in `src/App.jsx` and all logic that reads/writes it.
- Remove extra temporary detector mode buttons (`fft_raw`, `fft_refine`, `fft_wide`, `fft_shs`, `fft_residual`) and their `setPitchDetectorMode(...)` calls.
- Restore pitch/vibrato pages to autocorr-only behavior.

3. Remove temporary runtime controls:

- Remove ability to set analysis window size at runtime.
- Remove ability to set spectrogram bin count at runtime.
- Specifically remove these lines from `src/App.jsx`:

```js
const [analysisWindowSize, setAnalysisWindowSize] = useState(() => safeReadAnalysisWindowSize());
const [spectrogramBinCount, setSpectrogramBinCount] = useState(() => safeReadSpectrogramBinCount());
const [pitchDetectorMode, setPitchDetectorMode] = useState(() => safeReadPitchDetectorMode());
```

4. Remove related dead code after the above:

- Storage keys/read helpers/effects that only support those removed settings/modes.
- UI sections that only expose those temporary controls.
- Any now-unused imports.

## Phase 2: Baseline Validation (Autocorr) ✅

1. Run app and manually verify:

- Pitch page works.
- Vibrato page works.
- Spectrogram page works.

2. Confirm no behavior regression after cleanup:

- Hz/BPM display updates.
- Pause/resume and settings behavior still correct.
- No console errors/warnings from removed code paths.

## Phase 3: Integrate V5 Detector ✅

1. Port V5 coarse detector into app pitch path (no experiment-only plumbing).

2. Feed V5 from the same FFT output used by spectrogram rendering (shared analyser output), while keeping detector and display concerns separated.

3. Keep refinement as a distinct phase:

- Coarse f0 hypothesis stage.
- Shared partial-based refinement stage.

4. Initially gate with a temporary internal switch (not user-facing), defaulting to autocorr until validation is complete.

## Phase 4: Validate V5 vs Autocorr

1. Compare on:

- Normal voice.
- Fast vibrato.
- Known octave-drop/problem samples.

2. Check performance on Android target:

- Frame-to-frame stability.
- CPU impact and responsiveness.

3. Iterate on detector weights/penalties only after baseline comparisons are captured.

4. FFT input parity follow-up:

- Temporary state: app now captures two FFT outputs per frame (byte bins for spectrogram rendering + float dB bins for V5 detector parity with experiments).
- Follow-up: remove duplicate capture by unifying to one FFT data path that satisfies both display and detector needs.

## Phase 5: Flip Default + Cleanup

1. Make V5 default for pitch/vibrato when ready.

2. Remove temporary internal switch and any leftover migration scaffolding.

3. Keep `pitchExperiments/` until app behavior is confirmed stable, then remove when no longer needed.
