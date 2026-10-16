import { describe, expect, test } from "vitest";
import { getPitchFromSpectrum } from "../../src/Recorder/pitchDetection.js";
import { hzToCents } from "../../src/pitchScale.js";

const sampleRate = 48_000;
const binCount = 1024;
const binSizeHz = sampleRate / 2 / binCount;

function createDetectionState() {
  return { hzBuffer: new Float32Array(16), hzIndex: 0, sampleRate };
}

// A normalized magnitude spectrum with a single sharp peak at `peakBin`, over a
// near-silent floor (~ a normalized -100 dB bin) so the detector's peakiness
// gate treats it as a real tone rather than noise.
function makePeakSpectrum(peakBin) {
  const spectrum = new Float32Array(binCount).fill(1e-5);
  spectrum[peakBin - 1] = 0.05;
  spectrum[peakBin] = 1;
  spectrum[peakBin + 1] = 0.05;
  return spectrum;
}

describe("FFT pitch detection", () => {
  test("Detects the fundamental frequency of a single spectral peak", () => {
    const peakBin = 19; // 19 * 23.4375 Hz = 445.3125 Hz, exactly on a bin
    const cents = getPitchFromSpectrum(createDetectionState(), makePeakSpectrum(peakBin), 80, 2000);

    expect(cents).toBeCloseTo(hzToCents(peakBin * binSizeHz), 0);
  });

  test("Returns NaN for a flat, noise-like spectrum", () => {
    const flat = new Float32Array(binCount).fill(0.5);
    const cents = getPitchFromSpectrum(createDetectionState(), flat, 80, 2000);

    expect(cents).toBeNaN();
  });

  test("Returns NaN when the peak is outside the configured range", () => {
    const peakBin = 19; // ~445 Hz, below the 600 Hz floor below
    const cents = getPitchFromSpectrum(
      createDetectionState(),
      makePeakSpectrum(peakBin),
      600,
      2000,
    );

    expect(cents).toBeNaN();
  });
});
