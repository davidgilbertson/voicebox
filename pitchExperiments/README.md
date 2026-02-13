# Playground for experiments

This directory will be used for experimenting with new algorithms to detect pitch.

It will be served as a static site, basic html/js/css, no build, etc.

This must be isolated from the rest of the app, never referencing things in other files or vice versa.

It will be deleted once the experiments are done.

It should use audio samples, no live audio, but beyond that should attempt to work with realistic data (e.g. it should use the browser FFT mechanism because that's what'll be used in the real world)

When writing code, focus on these goals, in descending order of importance

- Good results
- Simple, readable, understandable code.
  - Comments, but not too many.
  - sensible, consistent variable names
  - Not over architected
  - Not littered with catches and checks and edge case covering
- Performance (not important for now)

## Experiment 1: FFT + Harmonic comb

- Do FFT, generate spectrum
- For each candidate f0 (an FFT bin)
  - Create a harmonic series
  - Subtract that from the spectrum (empty the bins for all harmonics)
  - Lower results mean a better match

## Experiment 2: FFT + GCD of top-n peaks

- Do FFT, generate spectrum
- Take the top n peaks (e.g. 3 bins with the highest values)
- Find the GCD of these values, allowing for the fact that they might be off by a bit
- Also allow for the fact that the signal is a human voice
- Examples:
  - if the top 3 peaks are in bins 20, 40, and 101, that suggests that f0 is 20, or close to it
  - f0 might not be in the top 3 peaks, so you might get (40, 60, 80), but since the smallest gap here is 20, we know f0 without it being there
- So one signal is "what's the smallest gap" and another is "what's the lowest value" - the smaller of these is either f0 or a harmonic and an upper bound on what f0 could be.

Maybe something like this:

```js
function approxGcd(values, {
  tol = 1.5,        // allowed "smidge"
  maxDivisor = 8,   // how many d/k candidates to try per pairwise diff
  minInliers = 2
} = {}) {
  const xs = [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
  if (xs.length < 2) return NaN;

  const candidates = new Set();

  // Candidates come only from pairwise diffs (no full range scan)
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const d = xs[j] - xs[i];
      if (d <= tol) continue;
      for (let k = 1; k <= maxDivisor; k += 1) {
        const g = d / k;
        if (g > tol) candidates.add(g);
      }
    }
  }

  function distToNearestMultiple(x, g) {
    const k = Math.max(1, Math.round(x / g));
    return Math.abs(x - k * g);
  }

  let best = {g: NaN, inliers: -1, error: Infinity};

  for (const g of candidates) {
    let inliers = 0;
    let error = 0;
    for (const x of xs) {
      const e = distToNearestMultiple(x, g);
      if (e <= tol) inliers += 1;
      error += Math.min(e, tol); // robust cap
    }

    const better =
        inliers > best.inliers ||
        (inliers === best.inliers && g > best.g) || // prefer larger denominator (20 over 10)
        (inliers === best.inliers && g === best.g && error < best.error);

    if (better) best = {g, inliers, error};
  }

  return best.inliers >= minInliers ? best.g : NaN;
}
```
