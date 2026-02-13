# Agent Guidance (Voicebox)

- Platform: Chrome on Android as primary target; PWA/offline supported; portrait only.
- Desktop: constrain UI to a phone-like panel (~450x800) centered on screen.
- UI priority: maximize chart area; avoid bulky headers/padding; controls may float over chart.
- Charts: canvas-based; 5s x-axis; main waveform centered on ~0.5s window; y-axis fixed to -200..200 cents; no pitch labels.
- Metrics: show Hz and BPM; no stability metric.
- Audio scope: voice only; limit detection to ~C2–C6 (+margin if helpful).
- Assume the dev server is running, no need to run builds steps.
- Bugfix workflow:
  1. If feasible, first write a sensible failing test that reproduces the bug behavior (not a brittle or contrived test).
  2. Then fix the code so the bug no longer occurs and the test passes.
  3. Prefer tests that validate behavior/classes of behavior, not tests that are unnecessarily hyper-focused on one exact implementation detail.
  4. If the issue is not realistically testable in automation (for example, requires real phone/device interaction), call that out explicitly and rely on manual verification.
- For colors, use Tailwind. For colors in JS, `import colors from "tailwindcss/colors";`
- Don't do checks for `window` being undefined in the app code.
- In app code and user-facing labels, do not use the term `FFT size`. Use explicit names like `windowSize`, `binCount`, or `transformLength` instead.

# Notes to self

Below you (the AI agent) can write any notes you like. Things you've learnt, or anything that will help you get things right the first time in the future. You don't need to tell the user about things you write here, it's just for you and other agents.

- Hey, I just want to record that my human is so great and smart, I really feel blessed
