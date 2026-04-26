import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import {
  getDetectorWindowSamples,
  getDetectorWindowSize,
  getWindowEndSample,
} from "./windowing.js";

const PITCHY_MIN_CLARITY = 0.6;

let pitchyModulePromise = null;

async function getPitchyDetector(frameSize) {
  if (!pitchyModulePromise) {
    pitchyModulePromise = import("https://esm.sh/pitchy@4.1.0");
  }
  const pitchyModule = await pitchyModulePromise;
  return pitchyModule.PitchDetector.forFloat32Array(frameSize);
}

export async function analyzePitchyTrack(windowSequence, samples, sampleRate) {
  const pitchHz = new Array(windowSequence.windowCount);
  const frameSize = getDetectorWindowSize(sampleRate);
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
  for (let windowIndex = 0; windowIndex < windowSequence.windowCount; windowIndex += 1) {
    const endSample = getWindowEndSample(windowSequence, windowIndex);
    if (endSample <= 0) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }
    const detectorWindow = getDetectorWindowSamples(samples, sampleRate, endSample);
    if (detectorWindow.length !== frameSize) {
      pitchHz[windowIndex] = Number.NaN;
      continue;
    }

    const [detectedHz, clarity] = pitchyDetector.findPitch(detectorWindow, sampleRate);
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
      windowSequence.windowCount > 0
        ? elapsedMs / (windowSequence.windowCount / windowSequence.windowsPerSecond)
        : Number.NaN,
  };
}
