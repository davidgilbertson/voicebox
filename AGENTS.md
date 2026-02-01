# Agent Guidance (Voicebox)

- Platform: Chrome on Android as primary target; PWA/offline supported; portrait only.
- Desktop: constrain UI to a phone-like panel (~450x800) centered on screen.
- UI priority: maximize chart area; avoid bulky headers/padding; controls may float over chart.
- Charts: canvas-based; 5s x-axis; main waveform centered on ~0.5s window; y-axis fixed to -200..200 cents; no pitch labels.
- Metrics: show Hz and BPM; no stability metric.
- Audio scope: voice only; limit detection to ~C2–C6 (+margin if helpful).
