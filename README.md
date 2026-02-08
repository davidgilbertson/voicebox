# Voice Box

A web app with a collection of vocal tools.

Currently in Prototype stage.

## Realtime Processing Architecture

The app uses two timing domains:

1. Audio ingest clock: audio arrives continuously and is written to a ring buffer.
2. Render clock: `requestAnimationFrame` drains available buffered audio, advances analysis hops, updates the time series, and renders.

Rationale:

1. Avoids tying data correctness to frame cadence while still rendering at display rate.
2. Avoids introducing a third app-level timer loop (`setInterval`) that duplicates scheduling concerns.
3. Keeps processing deterministic by advancing via sample counts/hop sizes, not wall-clock guesses.

Implementation requirements:

1. Consume buffered audio by sample-count catch-up logic.
2. Keep bounded ring buffers with explicit overflow policy.
3. Optionally cap per-frame work and carry remainder forward to avoid frame spikes.
4. Keep render concerns separate from signal ingestion concerns.

## Vibrato

A shameless copy of the 'Vibrato Monitor' Android app
