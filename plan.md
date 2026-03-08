# Signal-Level Plan

## Current state

- Hop `signalLevel` is RMS from the worklet.
- `maxHeardSignalLevel` only increases during a session.
- On startup, code decays persisted max to `stored * 0.8` and writes it back immediately.
- Pitch-line color already uses `minSignalThreshold` as the floor and an adapted max as the ceiling.
- Spectrogram color does not use either threshold yet; it only maps analyser dB range to `[0..1]`.
- README is stale: it still says `stored * 0.9`.

## Goal

Use the same adaptive loudness idea for spectrogram coloring, while keeping FFT-bin contrast useful and making `minSignalThreshold` visibly matter.

## Options

### Option A: global hop gain for the whole spectrogram column

For each hop, compute one loudness factor from RMS:

`columnGain = normalize(signalLevel, minSignalThreshold, maxHeardSignalLevel * 0.8)`

Then apply that factor to every FFT bin in the column, for example:

`columnValue = baseSpectrumNormalized * columnGain`

Pros:

- Simple and cheap.
- Keeps one shared meaning for min/max across pitch line and spectrogram.
- Easy to explain: quiet hops dim the whole column, loud hops brighten it.

Cons:

- It does not really calibrate FFT magnitudes; it just gates/scales them.
- Quiet but tonally clear sounds may become too dim.
- Loud background noise can brighten the whole column.

### Option B: separate spectrogram loudness tracker

Track a second running max derived from spectrogram data, not RMS. Example candidates:

- per-hop max bin magnitude after converting analyser dB to linear
- per-hop percentile/mean of the strongest bins

Then normalize spectrogram columns with:

- floor from `minSignalThreshold`-derived spectrogram floor, and
- ceiling from this spectrogram-specific running max

Pros:

- Better matches what the spectrogram is actually drawing.
- More control over contrast.
- Less likely to wash out columns just because RMS and FFT scale differ.

Cons:

- More moving parts and more tuning.
- Harder to explain and document.
- We now have two adaptive maxima that can drift differently.

## Recommendation

Start with Option A.

Reasoning:

- It is the smallest diff.
- It directly makes both `minSignalThreshold` and `maxHeardSignalLevel` affect the spectrogram.
- It preserves current per-bin FFT shape, which is probably the most important visual information.
- If it feels too flat on real devices, we can add Option B later without undoing other work.

## Proposed implementation

1. Keep current analyser dB -> `spectrumNormalized` conversion.
2. Compute one per-hop loudness factor using the same floor/ceiling concept as pitch-line coloring.
3. Apply that factor when producing the spectrogram column, not when capturing analyser data.
4. Use `minSignalThreshold` as the visible floor: at or below the threshold, the column should be black or near-black.
5. Revisit pitch-line coloring only enough to confirm it already uses `minSignalThreshold` correctly and does not need semantic changes.
6. Update README to say startup decay is `stored * 0.8`, and document that pitch-line and spectrogram coloring now both depend on:
   - `minSignalThreshold` as the floor
   - session-only increasing `maxHeardSignalLevel`
   - startup decay of persisted max for long-term adaptation

## Testing

Add focused `hopProcessing` tests first:

1. Spectrogram column is near-zero when `signalLevel <= minSignalThreshold`.
2. Spectrogram column is scaled up as `signalLevel` approaches adapted max.
3. Pitch-line strength still uses `minSignalThreshold` floor.
4. Persisted max still only increases within a session.
5. README text updated to `0.8`.

## Open tuning question

Should the spectrogram floor be exactly black below `minSignalThreshold`, or just strongly dimmed?

My default would be exactly black because it matches auto-pause semantics and makes the threshold legible.
