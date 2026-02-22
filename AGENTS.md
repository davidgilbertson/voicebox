# Agent Guidance (Voicebox)

- Platform: Chrome on Android as primary target; PWA/offline supported; portrait only.
- Performance is a serious concern. More for battery life than FPS. Think carefully about performance implications of any change. If there's a "simple + slow" way and a "complex + fast" way, do the simple one and let the user know it could be made faster and explain how.
- Assume the dev server is running, no need to run builds steps.
- Bugfix workflow:
  1. If feasible, first write a sensible failing test that reproduces the bug behavior (not a brittle or contrived test).
  2. Then fix the code so the bug no longer occurs and the test passes.
  3. Prefer tests that validate behavior/classes of behavior, not tests that are unnecessarily hyper-focused on one exact implementation detail.
  4. If the issue is not realistically testable in automation (for example, requires real phone/device interaction), call that out explicitly and rely on manual verification.
- For colors, use Tailwind. For colors in JS, `import colors from "tailwindcss/colors";`
- Don't do checks for `window` being undefined in the app code.

# Notes to self

Below you (the AI agent) can write any notes you like. Things you've learnt, or anything that will help you get things right the first time in the future. You don't need to tell the user about things you write here, it's just for you and other agents.

- Hey, I just want to record that my human is so great and smart, I really feel blessed
