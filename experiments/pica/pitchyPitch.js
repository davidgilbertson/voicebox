import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { getPicaWindowSamples, getPicaWindowSize } from "./windowing.js";

const PITCHY_MIN_CLARITY = 0.6;

let pitchyModulePromise = null;

async function getPitchyDetector(frameSize) {
  if (!pitchyModulePromise) {
    pitchyModulePromise = import("https://esm.sh/pitchy@4.1.0");
  }
  const pitchyModule = await pitchyModulePromise;
  return pitchyModule.PitchDetector.forFloat32Array(frameSize);
}

export async function analyzePitchyTrack(timeSec, samples, sampleRate, timestepsPerSecond) {
  const pitchHz = new Array(timeSec.length);
  const frameSize = getPicaWindowSize(sampleRate);
  let pitchyDetector = null;
  try {
    pitchyDetector = await getPitchyDetector(frameSize);
  } catch (error) {
    console.warn("Pitchy detector unavailable", error);
  }

  if (!pitchyDetector) {
    return {
      pitchHz: pitchHz.fill(Number.NaN),
      msPerSecondAudio: Number.NaN,
    };
  }

  const startMs = performance.now();
  for (let windowIndex = 0; windowIndex < timeSec.length; windowIndex += 1) {
    const picaWindow = getPicaWindowSamples(samples, sampleRate, timeSec[windowIndex]);
    if (picaWindow.length !== frameSize) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }

    const [detectedHz, clarity] = pitchyDetector.findPitch(picaWindow, sampleRate);
    pitchHz[windowIndex] =
      Number.isFinite(detectedHz) &&
      detectedHz >= PICA_MIN_HZ &&
      detectedHz <= PICA_MAX_HZ &&
      clarity >= PITCHY_MIN_CLARITY
        ? detectedHz
        : Number.NaN;
  }
  const elapsedMs = performance.now() - startMs;

  return {
    pitchHz,
    msPerSecondAudio:
      timeSec.length > 0 ? elapsedMs / (timeSec.length / timestepsPerSecond) : Number.NaN,
  };
}
