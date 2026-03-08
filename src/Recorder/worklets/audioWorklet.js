// Do not import anything into this file. That can appear to work in dev mode, but it breaks when
// the app is bundled for production.

// This worklet is our clock.
// It posts a message every `batchSize` samples (e.g. 600) with the sample count
// and a derived volume value for silence gating.
function rmsToVolume(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min((4 + Math.log10(value)) * 2.6, 10));
}

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchSize = 0;
    this.pendingSampleCount = 0;
    this.pendingSumSquares = 0;
    this.port.onmessage = (event) => {
      if (event?.data?.type !== "set-batch-size") return;
      const nextBatchSize = Math.floor(event.data.batchSize);
      if (!Number.isFinite(nextBatchSize) || nextBatchSize <= 0 || nextBatchSize === this.batchSize)
        return;
      this.batchSize = nextBatchSize;
      this.pendingSampleCount = 0;
      this.pendingSumSquares = 0;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (output && output[0]) {
      output[0].fill(0);
    }
    if (!input || input.length === 0) {
      return true;
    }
    const channel = input[0];
    if (!channel || channel.length === 0) {
      return true;
    }
    if (this.batchSize <= 0) {
      return true;
    }

    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i];
      this.pendingSumSquares += sample * sample;
      this.pendingSampleCount += 1;
      if (this.pendingSampleCount >= this.batchSize) {
        const volume = rmsToVolume(Math.sqrt(this.pendingSumSquares / this.pendingSampleCount));
        this.port.postMessage({
          sampleCount: this.pendingSampleCount,
          volume,
        });
        this.pendingSampleCount = 0;
        this.pendingSumSquares = 0;
      }
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
