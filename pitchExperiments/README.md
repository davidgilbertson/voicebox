# Playground for experiments

This directory will be used for experimenting with new algorithms to detect pitch.

It will be served as a static site, basic html/js/css, no build, etc.

This uses a local mirror of the app V5 detector (`pitchExperiments/audioSeriesV5.local.js`) so experiments stay no-build while preserving app parity.

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

## Experiment: FFT + Harmonic comb

- Do FFT, generate spectrum
- For each candidate f0 (an FFT bin)
  - Create a harmonic series
  - Subtract that from the spectrum (empty the bins for all harmonics)
  - Lower results mean a better match

## Experiment: FFT + GCD of top-n peaks (v4)

- Do FFT, generate spectrum
- Take the top n peaks (e.g. 3 bins with the highest values)
- Find the GCD of these values, allowing for the fact that they might be off by a bit
- Also allow for the fact that the signal is a human voice
- Examples:
  - if the top 3 peaks are in bins 20, 40, and 101, that suggests that f0 is 20, or close to it
  - f0 might not be in the top 3 peaks, so you might get (40, 60, 80), but since the smallest gap here is 20, we know f0 without it being there
- So one signal is "what's the smallest gap" and another is "what's the lowest value" - the smaller of these is either f0 or a harmonic and an upper bound on what f0 could be.

## Experiment: FFT + walk the peaks (v5)

- Do FFT, generate spectrum
- Go to the max peak. Look left and right (`/2` and `*2`), move to the better one.
- 'Better' is something like higher peak and more peaky?
- Show preference for going down.

A variant of this:

- Take the highest peak
- Iterate through hypotheses of which partial it is (f0, h1, h2, etc)
- If it's f0, you'd expect `/2` to be quiet and `*2` to be loud. And so on.
- You could also say that you'd expect `*1.5` to be (relatively) quiet.
- You probably only need to check around ~20 partials max and each one makes a pretty specific prediction (re where peaks and troughs should be)
- So then if you've got, say H3, then you can go about getting a refined value for f0.

## Experiment: One of the above + history

Note this is only worth doing if I'm getting off-by-one-octave errors.

The major problem is off-by-one-octave errors. But vocals rarely jump one octave in ~40ms. You don't exactly want to take the average with the last value, but if the previous step was an octave lower, and at this step an octave lower was a viable (2nd or 3rd place) candidate, then it's probably the right choice.

## Experiment: ML model

Linear regression. Training data target is just a really good/slow autocorr or high res FFT or some pro software. Inputs are either a raw window or FFT output. Ideally a raw window.
