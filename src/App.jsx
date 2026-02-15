import {useEffect, useMemo, useRef, useState} from "react";
import {clamp, lerp, ls} from "./tools.js";
import {
  analyzeAudioWindow,
  analyzeAudioWindowSpectrumV5,
  createAudioState,
  setupAudioState,
} from "./audioSeries.js";
import {
  createAnalysisState,
  createRawAudioBuffer,
  drainRawBuffer,
  enqueueAudioSamples,
} from "./audioPipeline.js";
import {createPitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {estimateTimelineVibratoRateHz} from "./vibratoRate.js";
import {createSpectrogramTimeline, writeSpectrogramColumn} from "./spectrogramTimeline.js";
import {consumeTimelineElapsed} from "./timelineSteps.js";
import SettingsPanel from "./SettingsPanel.jsx";
import VibratoChart from "./VibratoChart.jsx";
import PitchChart from "./PitchChart.jsx";
import SpectrogramChart from "./SpectrogramChart.jsx";
import {noteNameToCents, noteNameToHz, PITCH_NOTE_OPTIONS} from "./pitchScale.js";
import {BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor} from "./batteryUsage.js";

const ANALYSIS_WINDOW_SIZE = 2048;
const SPECTROGRAM_BIN_COUNT = 4096;
const SAMPLES_PER_SECOND = 200;
const SILENCE_PAUSE_THRESHOLD_MS = 300;
const PITCH_SECONDS = 5; // x axis range
const WAVE_Y_RANGE = 300; // in cents
const CENTER_SECONDS = 1; // Window to use for vertical centering
const RAW_BUFFER_SECONDS = 8;
const VIBRATO_RATE_MIN_HZ = 3;
const VIBRATO_SWEET_MIN_HZ = 4;
const VIBRATO_SWEET_MAX_HZ = 8;
const VIBRATO_RATE_MAX_HZ = 9;
const VIBRATO_ANALYSIS_WINDOW_SECONDS = 0.5;
const VIBRATO_MIN_CONTIGUOUS_SECONDS = 0.4;
const VIBRATO_MAX_MARKER_PX_PER_FRAME = 3;
const VIBRATO_RATE_HOLD_MS = 300;
const PITCH_MIN_NOTE_DEFAULT = "C1";
const PITCH_MAX_NOTE_DEFAULT = "F6";
const SPECTROGRAM_MIN_HZ_DEFAULT = 10;
const SPECTROGRAM_MAX_HZ_DEFAULT = 10_000;
const ACTIVE_VIEW_STORAGE_KEY = "voicebox.activeView";
const ACTIVE_VIEW_DEFAULT = "vibrato";
const AUTO_PAUSE_ON_SILENCE_STORAGE_KEY = "voicebox.autoPauseOnSilence";
const SHOW_STATS_STORAGE_KEY = "voicebox.showStats";
const PITCH_ON_SPECTROGRAM_STORAGE_KEY = "voicebox.pitchDetectionOnSpectrogram";
const USE_LEGACY_AUTOCORR_STORAGE_KEY = "voicebox.useLegacyAutocorr";
const RUN_AT_30_FPS_STORAGE_KEY = "voicebox.runAt30Fps";
const HALF_RESOLUTION_CANVAS_STORAGE_KEY = "voicebox.halfResolutionCanvas";
const V5_SETTINGS_STORAGE_KEY = "voicebox.v5Settings";
const AUTO_PAUSE_ON_SILENCE_DEFAULT = true;
const SHOW_STATS_DEFAULT = false;
const PITCH_ON_SPECTROGRAM_DEFAULT = true;
const USE_LEGACY_AUTOCORR_DEFAULT = true;
const RUN_AT_30_FPS_DEFAULT = false;
const HALF_RESOLUTION_CANVAS_DEFAULT = false;
const SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY = "voicebox.spectrogramNoiseProfile";
const MAX_DRAW_JUMP_CENTS = 80;
const V5_SETTINGS_DEFAULT = {
  maxP: 10,
  pCount: 12,
  pRefineCount: 4,
  searchRadiusBins: 2,
  offWeight: 0.5,
  expectedP0MinRatio: 0.18,
  expectedP0PenaltyWeight: 2.0,
  downwardBiasPerP: 0.02,
  minRms: 0.01,
};

function computeIsForeground() {
  if (document.visibilityState === "hidden") return false;
  if (document.hasFocus) {
    return document.hasFocus();
  }
  return true;
}

function safeReadPitchNote(storageKey, fallback) {
  const stored = ls.get(storageKey, fallback);
  if (typeof stored !== "string") return fallback;
  return PITCH_NOTE_OPTIONS.includes(stored) ? stored : fallback;
}

function safeReadActiveView() {
  const stored = ls.get(ACTIVE_VIEW_STORAGE_KEY, ACTIVE_VIEW_DEFAULT);
  return stored === "pitch" || stored === "vibrato" || stored === "spectrogram"
      ? stored
      : ACTIVE_VIEW_DEFAULT;
}

function safeReadPositiveNumber(storageKey, fallback) {
  const stored = ls.get(storageKey, fallback);
  const value = Number(stored);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safeReadSpectrogramNoiseProfile() {
  const stored = ls.get(SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) return null;
  const profile = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i += 1) {
    const value = Number(stored[i]);
    profile[i] = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }
  return profile;
}

function normalizeV5Settings(source = {}) {
  return {
    maxP: clamp(Math.round(Number(source.maxP ?? V5_SETTINGS_DEFAULT.maxP)), 2, 12),
    pCount: clamp(Math.round(Number(source.pCount ?? V5_SETTINGS_DEFAULT.pCount)), 4, 24),
    pRefineCount: clamp(Math.round(Number(source.pRefineCount ?? V5_SETTINGS_DEFAULT.pRefineCount)), 1, 8),
    searchRadiusBins: clamp(Math.round(Number(source.searchRadiusBins ?? V5_SETTINGS_DEFAULT.searchRadiusBins)), 0, 6),
    offWeight: clamp(Number(source.offWeight ?? V5_SETTINGS_DEFAULT.offWeight), 0, 2),
    expectedP0MinRatio: clamp(Number(source.expectedP0MinRatio ?? V5_SETTINGS_DEFAULT.expectedP0MinRatio), 0, 1),
    expectedP0PenaltyWeight: clamp(Number(source.expectedP0PenaltyWeight ?? V5_SETTINGS_DEFAULT.expectedP0PenaltyWeight), 0, 5),
    downwardBiasPerP: clamp(Number(source.downwardBiasPerP ?? V5_SETTINGS_DEFAULT.downwardBiasPerP), 0, 0.2),
    minRms: clamp(Number(source.minRms ?? V5_SETTINGS_DEFAULT.minRms), 0, 0.1),
  };
}

function safeReadV5Settings() {
  const stored = ls.get(V5_SETTINGS_STORAGE_KEY, null);
  const source = stored && typeof stored === "object" ? stored : {};
  return normalizeV5Settings(source);
}

export default function App() {
  const initialNoiseProfile = useMemo(() => safeReadSpectrogramNoiseProfile(), []);
  const vibratoChartRef = useRef(null);
  const pitchChartRef = useRef(null);
  const spectrogramChartRef = useRef(null);
  const isStartingRef = useRef(false);
  const spectrogramResumeNeedsSignalRef = useRef(false);
  const audioRef = useRef(createAudioState(SAMPLES_PER_SECOND));
  // Single shared timeline feeds both pitch and vibrato views so switching preserves continuity.
  const timelineRef = useRef(createPitchTimeline({
    samplesPerSecond: SAMPLES_PER_SECOND,
    seconds: PITCH_SECONDS,
    silencePauseThresholdMs: SILENCE_PAUSE_THRESHOLD_MS,
    autoPauseOnSilence: AUTO_PAUSE_ON_SILENCE_DEFAULT,
    nowMs: performance.now(),
  }));
  const rawBufferRef = useRef(createRawAudioBuffer(48_000, {
    windowSize: ANALYSIS_WINDOW_SIZE,
    rawBufferSeconds: RAW_BUFFER_SECONDS,
  }));
  const analysisRef = useRef(createAnalysisState(48_000, {
    windowSize: ANALYSIS_WINDOW_SIZE,
    samplesPerSecond: SAMPLES_PER_SECOND,
  }));
  const spectrogramClockRef = useRef({
    writeClockMs: performance.now(),
    accumulator: 0,
  });
  const spectrogramRef = useRef(createSpectrogramTimeline({
    samplesPerSecond: SAMPLES_PER_SECOND,
    seconds: PITCH_SECONDS,
    binCount: SPECTROGRAM_BIN_COUNT,
  }));
  const spectrogramCaptureRef = useRef({
    byteBins: new Uint8Array(SPECTROGRAM_BIN_COUNT),
    normalizedBins: new Float32Array(SPECTROGRAM_BIN_COUNT),
    dbBins: new Float32Array(SPECTROGRAM_BIN_COUNT),
    detectorBins: new Float32Array(SPECTROGRAM_BIN_COUNT),
    filteredBins: new Float32Array(SPECTROGRAM_BIN_COUNT),
  });
  const spectrogramNoiseRef = useRef({
    profile: initialNoiseProfile,
    calibrating: false,
    sumBins: null,
    sampleCount: 0,
  });
  const batteryUsageMonitorRef = useRef(createBatteryUsageMonitor());
  const animationRef = useRef({
    rafId: 0,
    lastFrameMs: 0,
    drawAvg: 0,
    dataAvg: 0,
    displayedVibratoRateHz: null,
    lastValidVibratoRateMs: null,
  });
  const metricsRef = useRef({
    level: {rms: 0},
    rawHz: 0,
    hasVoice: false,
    hasDataTiming: false,
  });
  const forceRedrawRef = useRef(false);
  const activeViewRef = useRef(ACTIVE_VIEW_DEFAULT);
  const runAt30FpsRef = useRef(RUN_AT_30_FPS_DEFAULT);
  const pitchRangeRef = useRef({
    minHz: noteNameToHz(PITCH_MIN_NOTE_DEFAULT),
    maxHz: noteNameToHz(PITCH_MAX_NOTE_DEFAULT),
    minCents: noteNameToCents(PITCH_MIN_NOTE_DEFAULT),
    maxCents: noteNameToCents(PITCH_MAX_NOTE_DEFAULT),
  });
  const [ui, setUi] = useState({
    isRunning: false,
    error: "",
    vibratoRateHz: null,
  });
  const [hasEverRun, setHasEverRun] = useState(false);
  const [stats, setStats] = useState({
    timings: {data: null, draw: 0},
    level: {rms: 0},
    rawHz: 0,
  });
  const [activeView, setActiveView] = useState(() => safeReadActiveView());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wantsToRun, setWantsToRun] = useState(true);
  const [isForeground, setIsForeground] = useState(() => computeIsForeground());
  const [keepRunningInBackground, setKeepRunningInBackground] = useState(() => {
    return ls.get("voicebox.keepRunningInBackground", false) === true;
  });
  const [autoPauseOnSilence, setAutoPauseOnSilence] = useState(() => {
    return ls.get(AUTO_PAUSE_ON_SILENCE_STORAGE_KEY, AUTO_PAUSE_ON_SILENCE_DEFAULT) === true;
  });
  const [showStats, setShowStats] = useState(() => {
    return ls.get(SHOW_STATS_STORAGE_KEY, SHOW_STATS_DEFAULT) === true;
  });
  const [pitchDetectionOnSpectrogram, setPitchDetectionOnSpectrogram] = useState(() => {
    return ls.get(PITCH_ON_SPECTROGRAM_STORAGE_KEY, PITCH_ON_SPECTROGRAM_DEFAULT) !== false;
  });
  const [useLegacyAutocorr, setUseLegacyAutocorr] = useState(() => {
    return ls.get(USE_LEGACY_AUTOCORR_STORAGE_KEY, USE_LEGACY_AUTOCORR_DEFAULT) !== false;
  });
  const [runAt30Fps, setRunAt30Fps] = useState(() => {
    return ls.get(RUN_AT_30_FPS_STORAGE_KEY, RUN_AT_30_FPS_DEFAULT) === true;
  });
  const [halfResolutionCanvas, setHalfResolutionCanvas] = useState(() => {
    return ls.get(HALF_RESOLUTION_CANVAS_STORAGE_KEY, HALF_RESOLUTION_CANVAS_DEFAULT) === true;
  });
  const [v5Settings, setV5Settings] = useState(() => safeReadV5Settings());
  const [pitchMinNote, setPitchMinNote] = useState(() => safeReadPitchNote(
      "voicebox.pitchMinNote",
      PITCH_MIN_NOTE_DEFAULT
  ));
  const [pitchMaxNote, setPitchMaxNote] = useState(() => safeReadPitchNote(
      "voicebox.pitchMaxNote",
      PITCH_MAX_NOTE_DEFAULT
  ));
  const [spectrogramMinHz, setSpectrogramMinHz] = useState(() => safeReadPositiveNumber(
      "voicebox.spectrogramMinHz",
      SPECTROGRAM_MIN_HZ_DEFAULT
  ));
  const [spectrogramMaxHz, setSpectrogramMaxHz] = useState(() => safeReadPositiveNumber(
      "voicebox.spectrogramMaxHz",
      SPECTROGRAM_MAX_HZ_DEFAULT
  ));
  const [spectrogramNoiseCalibrating, setSpectrogramNoiseCalibrating] = useState(false);
  const [spectrogramNoiseProfileReady, setSpectrogramNoiseProfileReady] = useState(() => initialNoiseProfile !== null);
  const [batteryUsagePerMinute, setBatteryUsagePerMinute] = useState(null);

  const pitchMinHz = noteNameToHz(pitchMinNote);
  const pitchMaxHz = noteNameToHz(pitchMaxNote);
  const pitchMinCents = noteNameToCents(pitchMinNote);
  const pitchMaxCents = noteNameToCents(pitchMaxNote);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    runAt30FpsRef.current = runAt30Fps;
  }, [runAt30Fps]);

  useEffect(() => {
    pitchRangeRef.current = {
      minHz: pitchMinHz,
      maxHz: pitchMaxHz,
      minCents: pitchMinCents,
      maxCents: pitchMaxCents,
    };
  }, [pitchMaxCents, pitchMaxHz, pitchMinCents, pitchMinHz]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  useEffect(() => {
    ls.set("voicebox.keepRunningInBackground", keepRunningInBackground);
  }, [keepRunningInBackground]);

  useEffect(() => {
    timelineRef.current.autoPauseOnSilence = autoPauseOnSilence;
    ls.set(AUTO_PAUSE_ON_SILENCE_STORAGE_KEY, autoPauseOnSilence);
  }, [autoPauseOnSilence]);

  useEffect(() => {
    ls.set(SHOW_STATS_STORAGE_KEY, showStats);
  }, [showStats]);

  useEffect(() => {
    ls.set(PITCH_ON_SPECTROGRAM_STORAGE_KEY, pitchDetectionOnSpectrogram);
  }, [pitchDetectionOnSpectrogram]);

  useEffect(() => {
    ls.set(USE_LEGACY_AUTOCORR_STORAGE_KEY, useLegacyAutocorr);
  }, [useLegacyAutocorr]);

  useEffect(() => {
    ls.set(RUN_AT_30_FPS_STORAGE_KEY, runAt30Fps);
  }, [runAt30Fps]);

  useEffect(() => {
    ls.set(HALF_RESOLUTION_CANVAS_STORAGE_KEY, halfResolutionCanvas);
  }, [halfResolutionCanvas]);

  useEffect(() => {
    ls.set(V5_SETTINGS_STORAGE_KEY, v5Settings);
  }, [v5Settings]);

  useEffect(() => {
    ls.set("voicebox.pitchMinNote", pitchMinNote);
    ls.set("voicebox.pitchMaxNote", pitchMaxNote);
  }, [pitchMinNote, pitchMaxNote]);

  useEffect(() => {
    ls.set("voicebox.spectrogramMinHz", spectrogramMinHz);
    ls.set("voicebox.spectrogramMaxHz", spectrogramMaxHz);
  }, [spectrogramMaxHz, spectrogramMinHz]);

  useEffect(() => {
    ls.set(ACTIVE_VIEW_STORAGE_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    const updateForeground = () => {
      setIsForeground(computeIsForeground());
    };
    updateForeground();
    document.addEventListener("visibilitychange", updateForeground);
    window.addEventListener("focus", updateForeground);
    window.addEventListener("blur", updateForeground);
    window.addEventListener("pageshow", updateForeground);
    window.addEventListener("pagehide", updateForeground);
    return () => {
      document.removeEventListener("visibilitychange", updateForeground);
      window.removeEventListener("focus", updateForeground);
      window.removeEventListener("blur", updateForeground);
      window.removeEventListener("pageshow", updateForeground);
      window.removeEventListener("pagehide", updateForeground);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;

    const sampleBatteryUsage = async () => {
      const usage = await batteryUsageMonitorRef.current.readUsagePerMinute();
      if (!cancelled) {
        setBatteryUsagePerMinute(usage);
      }
    };

    sampleBatteryUsage();
    if (isForeground) {
      intervalId = window.setInterval(sampleBatteryUsage, BATTERY_SAMPLE_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [isForeground]);

  useEffect(() => {
    const sampleRate = analysisRef.current.sampleRate;
    rawBufferRef.current = createRawAudioBuffer(sampleRate, {
      windowSize: ANALYSIS_WINDOW_SIZE,
      rawBufferSeconds: RAW_BUFFER_SECONDS,
    });
    analysisRef.current = createAnalysisState(sampleRate, {
      windowSize: ANALYSIS_WINDOW_SIZE,
      samplesPerSecond: SAMPLES_PER_SECOND,
    });
  }, []);

  useEffect(() => {
    const analyser = audioRef.current.analyser;
    const analyserFftSize = SPECTROGRAM_BIN_COUNT * 2;
    if (analyser && analyser.fftSize !== analyserFftSize) {
      analyser.fftSize = analyserFftSize;
    }
    const binCount = analyser ? analyser.frequencyBinCount : SPECTROGRAM_BIN_COUNT;
    spectrogramCaptureRef.current = {
      byteBins: new Uint8Array(binCount),
      normalizedBins: new Float32Array(binCount),
      dbBins: new Float32Array(binCount),
      detectorBins: new Float32Array(binCount),
      filteredBins: new Float32Array(binCount),
    };
    spectrogramRef.current = createSpectrogramTimeline({
      samplesPerSecond: SAMPLES_PER_SECOND,
      seconds: PITCH_SECONDS,
      binCount,
    });
    spectrogramClockRef.current = {
      writeClockMs: 0,
      accumulator: 0,
    };
    spectrogramResumeNeedsSignalRef.current = false;
    const noiseState = spectrogramNoiseRef.current;
    if (noiseState.calibrating) {
      noiseState.calibrating = false;
      noiseState.sumBins = null;
      noiseState.sampleCount = 0;
      setSpectrogramNoiseCalibrating(false);
    }
    if (noiseState.profile && noiseState.profile.length !== binCount) {
      noiseState.profile = null;
      ls.set(SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY, null);
      setSpectrogramNoiseProfileReady(false);
    }
    forceRedrawRef.current = true;
  }, []);

  const captureSpectrogramBins = ({includeDetectorBins = true} = {}) => {
    const analyser = audioRef.current.analyser;
    if (!analyser) return null;
    const capture = spectrogramCaptureRef.current;
    if (capture.byteBins.length !== analyser.frequencyBinCount) {
      capture.byteBins = new Uint8Array(analyser.frequencyBinCount);
      capture.normalizedBins = new Float32Array(analyser.frequencyBinCount);
      capture.dbBins = new Float32Array(analyser.frequencyBinCount);
      capture.detectorBins = new Float32Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(capture.byteBins);
    for (let i = 0; i < capture.byteBins.length; i += 1) {
      capture.normalizedBins[i] = capture.byteBins[i] / 255;
    }
    if (includeDetectorBins) {
      analyser.getFloatFrequencyData(capture.dbBins);
      let maxMagnitude = 0;
      for (let i = 0; i < capture.dbBins.length; i += 1) {
        const dbValue = capture.dbBins[i];
        const magnitude = Number.isFinite(dbValue) ? 10 ** (dbValue / 20) : 0;
        capture.detectorBins[i] = magnitude;
        if (magnitude > maxMagnitude) {
          maxMagnitude = magnitude;
        }
      }
      if (maxMagnitude > 0) {
        const scale = 1 / maxMagnitude;
        for (let i = 0; i < capture.detectorBins.length; i += 1) {
          capture.detectorBins[i] *= scale;
        }
      }
    }
    return {
      spectrogramBins: capture.normalizedBins,
      detectorBins: includeDetectorBins ? capture.detectorBins : null,
    };
  };

  const beginSpectrogramNoiseCalibration = () => {
    const noiseState = spectrogramNoiseRef.current;
    const binCount = audioRef.current.analyser?.frequencyBinCount ?? spectrogramRef.current.binCount;
    noiseState.calibrating = true;
    noiseState.sumBins = new Float32Array(binCount);
    noiseState.sampleCount = 0;
    setSpectrogramNoiseCalibrating(true);
  };

  const finishSpectrogramNoiseCalibration = (commitProfile) => {
    const noiseState = spectrogramNoiseRef.current;
    const hasSamples = noiseState.sampleCount > 0 && noiseState.sumBins;
    if (commitProfile && hasSamples) {
      const profile = new Float32Array(noiseState.sumBins.length);
      for (let i = 0; i < profile.length; i += 1) {
        profile[i] = noiseState.sumBins[i] / noiseState.sampleCount;
      }
      noiseState.profile = profile;
      ls.set(SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY, Array.from(profile));
      setSpectrogramNoiseProfileReady(true);
    }
    noiseState.calibrating = false;
    noiseState.sumBins = null;
    noiseState.sampleCount = 0;
    setSpectrogramNoiseCalibrating(false);
  };

  const clearSpectrogramNoiseProfile = () => {
    const noiseState = spectrogramNoiseRef.current;
    noiseState.profile = null;
    ls.set(SPECTROGRAM_NOISE_PROFILE_STORAGE_KEY, null);
    setSpectrogramNoiseProfileReady(false);
  };

  const onNoiseCalibratePointerDown = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginSpectrogramNoiseCalibration();
  };

  const onNoiseCalibratePointerUp = (event) => {
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const noiseState = spectrogramNoiseRef.current;
    if (!noiseState.calibrating) return;
    finishSpectrogramNoiseCalibration(true);
  };

  const onNoiseCalibrateContextMenu = (event) => {
    event.preventDefault();
  };

  const applyNoiseProfileToSpectrogramBins = (normalizedBins) => {
    const noiseState = spectrogramNoiseRef.current;
    if (noiseState.calibrating && noiseState.sumBins) {
      const captureCount = Math.min(noiseState.sumBins.length, normalizedBins.length);
      for (let i = 0; i < captureCount; i += 1) {
        noiseState.sumBins[i] += normalizedBins[i];
      }
      noiseState.sampleCount += 1;
    }

    if (!noiseState.profile) return normalizedBins;
    const capture = spectrogramCaptureRef.current;
    if (capture.filteredBins.length !== normalizedBins.length) {
      capture.filteredBins = new Float32Array(normalizedBins.length);
    }
    const filtered = capture.filteredBins;
    const profileCount = Math.min(noiseState.profile.length, normalizedBins.length);
    for (let i = 0; i < profileCount; i += 1) {
      const value = normalizedBins[i];
      const weightedNoise = noiseState.profile[i] * (1 - value);
      filtered[i] = Math.max(0, value - weightedNoise);
    }
    for (let i = profileCount; i < normalizedBins.length; i += 1) {
      filtered[i] = normalizedBins[i];
    }
    return filtered;
  };

  const processBufferedAudio = () => {
    const raw = rawBufferRef.current;
    const analysis = analysisRef.current;
    const currentView = activeViewRef.current;
    const shouldDetectPitch = currentView !== "spectrogram" || pitchDetectionOnSpectrogram;
    const minHz = currentView === "spectrogram" ? spectrogramMinHz : pitchRangeRef.current.minHz;
    const maxHz = currentView === "spectrogram" ? spectrogramMaxHz : pitchRangeRef.current.maxHz;
    let processedWindows = 0;
    let analysisElapsedMs = 0;
    let didTimelineChange = false;
    let didRunPitchAnalysis = false;

    drainRawBuffer(raw, analysis, (windowSamples, nowMs) => {
      const shouldUseV5 = shouldDetectPitch && !useLegacyAutocorr;
      const analysisStart = shouldDetectPitch ? performance.now() : 0;
      const capturedBins = captureSpectrogramBins({includeDetectorBins: shouldUseV5});
      const sharedSpectrumBins = capturedBins?.spectrogramBins ?? null;
      const detectorSpectrumBins = capturedBins?.detectorBins ?? null;
      if (spectrogramClockRef.current.writeClockMs <= 0) {
        spectrogramClockRef.current.writeClockMs = nowMs;
      } else {
        const elapsedMs = nowMs - spectrogramClockRef.current.writeClockMs;
        spectrogramClockRef.current.writeClockMs = nowMs;
        const spectrogramStep = consumeTimelineElapsed(
            elapsedMs,
            SAMPLES_PER_SECOND,
            spectrogramClockRef.current.accumulator
        );
        spectrogramClockRef.current.accumulator = spectrogramStep.accumulator;
        if (spectrogramStep.steps > 0 && sharedSpectrumBins) {
          let shouldWriteSpectrogram = true;
          if (spectrogramResumeNeedsSignalRef.current) {
            let hasSignal = false;
            for (let i = 0; i < sharedSpectrumBins.length; i += 1) {
              if (sharedSpectrumBins[i] > 0) {
                hasSignal = true;
                break;
              }
            }
            if (hasSignal) {
              spectrogramResumeNeedsSignalRef.current = false;
            } else {
              shouldWriteSpectrogram = false;
            }
          }
          if (shouldWriteSpectrogram) {
            const filteredBins = applyNoiseProfileToSpectrogramBins(sharedSpectrumBins);
            writeSpectrogramColumn(spectrogramRef.current, filteredBins, spectrogramStep.steps);
            didTimelineChange = true;
          }
        }
      }

      if (!shouldDetectPitch) {
        timelineRef.current.writeClockMs = nowMs;
        timelineRef.current.accumulator = 0;
        return;
      }

      const result = useLegacyAutocorr || !detectorSpectrumBins
          ? analyzeAudioWindow(audioRef.current, windowSamples, minHz, maxHz, {
            adaptiveRange: currentView === "pitch",
          })
          : analyzeAudioWindowSpectrumV5(
              audioRef.current,
              windowSamples,
              detectorSpectrumBins,
              minHz,
              maxHz,
              {
                ...v5Settings,
                adaptiveRange: false,
              }
          );
      analysisElapsedMs += performance.now() - analysisStart;
      processedWindows += 1;
      didRunPitchAnalysis = true;
      if (!result) return;

      const writeResult = writePitchTimeline(timelineRef.current, {
        nowMs,
        hasVoice: result.hasVoice,
        cents: result.cents,
      });
      if (writeResult.steps > 0) {
        didTimelineChange = true;
      }
      metricsRef.current = {
        level: {rms: result.rms},
        rawHz: result.hz,
        hasVoice: result.hasVoice,
        hasDataTiming: true,
      };
    });

    if (processedWindows > 0) {
      const avgPerWindowMs = analysisElapsedMs / processedWindows;
      animationRef.current.dataAvg = lerp(animationRef.current.dataAvg, avgPerWindowMs, 0.2);
    }
    metricsRef.current.hasDataTiming = didRunPitchAnalysis;
    return didTimelineChange;
  };

  const startAudio = async () => {
    if (ui.isRunning || isStartingRef.current) return;
    isStartingRef.current = true;
    setUi((prev) => ({...prev, error: ""}));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
        },
      });
      const context = new AudioContext();
      await context.audioWorklet.addModule(
          new URL("./worklets/audioCaptureProcessor.js", import.meta.url)
      );
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(context, "audio-capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        outputChannelCount: [1],
      });
      const analyser = context.createAnalyser();
      analyser.fftSize = SPECTROGRAM_BIN_COUNT * 2;
      analyser.smoothingTimeConstant = 0;
      captureNode.port.onmessage = (event) => {
        enqueueAudioSamples(rawBufferRef.current, event.data);
      };
      source.connect(captureNode);
      source.connect(analyser);

      const sinkGain = context.createGain();
      sinkGain.gain.value = 0;
      captureNode.connect(sinkGain);
      sinkGain.connect(context.destination);

      const sampleRate = context.sampleRate;
      rawBufferRef.current = createRawAudioBuffer(sampleRate, {
        windowSize: ANALYSIS_WINDOW_SIZE,
        rawBufferSeconds: RAW_BUFFER_SECONDS,
      });
      analysisRef.current = createAnalysisState(sampleRate, {
        windowSize: ANALYSIS_WINDOW_SIZE,
        samplesPerSecond: SAMPLES_PER_SECOND,
      });
      spectrogramClockRef.current = {
        writeClockMs: 0,
        accumulator: 0,
      };
      audioRef.current = setupAudioState(audioRef.current, {
        context,
        source,
        stream,
        captureNode,
        analyser,
        sinkGain,
        analysisFps: SAMPLES_PER_SECOND,
        centerSeconds: CENTER_SECONDS,
        sampleRate,
      });
      spectrogramCaptureRef.current = {
        byteBins: new Uint8Array(analyser.frequencyBinCount),
        normalizedBins: new Float32Array(analyser.frequencyBinCount),
        dbBins: new Float32Array(analyser.frequencyBinCount),
        detectorBins: new Float32Array(analyser.frequencyBinCount),
        filteredBins: new Float32Array(analyser.frequencyBinCount),
      };
      const existingSpectrogram = spectrogramRef.current;
      const reuseSpectrogram =
          hasEverRun &&
          existingSpectrogram &&
          existingSpectrogram.binCount === analyser.frequencyBinCount;
      if (!reuseSpectrogram) {
        spectrogramRef.current = createSpectrogramTimeline({
          samplesPerSecond: SAMPLES_PER_SECOND,
          seconds: PITCH_SECONDS,
          binCount: analyser.frequencyBinCount,
        });
      }
      spectrogramClockRef.current = {
        writeClockMs: 0,
        accumulator: 0,
      };
      spectrogramResumeNeedsSignalRef.current = reuseSpectrogram;

      setUi((prev) => ({...prev, isRunning: true}));
      setHasEverRun(true);
      animationRef.current.drawAvg = 0;
      animationRef.current.dataAvg = 0;
      if (!animationRef.current.rafId) {
        animationRef.current.rafId = requestAnimationFrame(renderLoop);
      }
    } catch (err) {
      setWantsToRun(false);
      setUi((prev) => ({
        ...prev,
        error: err?.message || "Microphone access failed.",
      }));
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopAudio = () => {
    if (spectrogramNoiseRef.current.calibrating) {
      finishSpectrogramNoiseCalibration(false);
    }
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId);
      animationRef.current.rafId = 0;
    }
    const {context, stream, source, captureNode, analyser, sinkGain} = audioRef.current;
    if (captureNode) {
      captureNode.port.onmessage = null;
      captureNode.disconnect();
    }
    if (source) {
      source.disconnect();
    }
    if (sinkGain) {
      sinkGain.disconnect();
    }
    if (analyser) {
      analyser.disconnect();
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (context && context.state !== "closed") {
      context.close();
    }
    audioRef.current.context = null;
    audioRef.current.source = null;
    audioRef.current.stream = null;
    audioRef.current.captureNode = null;
    audioRef.current.analyser = null;
    audioRef.current.sinkGain = null;
    rawBufferRef.current = createRawAudioBuffer(analysisRef.current.sampleRate, {
      windowSize: ANALYSIS_WINDOW_SIZE,
      rawBufferSeconds: RAW_BUFFER_SECONDS,
    });
    analysisRef.current = createAnalysisState(analysisRef.current.sampleRate, {
      windowSize: ANALYSIS_WINDOW_SIZE,
      samplesPerSecond: SAMPLES_PER_SECOND,
    });
    setUi((prev) => ({...prev, isRunning: false}));
  };

  const onStartButtonClick = () => {
    setWantsToRun(true);
    startAudio();
  };

  const onChartTogglePause = () => {
    if (settingsOpen || !hasEverRun || isStartingRef.current) return;
    setWantsToRun((prev) => !prev);
  };

  const drawActiveChart = () => {
    const timeline = timelineRef.current;
    const currentView = activeViewRef.current;
    if (currentView === "vibrato") {
      vibratoChartRef.current?.draw({
        values: timeline.values,
        writeIndex: timeline.writeIndex,
        count: timeline.count,
        yOffset: audioRef.current.centerCents,
      });
      return;
    }
    if (currentView === "spectrogram") {
      spectrogramChartRef.current?.draw({
        values: spectrogramRef.current.values,
        writeIndex: spectrogramRef.current.writeIndex,
        count: spectrogramRef.current.count,
        binCount: spectrogramRef.current.binCount,
        sampleRate: analysisRef.current.sampleRate,
      });
      return;
    }
    pitchChartRef.current?.draw({
      values: timeline.values,
      writeIndex: timeline.writeIndex,
      count: timeline.count,
    });
  };

  const renderLoop = (nowMs) => {
    if (runAt30FpsRef.current) {
      const lastFrameMs = animationRef.current.lastFrameMs;
      if (lastFrameMs > 0 && (nowMs - lastFrameMs) <= 25) {
        animationRef.current.rafId = requestAnimationFrame(renderLoop);
        return;
      }
      animationRef.current.lastFrameMs = nowMs;
    } else {
      animationRef.current.lastFrameMs = 0;
    }

    const didTimelineChange = processBufferedAudio();
    const previousDisplayedRateHz = animationRef.current.displayedVibratoRateHz;
    let displayedRateHz = null;
    const currentView = activeViewRef.current;

    if (currentView === "vibrato") {
      let estimatedRateHz = null;
      if (didTimelineChange) {
        estimatedRateHz = estimateTimelineVibratoRateHz({
          values: timelineRef.current.values,
          writeIndex: timelineRef.current.writeIndex,
          count: timelineRef.current.count,
          samplesPerSecond: timelineRef.current.samplesPerSecond,
          minRateHz: VIBRATO_RATE_MIN_HZ,
          maxRateHz: VIBRATO_RATE_MAX_HZ,
          analysisWindowSeconds: VIBRATO_ANALYSIS_WINDOW_SECONDS,
          minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
        });
      }

      if (estimatedRateHz !== null) {
        animationRef.current.lastValidVibratoRateMs = nowMs;
        const previousRateHz = animationRef.current.displayedVibratoRateHz;
        if (previousRateHz === null) {
          displayedRateHz = estimatedRateHz;
        } else {
          const barWidth = Math.max(1, vibratoChartRef.current?.getRateBarWidth() ?? 1);
          const hzSpan = VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ;
          const pixelsPerHz = barWidth / hzSpan;
          const maxHzStep = VIBRATO_MAX_MARKER_PX_PER_FRAME / pixelsPerHz;
          const delta = estimatedRateHz - previousRateHz;
          if (Math.abs(delta) > maxHzStep) {
            displayedRateHz = previousRateHz + Math.sign(delta) * maxHzStep;
          } else {
            displayedRateHz = estimatedRateHz;
          }
        }
      } else if (
          previousDisplayedRateHz !== null &&
          animationRef.current.lastValidVibratoRateMs !== null &&
          nowMs - animationRef.current.lastValidVibratoRateMs <= VIBRATO_RATE_HOLD_MS
      ) {
        displayedRateHz = previousDisplayedRateHz;
      }
    } else {
      animationRef.current.lastValidVibratoRateMs = null;
    }

    const didDisplayRateChange = displayedRateHz !== previousDisplayedRateHz;
    animationRef.current.displayedVibratoRateHz = displayedRateHz;

    const shouldDrawNow = forceRedrawRef.current || didTimelineChange;
    if (shouldDrawNow) {
      forceRedrawRef.current = false;
      const drawStart = performance.now();
      drawActiveChart();
      const drawElapsed = performance.now() - drawStart;
      animationRef.current.drawAvg = lerp(animationRef.current.drawAvg, drawElapsed, 0.2);
    }

    if (didTimelineChange || didDisplayRateChange) {
      const latestMetrics = metricsRef.current;
      setStats({
        timings: {
          data: latestMetrics.hasDataTiming ? animationRef.current.dataAvg : null,
          draw: animationRef.current.drawAvg,
        },
        level: latestMetrics.level,
        rawHz: latestMetrics.rawHz,
      });
    }
    if (didDisplayRateChange) {
      setUi((prev) => ({...prev, vibratoRateHz: displayedRateHz}));
    }
    animationRef.current.rafId = requestAnimationFrame(renderLoop);
  };

  useEffect(() => {
    let rafId = 0;
    const redrawIdleCanvas = () => {
      if (ui.isRunning) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        drawActiveChart();
      });
    };

    redrawIdleCanvas();
    window.addEventListener("resize", redrawIdleCanvas);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener("resize", redrawIdleCanvas);
    };
  }, [activeView, ui.isRunning]);

  useEffect(() => {
    if (settingsOpen) return;
    forceRedrawRef.current = true;
    const rafId = requestAnimationFrame(() => {
      drawActiveChart();
    });
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [activeView, pitchMaxCents, pitchMinCents, settingsOpen, spectrogramMaxHz, spectrogramMinHz]);

  const shouldRun =
      wantsToRun &&
      (keepRunningInBackground || isForeground);

  useEffect(() => {
    if (shouldRun && !ui.isRunning) {
      startAudio();
      return;
    }
    if (!shouldRun && ui.isRunning) {
      stopAudio();
    }
  }, [shouldRun, ui.isRunning]);

  const onPitchMinNoteChange = (nextNote) => {
    const lastIndex = PITCH_NOTE_OPTIONS.length - 1;
    let nextMinIndex = PITCH_NOTE_OPTIONS.indexOf(nextNote);
    let nextMaxIndex = PITCH_NOTE_OPTIONS.indexOf(pitchMaxNote);
    if (nextMinIndex < 0 || nextMaxIndex < 0) return;
    if (nextMinIndex >= nextMaxIndex) {
      nextMaxIndex = Math.min(lastIndex, nextMinIndex + 1);
      if (nextMinIndex >= nextMaxIndex) {
        nextMinIndex = Math.max(0, nextMaxIndex - 1);
      }
    }
    setPitchMinNote(PITCH_NOTE_OPTIONS[nextMinIndex]);
    setPitchMaxNote(PITCH_NOTE_OPTIONS[nextMaxIndex]);
  };

  const onPitchMaxNoteChange = (nextNote) => {
    const lastIndex = PITCH_NOTE_OPTIONS.length - 1;
    let nextMaxIndex = PITCH_NOTE_OPTIONS.indexOf(nextNote);
    let nextMinIndex = PITCH_NOTE_OPTIONS.indexOf(pitchMinNote);
    if (nextMinIndex < 0 || nextMaxIndex < 0) return;
    if (nextMaxIndex <= nextMinIndex) {
      nextMinIndex = Math.max(0, nextMaxIndex - 1);
      if (nextMaxIndex <= nextMinIndex) {
        nextMaxIndex = Math.min(lastIndex, nextMinIndex + 1);
      }
    }
    setPitchMinNote(PITCH_NOTE_OPTIONS[nextMinIndex]);
    setPitchMaxNote(PITCH_NOTE_OPTIONS[nextMaxIndex]);
  };

  const onSpectrogramMinHzChange = (nextValue) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;
    setSpectrogramMinHz(nextValue);
    if (nextValue >= spectrogramMaxHz) {
      setSpectrogramMaxHz(nextValue + 1);
    }
  };

  const onSpectrogramMaxHzChange = (nextValue) => {
    if (!Number.isFinite(nextValue) || nextValue <= 0) return;
    setSpectrogramMaxHz(nextValue);
    if (nextValue <= spectrogramMinHz) {
      setSpectrogramMinHz(Math.max(1e-3, nextValue - 1));
    }
  };

  const onUseLegacyAutocorrChange = (nextValue) => {
    ls.set(USE_LEGACY_AUTOCORR_STORAGE_KEY, nextValue);
    setUseLegacyAutocorr(nextValue);
    window.location.reload();
  };

  const onRunAt30FpsChange = (nextValue) => {
    setRunAt30Fps(nextValue);
  };

  const onV5SettingChange = (key, nextValue) => {
    setV5Settings((prev) => normalizeV5Settings({
      ...prev,
      [key]: nextValue,
    }));
  };

  const showStartOverlay = !ui.isRunning && !wantsToRun && (ui.error || !hasEverRun);
  const showPausedOverlay = !ui.isRunning && !wantsToRun && hasEverRun && !ui.error;
  const batteryUsageDisplay =
      batteryUsagePerMinute === null
          ? null
          : batteryUsagePerMinute === "--"
              ? "-- %/min"
              : `${batteryUsagePerMinute.toFixed(2)} %/min`;

  return (
      <div className="h-[var(--app-height)] w-full overflow-hidden bg-black text-slate-100">
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-black md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
            <div
                className="relative flex min-h-0 flex-1 flex-col"
                onClick={onChartTogglePause}
            >
              {activeView === "vibrato" ? (
                  <VibratoChart
                      ref={vibratoChartRef}
                      yRange={WAVE_Y_RANGE}
                      maxDrawJumpCents={MAX_DRAW_JUMP_CENTS}
                      vibratoRateHz={ui.vibratoRateHz}
                      vibratoRateMinHz={VIBRATO_RATE_MIN_HZ}
                      vibratoRateMaxHz={VIBRATO_RATE_MAX_HZ}
                      vibratoSweetMinHz={VIBRATO_SWEET_MIN_HZ}
                      vibratoSweetMaxHz={VIBRATO_SWEET_MAX_HZ}
                      renderScale={halfResolutionCanvas ? 0.5 : 1}
                  />
              ) : activeView === "spectrogram" ? (
                  <SpectrogramChart
                      ref={spectrogramChartRef}
                      className="h-full w-full"
                      minHz={spectrogramMinHz}
                      maxHz={spectrogramMaxHz}
                      renderScale={halfResolutionCanvas ? 0.5 : 1}
                  />
              ) : (
                  <PitchChart
                      ref={pitchChartRef}
                      minCents={pitchMinCents}
                      maxCents={pitchMaxCents}
                      maxDrawJumpCents={MAX_DRAW_JUMP_CENTS}
                      renderScale={halfResolutionCanvas ? 0.5 : 1}
                  />
              )}
              {showStartOverlay ? (
                  <div
                      className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
                      onClick={(event) => event.stopPropagation()}
                  >
                    <button
                        type="button"
                        onClick={onStartButtonClick}
                        className="rounded-full bg-sky-400 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-sky-400/30"
                    >
                      Start
                    </button>
                  </div>
              ) : null}
              {showPausedOverlay ? (
                  <div className="pointer-events-none absolute inset-0 z-10">
                    <div className="absolute bottom-[62px] left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-6 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-100">
                      Paused
                    </div>
                  </div>
              ) : null}
            </div>
            {ui.error && !showStartOverlay ? (
                <div className="absolute inset-x-3 top-14 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-200">
                  {ui.error}
                </div>
            ) : null}
            {showStats ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
                  <div>Data: {stats.timings.data === null ? "--" : `${stats.timings.data.toFixed(2)} ms`}</div>
                  <div>Draw: {stats.timings.draw.toFixed(2)} ms</div>
                  <div>RMS: {stats.level.rms?.toFixed(3) ?? "--"}</div>
                  <div>Hz: {stats.rawHz ? stats.rawHz.toFixed(1) : "0"}</div>
                </div>
            ) : null}
            <footer className="relative flex h-12 items-stretch gap-1 px-2 py-1 text-xs text-slate-300">
              <div className="flex flex-1 items-stretch gap-1">
                <button
                    type="button"
                    onClick={() => setActiveView("pitch")}
                    className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold shadow ${
                        activeView === "pitch"
                            ? "bg-sky-400 text-slate-950"
                            : "bg-slate-600 text-slate-100"
                    }`}
                >
                  Pitch
                </button>
                <button
                    type="button"
                    onClick={() => setActiveView("vibrato")}
                    className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold shadow ${
                        activeView === "vibrato"
                            ? "bg-sky-400 text-slate-950"
                            : "bg-slate-600 text-slate-100"
                    }`}
                >
                  Vibrato
                </button>
                <button
                    type="button"
                    onClick={() => setActiveView("spectrogram")}
                    className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold shadow ${
                        activeView === "spectrogram"
                            ? "bg-sky-400 text-slate-950"
                            : "bg-slate-600 text-slate-100"
                    }`}
                >
                  Spectrogram
                </button>
              </div>
              <div className="flex w-12 items-stretch justify-end">
                <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="min-h-10 w-full rounded-lg bg-slate-700 px-0 text-lg text-slate-200 shadow transition hover:bg-slate-600 hover:text-white"
                    aria-label="Open settings"
                >
                  ⚙
                </button>
              </div>
            </footer>
          </main>
          {settingsOpen ? (
              <SettingsPanel
                  open={settingsOpen}
                  onClose={() => setSettingsOpen(false)}
                  keepRunningInBackground={keepRunningInBackground}
                  onKeepRunningInBackgroundChange={setKeepRunningInBackground}
                  autoPauseOnSilence={autoPauseOnSilence}
                  onAutoPauseOnSilenceChange={setAutoPauseOnSilence}
                  showStats={showStats}
                  onShowStatsChange={setShowStats}
                  pitchDetectionOnSpectrogram={pitchDetectionOnSpectrogram}
                  onPitchDetectionOnSpectrogramChange={setPitchDetectionOnSpectrogram}
                  useLegacyAutocorr={useLegacyAutocorr}
                  onUseLegacyAutocorrChange={onUseLegacyAutocorrChange}
                  runAt30Fps={runAt30Fps}
                  onRunAt30FpsChange={onRunAt30FpsChange}
                  halfResolutionCanvas={halfResolutionCanvas}
                  onHalfResolutionCanvasChange={setHalfResolutionCanvas}
                  v5Settings={v5Settings}
                  onV5SettingChange={onV5SettingChange}
                  pitchMinNote={pitchMinNote}
                  pitchMaxNote={pitchMaxNote}
                  pitchNoteOptions={PITCH_NOTE_OPTIONS}
                  onPitchMinNoteChange={onPitchMinNoteChange}
                  onPitchMaxNoteChange={onPitchMaxNoteChange}
                  spectrogramMinHz={spectrogramMinHz}
                  spectrogramMaxHz={spectrogramMaxHz}
                  onSpectrogramMinHzChange={onSpectrogramMinHzChange}
                  onSpectrogramMaxHzChange={onSpectrogramMaxHzChange}
                  spectrogramNoiseCalibrating={spectrogramNoiseCalibrating}
                  spectrogramNoiseProfileReady={spectrogramNoiseProfileReady}
                  onNoiseCalibratePointerDown={onNoiseCalibratePointerDown}
                  onNoiseCalibratePointerUp={onNoiseCalibratePointerUp}
                  onNoiseCalibrateContextMenu={onNoiseCalibrateContextMenu}
                  onClearSpectrogramNoiseProfile={clearSpectrogramNoiseProfile}
                  batteryUsageDisplay={batteryUsageDisplay}
              />
          ) : null}
        </div>
      </div>
  );
}
