# Voice Pipeline Architecture (Sample-Driven)

This describes the pipeline from audio to chart canvases.

## Core rule

Chart progression is driven by **audio samples**, not wall-clock time.

1. We do not use `elapsedMs` to advance the chart.
2. If no new audio samples are committed, the chart does not move.
3. `requestAnimationFrame` is only for drawing.

## Naming (use these words consistently)

1. `audioSampleRateHz`

- From `AudioContext.sampleRate` (actual device/browser value for this session).
- Example: `48000` (could also be `44100`).

2. `rawAudioSampleQueue`

- Raw samples received from the worklet and waiting to be processed.

3. `rawBatch`

- A fixed-size sample batch used to compute one derived step (pitch + level, and/or spectrum).

4. `rawBatchSize`

- Number of samples in one `rawBatch`.
- Example: `600` samples.

5. `hopSize`

- Number of new samples consumed before emitting the next chart step.
- This is the main control for chart speed.
- In simple mode, `hopSize = rawBatchSize` (no overlap).
- With overlap, `hopSize < rawBatchSize`.

6. `chartWidthPx`

- Canvas/chart width in CSS pixels.
- Example: `400`.

## Pipeline

1. Worklet posts raw audio samples (this can happen several times per animation frame)
2. Append them to `rawAudioSampleQueue`.
3. While enough samples exist, build `rawBatch`.
4. For each `rawBatch`, compute derived values (pitch/level/spectrum).
5. This analysis happens in the worklet-message ingest path, not in `rAF`.
6. Advance by `hopSize`.
7. Commit the derived step to chart backing storage.
8. On `rAF`, draw current chart backing storage.

Spectrogram continuity across tab switches is preserved by keeping chart components mounted (hidden when inactive), so canvas state is retained.

## Pipeline (David's understanding)

There are 3 cadences:

1. Audio worklet `process()` cadence.
2. Main-thread `captureNode.port.onmessage` cadence.
3. `requestAnimationFrame` cadence.

### In the audio worker

1. Worklet class: `AudioCaptureProcessor` (`src/Recorder/worklets/audioCaptureProcessor.js`).
2. Samples are collected into `this.buffer` until `this.batchSize` is reached.
3. On flush, one `Float32Array` is posted to the app (`this.port.postMessage(chunk, [chunk.buffer])`).
4. Batch size is configurable from app via `"set-batch-size"` message.

### In the app, on worklet postMessage

Main callback: `captureNode.port.onmessage` in `src/Recorder/Recorder.jsx`.

1. Raw samples are appended into raw sample queue:
1. `rawBufferRef.current.values`
2. `rawBufferRef.current.readIndex`
3. `rawBufferRef.current.writeIndex`
4. `rawBufferRef.current.size`
2. Raw queue is drained into analysis windows:
1. `analysisRef.current.windowValues`
2. `analysisRef.current.windowIndex`
3. `analysisRef.current.windowCount`
4. `analysisRef.current.hopSize`
5. `analysisRef.current.hopAccumulator`
3. Per emitted step we compute:
1. Pitch + level -> written into pitch timeline ring:
1. `timelineRef.current.values` (pitch cents)
2. `timelineRef.current.levels` (signal level)
3. `timelineRef.current.writeIndex`
4. `timelineRef.current.count`
2. Spectrogram column -> appended to spectrogram pending queue:
1. `pendingColumnsRef.current` (inside `SpectrogramChart`)
2. `pendingColumnCountRef.current` (inside `SpectrogramChart`)
4. Latest analyser snapshots are kept in:
1. `spectrogramCaptureRef.current.normalizedBins`
2. `spectrogramCaptureRef.current.dbBins`
3. `spectrogramCaptureRef.current.detectorBins`
4. `spectrogramCaptureRef.current.filteredBins`
5. Important: these are latest-frame buffers, not a time-history ring.

### On each animation frame

`renderLoop` only draws when dirty (`timelineDirty`/`forceRedrawRef`), then draws active chart.

#### Visible page

1. `activeView === "pitch"`: draw pitch from `timelineRef` ring.
2. `activeView === "vibrato"`: draw vibrato from the same `timelineRef` ring.
3. `activeView === "spectrogram"`:
1. Draw existing spectrogram bitmap history (`renderCanvasRef.current`).
2. Flush pending spectrogram columns (`pendingColumnsRef.current`) in one batched strip update.

#### Hidden pages

1. Hidden chart canvases are mounted but not drawn by `drawActiveChart`.
2. Pitch/vibrato history still advances via shared `timelineRef` ring.
3. Spectrogram history advances by queuing columns in `pendingColumnsRef.current`.
4. On return to spectrogram, pending columns are applied to bitmap in one batched draw.

## Pause behavior

1. Manual pause: keep receiving samples, but do not commit new chart steps.
2. Silence pause: same commit gate.

No commit -> no movement.

## Grounded example

Given:

1. `audioSampleRateHz = 48000`
2. `chartWidthPx = 400`
3. desired speed = `80 px/sec`

Then:

1. Visible chart duration is `400 / 80 = 5s`.
2. One pixel-column represents `1 / 80s = 12.5ms`.
3. `12.5ms` at `48kHz` is `600` samples.
4. Baseline setup: `rawBatchSize = 600`, `hopSize = 600` (no overlap).

That baseline is intentionally simple and is a good first perf/behavior checkpoint.
