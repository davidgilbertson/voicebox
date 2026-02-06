import {PitchDetector} from "pitchy";
import {YIN} from "pitchfinder";
import {detectPitchAutocorr, lerp} from "./tools.js";

export function createAudioState(defaultAnalysisFps) {
  return {
    context: null,
    analyser: null,
    source: null,
    stream: null,
    pitchBuffer: null,
    pitchIndex: 0,
    hzBuffer: null,
    hzIndex: 0,
    pitchy: null,
    yin: null,
    timeData: null,
    sampleRate: 48000,
    analysisFps: defaultAnalysisFps,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
    lastHz: 0,
    lastCents: 0,
    voiceActive: false,
    levelEma: 0,
    latestCents: Number.NaN,
    latestFiltered: false,
    samples: [],
  };
}

export function setupAudioState(prevState, {
  analyser,
  context,
  source,
  stream,
  analysisFps,
  fftSize,
  pitchSeconds,
  centerSeconds,
  sampleRate,
}) {
  const pitchLength = Math.floor(pitchSeconds * analysisFps);
  const hzLength = Math.floor(centerSeconds * analysisFps);
  const pitchy = PitchDetector.forFloat32Array(fftSize);
  const yin = YIN({sampleRate, threshold: 0.1});
  const timeData = prevState.timeData?.length === fftSize
      ? prevState.timeData
      : new Float32Array(fftSize);

  const existingPitchBuffer = prevState.pitchBuffer;
  const existingHzBuffer = prevState.hzBuffer;
  const pitchBuffer = existingPitchBuffer && existingPitchBuffer.length === pitchLength
      ? existingPitchBuffer
      : (() => {
        const buf = new Float32Array(pitchLength);
        buf.fill(Number.NaN);
        return buf;
      })();
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
    pitchBuffer,
    pitchIndex: prevState.pitchIndex || 0,
    hzBuffer,
    hzIndex: prevState.hzIndex || 0,
    pitchy,
    yin,
    timeData,
    sampleRate,
    analysisFps,
    centerHz: prevState.centerHz || 220,
    centerCents: prevState.centerCents || 1200 * Math.log2(220),
    lastHz: prevState.lastHz || 0,
    lastCents: prevState.lastCents || 0,
    voiceActive: false,
    levelEma: prevState.levelEma || 0,
    latestCents: Number.NaN,
    latestFiltered: false,
    samples: prevState.samples || [],
  };
}

export function applyAnalysisRate(state, analysisFps, pitchSeconds, centerSeconds) {
  const pitchLength = Math.floor(pitchSeconds * analysisFps);
  const hzLength = Math.floor(centerSeconds * analysisFps);
  state.pitchBuffer = state.pitchBuffer?.length === pitchLength
      ? state.pitchBuffer
      : (() => {
        const buf = new Float32Array(pitchLength);
        buf.fill(Number.NaN);
        return buf;
      })();
  state.hzBuffer = state.hzBuffer?.length === hzLength
      ? state.hzBuffer
      : (() => {
        const buf = new Float32Array(hzLength);
        buf.fill(Number.NaN);
        return buf;
      })();
  state.pitchIndex = 0;
  state.hzIndex = 0;
  state.analysisFps = analysisFps;
  state.samples = [];
}

function computeCenterHzMean(hzBuffer) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < hzBuffer.length; i += 1) {
    const value = hzBuffer[i];
    if (Number.isFinite(value) && value > 0) {
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

export function analyzeAudioFrame(state, detectorId, minHz, maxHz) {
  const {analyser, pitchBuffer, hzBuffer, pitchy, yin, timeData} = state;
  if (!analyser || !pitchBuffer || !hzBuffer || !timeData) return null;
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

  let hz = 0;
  if (detectorId === "pitchy" && pitchy) {
    const [detectedHz, clarity] = pitchy.findPitch(timeData, state.sampleRate);
    hz = clarity > 0.7 ? detectedHz : 0;
  } else if (detectorId === "yin" && yin) {
    hz = yin(timeData) || 0;
  } else {
    hz = detectPitchAutocorr(timeData, state.sampleRate, minHz, maxHz);
  }

  const inHzRange = hz >= minHz && hz <= maxHz;
  const hasVoice = inHzRange;
  state.voiceActive = Boolean(hasVoice);

  const absCents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;
  state.latestFiltered = false;
  state.latestCents = absCents;
  state.samples.push({
    time: performance.now(),
    cents: absCents,
    filtered: state.latestFiltered,
  });

  if (hasVoice) {
    state.lastHz = hz;
    hzBuffer[state.hzIndex] = hz;
    state.hzIndex = (state.hzIndex + 1) % hzBuffer.length;
    const centerHz = computeCenterHzMean(hzBuffer);
    if (centerHz > 0) {
      state.centerHz = lerp(state.centerHz, centerHz, 0.2);
      state.centerCents = 1200 * Math.log2(state.centerHz);
    }
  }

  let {pitchIndex} = state;
  pitchBuffer[pitchIndex] = absCents;
  pitchIndex = (pitchIndex + 1) % pitchBuffer.length;
  state.pitchIndex = pitchIndex;
  if (hasVoice) {
    state.lastCents = absCents;
  }

  return {
    peak,
    rms: state.levelEma,
    hz,
  };
}
