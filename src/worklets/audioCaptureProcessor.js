const BATCH_SIZE = 2048;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH_SIZE);
    this.offset = 0;
  }

  flushBuffer() {
    if (this.offset <= 0) return;
    const chunk = this.buffer.slice(0, this.offset);
    this.port.postMessage(chunk, [chunk.buffer]);
    this.offset = 0;
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

    let readIndex = 0;
    while (readIndex < channel.length) {
      const remaining = channel.length - readIndex;
      const available = BATCH_SIZE - this.offset;
      const count = Math.min(remaining, available);
      this.buffer.set(channel.subarray(readIndex, readIndex + count), this.offset);
      this.offset += count;
      readIndex += count;
      if (this.offset >= BATCH_SIZE) {
        this.flushBuffer();
      }
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
