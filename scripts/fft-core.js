const planCache = new Map();

function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

function reverseBits(value, bits) {
  let reversed = 0;
  for (let i = 0; i < bits; i += 1) {
    reversed = (reversed << 1) | ((value >> i) & 1);
  }
  return reversed;
}

function getPlan(size) {
  const cached = planCache.get(size);
  if (cached) return cached;

  const bits = Math.log2(size);
  const bitReverse = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    bitReverse[i] = reverseBits(i, bits);
  }

  const twiddleCos = new Float64Array(size / 2);
  const twiddleSin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i += 1) {
    const angle = (-2 * Math.PI * i) / size;
    twiddleCos[i] = Math.cos(angle);
    twiddleSin[i] = Math.sin(angle);
  }

  const plan = {bitReverse, twiddleCos, twiddleSin};
  planCache.set(size, plan);
  return plan;
}

function runFftInPlace(real, imag, twiddleCos, twiddleSin) {
  const size = real.length;
  for (let len = 2; len <= size; len <<= 1) {
    const half = len >> 1;
    const step = size / len;
    for (let start = 0; start < size; start += len) {
      for (let i = 0; i < half; i += 1) {
        const twiddleIndex = i * step;
        const wr = twiddleCos[twiddleIndex];
        const wi = twiddleSin[twiddleIndex];

        const evenIndex = start + i;
        const oddIndex = evenIndex + half;

        const oddReal = real[oddIndex];
        const oddImag = imag[oddIndex];
        const tReal = (oddReal * wr) - (oddImag * wi);
        const tImag = (oddReal * wi) + (oddImag * wr);

        const evenReal = real[evenIndex];
        const evenImag = imag[evenIndex];
        real[evenIndex] = evenReal + tReal;
        imag[evenIndex] = evenImag + tImag;
        real[oddIndex] = evenReal - tReal;
        imag[oddIndex] = evenImag - tImag;
      }
    }
  }
}

function applyWindowFunction(input, output, windowFunction) {
  const length = input.length;
  const denom = Math.max(1, length - 1);
  for (let i = 0; i < length; i += 1) {
    if (windowFunction === "blackman") {
      const phase = (2 * Math.PI * i) / denom;
      const blackman = 0.42 - (0.5 * Math.cos(phase)) + (0.08 * Math.cos(2 * phase));
      output[i] = input[i] * blackman;
      continue;
    }
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
    output[i] = input[i] * hann;
  }
}

export function fft(samples, sampleRate, options = {}) {
  if (!samples || !isPowerOfTwo(samples.length)) {
    throw new Error("fft(samples, ...) requires a power-of-two input length.");
  }
  if (!(sampleRate > 0)) {
    throw new Error("fft(samples, sampleRate, ...) requires a positive sampleRate.");
  }

  const requestedSize = Number.isFinite(options.fftSize) ? Math.floor(options.fftSize) : samples.length;
  if (!isPowerOfTwo(requestedSize)) {
    throw new Error("fft(..., {fftSize}) requires fftSize to be a power of two.");
  }
  if (requestedSize < samples.length) {
    throw new Error("fft(..., {fftSize}) requires fftSize >= samples.length.");
  }

  const size = requestedSize;
  const nyquistBin = size / 2;
  const includeNyquist = options.includeNyquist === true;
  const windowFunction = options.windowFunction === "blackman" ? "blackman" : "hann";
  const plan = getPlan(size);
  const outputBinCount = includeNyquist ? (nyquistBin + 1) : nyquistBin;

  const windowed = new Float64Array(samples.length);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const magnitudes = new Float64Array(outputBinCount);
  const magnitudesDb = new Float64Array(outputBinCount);
  const frequenciesHz = new Float64Array(outputBinCount);

  applyWindowFunction(samples, windowed, windowFunction);
  for (let i = 0; i < size; i += 1) {
    const sourceIndex = plan.bitReverse[i];
    real[i] = sourceIndex < windowed.length ? windowed[sourceIndex] : 0;
    imag[i] = 0;
  }

  runFftInPlace(real, imag, plan.twiddleCos, plan.twiddleSin);

  for (let bin = 0; bin < outputBinCount; bin += 1) {
    const magnitude = Math.hypot(real[bin], imag[bin]);
    magnitudes[bin] = magnitude;
    magnitudesDb[bin] = 20 * Math.log10(Math.max(1e-12, magnitude));
    frequenciesHz[bin] = (bin * sampleRate) / size;
  }

  return {
    sampleRate,
    size,
    binSizeHz: sampleRate / size,
    nyquistHz: sampleRate / 2,
    frequencyBinCount: outputBinCount,
    includeNyquist,
    windowFunction,
    frequenciesHz,
    magnitudes,
    magnitudesDb,
  };
}
