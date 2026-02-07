import {detectPitchAutocorr, lerp} from "./tools.js";

export function createAudioState(defaultSamplesPerSecond) {
  return {
    context: null,
    analyser: null,
    source: null,
    stream: null,
    hzBuffer: null,
    hzIndex: 0,
    timeData: null,
    sampleRate: 48000,
    analysisFps: defaultSamplesPerSecond,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
    levelEma: 0,
  };
}

export function setupAudioState(prevState, {
  analyser,
  context,
  source,
  stream,
  analysisFps,
  fftSize,
  centerSeconds,
  sampleRate,
}) {
  const hzLength = Math.floor(centerSeconds * analysisFps);
  const timeData = prevState.timeData?.length === fftSize
      ? prevState.timeData
      : new Float32Array(fftSize);

  const existingHzBuffer = prevState.hzBuffer;
  const hzBuffer = existingHzBuffer && existingHzBuffer.length === hzLength
      ? existingHzBuffer
      : (() => {
        const buf = new Float32Array(hzLength);
        buf.fill(Number.NaN);
        return buf;
      })();

  return {
    ...prevState,
    context,
    analyser,
    source,
    stream,
    hzBuffer,
    hzIndex: prevState.hzIndex || 0,
    timeData,
    sampleRate,
    analysisFps,
    centerHz: prevState.centerHz || 220,
    centerCents: prevState.centerCents || 1200 * Math.log2(220),
    levelEma: prevState.levelEma || 0,
  };
}

function computeCenterHzMedian(hzBuffer, minHz, maxHz) {
  const values = [];
  for (let i = 0; i < hzBuffer.length; i += 1) {
    const value = hzBuffer[i];
    if (Number.isFinite(value) && value >= minHz && value <= maxHz) {
      values.push(value);
    }
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[mid - 1] + values[mid]) / 2;
  }
  return values[mid];
}

export function analyzeAudioFrame(state, minHz, maxHz) {
  const {analyser, hzBuffer, timeData} = state;
  if (!analyser || !hzBuffer || !timeData) return null;
  analyser.getFloatTimeDomainData(timeData);
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const value = timeData[i];
    const absValue = Math.abs(value);
    if (absValue > peak) peak = absValue;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / timeData.length);
  state.levelEma = lerp(state.levelEma, rms, 0.2);

  const hz = detectPitchAutocorr(timeData, state.sampleRate, minHz, maxHz);

  const inHzRange = hz >= minHz && hz <= maxHz;
  const hasVoice = inHzRange;
  const absCents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;

  if (hasVoice) {
    hzBuffer[state.hzIndex] = hz;
    state.hzIndex = (state.hzIndex + 1) % hzBuffer.length;
    const centerHz = computeCenterHzMedian(hzBuffer, minHz, maxHz);
    if (centerHz > 0) {
      state.centerHz = lerp(state.centerHz, centerHz, 0.2);
      state.centerCents = 1200 * Math.log2(state.centerHz);
    }
  }

  return {
    peak,
    rms: state.levelEma,
    hz,
    hasVoice,
    cents: absCents,
  };
}
