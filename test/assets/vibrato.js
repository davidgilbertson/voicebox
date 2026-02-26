export function generateVibratoSignal({
  durationSeconds = 5,
  sampleRate = 48_000,
  baseHz = 261.63,
  vibratoRate = 5,
  vibratoDepthCents = 100,
  amplitude = 0.8,
} = {}) {
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const output = new Float32Array(totalSamples);
  let phase = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const timeSeconds = i / sampleRate;
    const centsOffset =
        Math.sin(2 * Math.PI * vibratoRate * timeSeconds) * (vibratoDepthCents / 2);
    const frequency = baseHz * (2 ** (centsOffset / 1200));
    output[i] = Math.sin(phase) * amplitude;
    phase += (2 * Math.PI * frequency) / sampleRate;
  }
  return output;
}

export function copyWindowWithZeroPad(source, startIndex, windowSize) {
  const window = new Float32Array(windowSize);
  if (startIndex >= source.length) {
    return window;
  }
  const available = Math.min(windowSize, source.length - startIndex);
  window.set(source.subarray(startIndex, startIndex + available), 0);
  return window;
}
