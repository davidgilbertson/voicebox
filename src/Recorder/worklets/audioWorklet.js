// This worklet is our clock.
// It posts a message every `batchSize` samples (e.g. 600) with the sample count
// and a time-domain RMS signal level in the [0..1] range for silence gating.
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchSize = 0;
    this.pendingSampleCount = 0;
    this.pendingSumSquares = 0;
    this.port.onmessage = (event) => {
      if (event?.data?.type !== "set-batch-size") return;
      const nextBatchSize = Math.floor(event.data.batchSize);
      if (!Number.isFinite(nextBatchSize) || nextBatchSize <= 0 || nextBatchSize === this.batchSize) return;
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
        const signalLevel = Math.sqrt(this.pendingSumSquares / this.pendingSampleCount);
        this.port.postMessage({
          sampleCount: this.pendingSampleCount,
          signalLevel,
        });
        this.pendingSampleCount = 0;
        this.pendingSumSquares = 0;
      }
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
