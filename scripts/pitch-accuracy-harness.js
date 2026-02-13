import {performance} from "node:perf_hooks";
import {
  analyzeAudioWindow,
  analyzeAudioWindowFft,
  createAudioState,
  setupAudioState,
} from "../src/audioSeries.js";
import {generateVibratoSignal} from "../test/assets/vibrato.js";

const SAMPLE_RATE = 48_000;
const SAMPLES_PER_SECOND = 200;
const HOP_SIZE = SAMPLE_RATE / SAMPLES_PER_SECOND;
const VIBRATO_MIN_HZ = 65;
const VIBRATO_MAX_HZ = 1100;
const DURATION_SECONDS = 5;
const CENTER_SECONDS = 1;
const FFT_SIZES = [1024, 2048, 4096];
const ALGORITHMS = ["autocorr", "fft_raw", "fft_refined", "fft_refined_wide"];

function centsError(estimatedHz, trueHz) {
  if (!(estimatedHz > 0) || !(trueHz > 0)) return Number.NaN;
  return 1200 * Math.log2(estimatedHz / trueHz);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}

function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function rmse(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum / values.length);
}

function groundTruthHzAtTime({
  baseHz,
  vibratoRateHz,
  vibratoDepthCents,
}, timeSeconds) {
  if (vibratoRateHz <= 0 || vibratoDepthCents <= 0) return baseHz;
  const centsOffset = Math.sin(2 * Math.PI * vibratoRateHz * timeSeconds) * (vibratoDepthCents / 2);
  return baseHz * (2 ** (centsOffset / 1200));
}

function createDetectorState() {
  const seed = createAudioState(SAMPLES_PER_SECOND);
  return setupAudioState(seed, {
    context: null,
    source: null,
    stream: null,
    captureNode: null,
    analyser: null,
    sinkGain: null,
    analysisFps: SAMPLES_PER_SECOND,
    centerSeconds: CENTER_SECONDS,
    sampleRate: SAMPLE_RATE,
  });
}

function detectHz(algorithm, state, window) {
  if (algorithm === "autocorr") {
    return analyzeAudioWindow(state, window, VIBRATO_MIN_HZ, VIBRATO_MAX_HZ, {
      adaptiveRange: true,
    })?.hz ?? 0;
  }
  const refinementMode = algorithm === "fft_raw"
      ? "off"
      : algorithm === "fft_refined_wide"
          ? "wide"
          : "balanced";
  return analyzeAudioWindowFft(state, window, VIBRATO_MIN_HZ, VIBRATO_MAX_HZ, {
    refinementMode,
  })?.hz ?? 0;
}

function evaluateScenario({
  scenario,
  fftSize,
  algorithm,
}) {
  const signal = generateVibratoSignal({
    durationSeconds: DURATION_SECONDS,
    sampleRate: SAMPLE_RATE,
    baseHz: scenario.baseHz,
    vibratoRateHz: scenario.vibratoRateHz,
    vibratoDepthCents: scenario.vibratoDepthCents,
    amplitude: scenario.amplitude,
  });

  const state = createDetectorState();
  const absoluteCentsErrors = [];
  const absoluteHzErrors = [];
  const signedCentsErrors = [];
  let frames = 0;
  let detectedFrames = 0;
  const t0 = performance.now();

  for (let endSample = fftSize; endSample <= signal.length; endSample += HOP_SIZE) {
    const window = signal.subarray(endSample - fftSize, endSample);
    const centerTimeSeconds = (endSample - (fftSize / 2)) / SAMPLE_RATE;
    const truthHz = groundTruthHzAtTime(scenario, centerTimeSeconds);
    const estimatedHz = detectHz(algorithm, state, window);
    const centsDelta = centsError(estimatedHz, truthHz);
    frames += 1;

    if (estimatedHz > 0 && Number.isFinite(centsDelta)) {
      detectedFrames += 1;
      absoluteHzErrors.push(Math.abs(estimatedHz - truthHz));
      absoluteCentsErrors.push(Math.abs(centsDelta));
      signedCentsErrors.push(centsDelta);
    }
  }

  const elapsedMs = performance.now() - t0;
  return {
    scenario: scenario.name,
    fftSize,
    algorithm,
    frames,
    detectedFrames,
    coverage: frames > 0 ? detectedFrames / frames : 0,
    maeHz: mean(absoluteHzErrors),
    maeCents: mean(absoluteCentsErrors),
    rmseCents: rmse(signedCentsErrors),
    p95AbsCents: percentile(absoluteCentsErrors, 95),
    msPerWindow: frames > 0 ? elapsedMs / frames : 0,
  };
}

function formatMetric(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function main() {
  const scenarios = [
    {
      name: "C3 steady",
      baseHz: 130.8128,
      vibratoRateHz: 0,
      vibratoDepthCents: 0,
      amplitude: 0.8,
    },
    {
      name: "C4 vibrato 4Hz 100c",
      baseHz: 261.63,
      vibratoRateHz: 4,
      vibratoDepthCents: 100,
      amplitude: 0.8,
    },
    {
      name: "C4 vibrato 6Hz 200c",
      baseHz: 261.63,
      vibratoRateHz: 6,
      vibratoDepthCents: 200,
      amplitude: 0.8,
    },
    {
      name: "A4 vibrato 8Hz 100c",
      baseHz: 440,
      vibratoRateHz: 8,
      vibratoDepthCents: 100,
      amplitude: 0.8,
    },
    {
      name: "C5 vibrato 6Hz 200c",
      baseHz: 523.2511,
      vibratoRateHz: 6,
      vibratoDepthCents: 200,
      amplitude: 0.8,
    },
  ];

  const detailed = [];
  for (const fftSize of FFT_SIZES) {
    for (const algorithm of ALGORITHMS) {
      for (const scenario of scenarios) {
        detailed.push(evaluateScenario({scenario, fftSize, algorithm}));
      }
    }
  }

  console.log("Pitch Accuracy + FFT Size Sweep");
  console.log(`sampleRate=${SAMPLE_RATE}, samplesPerSecond=${SAMPLES_PER_SECOND}, duration=${DURATION_SECONDS}s`);
  console.log("");

  for (const fftSize of FFT_SIZES) {
    console.log(`=== FFT_SIZE ${fftSize} ===`);
    for (const algorithm of ALGORITHMS) {
      const rows = detailed.filter((row) => row.fftSize === fftSize && row.algorithm === algorithm);
      const c3 = rows.find((row) => row.scenario === "C3 steady");
      console.log(
          `${algorithm.padEnd(16)} meanMaeCents=${formatMetric(mean(rows.map((row) => row.maeCents)))} meanP95AbsCents=${formatMetric(mean(rows.map((row) => row.p95AbsCents)))} meanCoverage=${formatMetric(mean(rows.map((row) => row.coverage)) * 100)}% meanMsWindow=${formatMetric(mean(rows.map((row) => row.msPerWindow)), 3)} c3MaeCents=${formatMetric(c3?.maeCents ?? Number.NaN)}`
      );
    }
  }

  console.log("\nJSON:");
  console.log(JSON.stringify({detailed}, null, 2));
}

main();
