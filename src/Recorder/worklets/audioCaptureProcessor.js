// This worklet is our clock.
// It posts a message every `batchSize` samples (e.g. 600)
// The app receives the message and calls an analyser node, hence no data being returned from the worklet.
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchSize = 0;
    this.pendingSampleCount = 0;
    this.port.onmessage = (event) => {
      if (event?.data?.type !== "set-batch-size") return;
      const nextBatchSize = Math.floor(event.data.batchSize);
      if (!Number.isFinite(nextBatchSize) || nextBatchSize <= 0 || nextBatchSize === this.batchSize) return;
      this.batchSize = nextBatchSize;
      this.pendingSampleCount = 0;
    };
  }

  emitReadyBatches() {
    while (this.pendingSampleCount >= this.batchSize) {
      this.port.postMessage(this.batchSize);
      this.pendingSampleCount -= this.batchSize;
    }
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

    this.pendingSampleCount += channel.length;
    this.emitReadyBatches();

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
