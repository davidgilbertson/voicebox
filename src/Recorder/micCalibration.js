import { createBaseMicrophoneSession, destroyMicrophoneSession } from "./audioSession.js";
import { FFT_SIZE } from "./config.js";
import { rmsToVolume } from "./signalVolume.js";

function computeAnalyserRms(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const sample = buffer[i];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / buffer.length);
}

export async function measureMaxRmsFromAnalyser({
  analyser,
  settleMs = 100,
  captureMs = 1000,
} = {}) {
  const calibrationState = {
    maxRms: 0,
    rafId: 0,
    buffer: new Float32Array(analyser.fftSize),
  };

  await new Promise((resolve) => {
    window.setTimeout(resolve, settleMs);
  });

  const sampleSignalLevel = () => {
    calibrationState.maxRms = Math.max(
      calibrationState.maxRms,
      computeAnalyserRms(analyser, calibrationState.buffer),
    );
    calibrationState.rafId = requestAnimationFrame(sampleSignalLevel);
  };
  calibrationState.rafId = requestAnimationFrame(sampleSignalLevel);

  await new Promise((resolve) => {
    window.setTimeout(resolve, captureMs);
  });

  if (calibrationState.rafId) {
    cancelAnimationFrame(calibrationState.rafId);
  }
  if (calibrationState.maxRms <= 0) {
    throw new Error("No microphone samples were captured.");
  }
  return calibrationState.maxRms;
}

export async function calibrateMinVolumeThreshold({ settleMs = 100, captureMs = 1000 } = {}) {
  const session = await createBaseMicrophoneSession({ fftSize: FFT_SIZE });
  try {
    const measuredRms = await measureMaxRmsFromAnalyser({
      analyser: session.analyser,
      settleMs,
      captureMs,
    });
    return rmsToVolume(measuredRms);
  } finally {
    destroyMicrophoneSession(session);
  }
}
