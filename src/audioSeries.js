import {detectPitchAutocorr, detectPitchAutocorrDetailed, lerp} from "./tools.js";

const ADAPTIVE_RANGE_MIN_FACTOR = 0.5;
const ADAPTIVE_RANGE_MAX_FACTOR = 2;
const ADAPTIVE_RANGE_REACQUIRE_MISSES = 20;
const ADAPTIVE_RANGE_FULL_SCAN_INTERVAL = 40;
const ADAPTIVE_RANGE_SWITCH_RATIO = 1.15;

export function createAudioState(defaultSamplesPerSecond) {
  return {
    context: null,
    analyser: null,
    source: null,
    stream: null,
    captureNode: null,
    sinkGain: null,
    hzBuffer: null,
    hzIndex: 0,
    sampleRate: 48000,
    analysisFps: defaultSamplesPerSecond,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
    levelEma: 0,
    lastTrackedHz: 0,
    missedDetections: 0,
    adaptiveTick: 0,
  };
}

export function setupAudioState(prevState, {
  context,
  source,
  stream,
  captureNode,
  analyser,
  sinkGain,
  analysisFps,
  centerSeconds,
  sampleRate,
}) {
  const hzLength = Math.floor(centerSeconds * analysisFps);

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
    source,
    stream,
    captureNode,
    analyser,
    sinkGain,
    hzBuffer,
    hzIndex: prevState.hzIndex || 0,
    sampleRate,
    analysisFps,
    centerHz: prevState.centerHz || 220,
    centerCents: prevState.centerCents || 1200 * Math.log2(220),
    levelEma: prevState.levelEma || 0,
    lastTrackedHz: prevState.lastTrackedHz || 0,
    missedDetections: prevState.missedDetections || 0,
    adaptiveTick: prevState.adaptiveTick || 0,
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

function computeWindowLevel(state, timeData) {
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
  return {peak, rms: state.levelEma};
}

function finalizeDetection(state, {
  peak,
  hz,
  minHz,
  maxHz,
  adaptiveRange,
  usedWideSearch,
}) {
  const {hzBuffer} = state;
  const inHzRange = hz >= minHz && hz <= maxHz;
  const hasVoice = inHzRange;
  const absCents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;

  if (hasVoice) {
    state.lastTrackedHz = hz;
    state.missedDetections = 0;
    hzBuffer[state.hzIndex] = hz;
    state.hzIndex = (state.hzIndex + 1) % hzBuffer.length;
    const centerHz = computeCenterHzMedian(hzBuffer, minHz, maxHz);
    if (centerHz > 0) {
      state.centerHz = lerp(state.centerHz, centerHz, 0.2);
      state.centerCents = 1200 * Math.log2(state.centerHz);
    }
  } else if (adaptiveRange) {
    state.missedDetections += 1;
    if (state.missedDetections >= ADAPTIVE_RANGE_REACQUIRE_MISSES) {
      state.lastTrackedHz = 0;
    }
  }

  return {
    peak,
    rms: state.levelEma,
    hz,
    hasVoice,
    cents: absCents,
    usedWideSearch,
  };
}

export function analyzeAudioWindow(state, timeData, minHz, maxHz, options = {}) {
  const {hzBuffer} = state;
  if (!hzBuffer || !timeData || !timeData.length) return null;
  const {peak} = computeWindowLevel(state, timeData);

  const adaptiveRange = options.adaptiveRange === true;
  let usedWideSearch = false;
  let detection = null;

  if (adaptiveRange) {
    state.adaptiveTick += 1;
    const canUseTrackedRange =
        state.lastTrackedHz > 0 &&
        state.missedDetections < ADAPTIVE_RANGE_REACQUIRE_MISSES;
    if (canUseTrackedRange) {
      const narrowMinHz = Math.max(minHz, state.lastTrackedHz * ADAPTIVE_RANGE_MIN_FACTOR);
      const narrowMaxHz = Math.min(maxHz, state.lastTrackedHz * ADAPTIVE_RANGE_MAX_FACTOR);
      if (narrowMaxHz > narrowMinHz) {
        const narrowDetection = detectPitchAutocorrDetailed(
            timeData,
            state.sampleRate,
            narrowMinHz,
            narrowMaxHz
        );
        if (narrowDetection.hz > 0) {
          detection = narrowDetection;
          if (state.adaptiveTick % ADAPTIVE_RANGE_FULL_SCAN_INTERVAL === 0) {
            const fullDetection = detectPitchAutocorrDetailed(
                timeData,
                state.sampleRate,
                minHz,
                maxHz
            );
            usedWideSearch = true;
            if (
                fullDetection.hz > 0 &&
                fullDetection.corrRatio > narrowDetection.corrRatio * ADAPTIVE_RANGE_SWITCH_RATIO
            ) {
              detection = fullDetection;
            }
          }
        } else {
          detection = detectPitchAutocorrDetailed(timeData, state.sampleRate, minHz, maxHz);
          usedWideSearch = true;
        }
      }
    }
  }

  if (!detection) {
    const hz = detectPitchAutocorr(timeData, state.sampleRate, minHz, maxHz);
    detection = {hz, corrRatio: 0};
    if (adaptiveRange) {
      usedWideSearch = true;
    }
  }

  const hz = detection.hz;

  return finalizeDetection(state, {
    peak,
    hz,
    minHz,
    maxHz,
    adaptiveRange,
    usedWideSearch,
  });
}
