import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {clamp} from "../tools.js";
import {
  analyzeAudioWindowFftPitch,
  createAudioState,
  setupAudioState,
  updateCenterFromHzBuffer,
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
import VibratoChart from "./VibratoChart.jsx";
import PitchChart from "./PitchChart.jsx";
import SpectrogramChart from "./SpectrogramChart.jsx";
import {noteNameToCents, noteNameToHz} from "../pitchScale.js";
import {BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor} from "./batteryUsage.js";
import {
  ANALYSIS_WINDOW_SIZE,
  CENTER_SECONDS,
  PITCH_MAX_NOTE_DEFAULT,
  PITCH_MIN_NOTE_DEFAULT,
  PITCH_SECONDS,
  RAW_BUFFER_SECONDS,
  SAMPLES_PER_SECOND,
  SILENCE_PAUSE_THRESHOLD_MS,
  SPECTROGRAM_BIN_COUNT,
  VIBRATO_ANALYSIS_WINDOW_SECONDS,
  VIBRATO_MAX_MARKER_PX_PER_FRAME,
  VIBRATO_MIN_CONTIGUOUS_SECONDS,
  VIBRATO_RATE_HOLD_MS,
  VIBRATO_RATE_MAX_HZ,
  VIBRATO_RATE_MIN_HZ,
  VIBRATO_SWEET_MAX_HZ,
  VIBRATO_SWEET_MIN_HZ,
  readSpectrogramNoiseProfile,
  writeSpectrogramNoiseProfile,
} from "./config.js";

const RUN_AT_30_FPS_DEFAULT = false;
const WAVE_Y_RANGE = 305; // in cents
const MAX_DRAW_JUMP_CENTS = 80;

function computeIsForeground() {
  if (document.visibilityState === "hidden") return false;
  if (document.hasFocus) {
    return document.hasFocus();
  }
  return true;
}

export default function Recorder({
  activeView,
  settingsOpen,
  keepRunningInBackground,
  autoPauseOnSilence,
  runAt30Fps,
  halfResolutionCanvas,
  pitchMinNote,
  pitchMaxNote,
  spectrogramMinHz,
  spectrogramMaxHz,
  onSettingsRuntimeChange,
}) {
  const initialNoiseProfile = useMemo(() => readSpectrogramNoiseProfile(), []);
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
    autoPauseOnSilence: true,
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
    displayedVibratoRateHz: null,
    lastValidVibratoRateMs: null,
  });
  const forceRedrawRef = useRef(false);
  const activeViewRef = useRef(activeView);
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
  const [wantsToRun, setWantsToRun] = useState(true);
  const [isForeground, setIsForeground] = useState(() => computeIsForeground());
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
    timelineRef.current.autoPauseOnSilence = autoPauseOnSilence;
  }, [autoPauseOnSilence]);

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
      writeSpectrogramNoiseProfile(null);
      setSpectrogramNoiseProfileReady(false);
    }
    forceRedrawRef.current = true;
  }, []);

  const captureSpectrogramBins = () => {
    const analyser = audioRef.current.analyser;
    if (!analyser) return null;
    const capture = spectrogramCaptureRef.current;
    if (capture.normalizedBins.length !== analyser.frequencyBinCount) {
      capture.normalizedBins = new Float32Array(analyser.frequencyBinCount);
      capture.dbBins = new Float32Array(analyser.frequencyBinCount);
      capture.detectorBins = new Float32Array(analyser.frequencyBinCount);
    }
    analyser.getFloatFrequencyData(capture.dbBins);
    const minDb = analyser.minDecibels;
    const maxDb = analyser.maxDecibels;
    const dbRange = maxDb - minDb;
    const invDbRange = dbRange > 0 ? 1 / dbRange : 0;

    let maxMagnitude = 0;
    for (let i = 0; i < capture.dbBins.length; i += 1) {
      const dbValue = capture.dbBins[i];
      const finiteDb = Number.isFinite(dbValue) ? dbValue : minDb;
      const magnitude = 10 ** (finiteDb / 20);
      capture.detectorBins[i] = magnitude;
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
      }
      const normalized = (finiteDb - minDb) * invDbRange;
      capture.normalizedBins[i] = clamp(normalized, 0, 1);
    }
    if (maxMagnitude > 0) {
      const scale = 1 / maxMagnitude;
      for (let i = 0; i < capture.detectorBins.length; i += 1) {
        capture.detectorBins[i] *= scale;
      }
    }
    return {
      spectrogramBins: capture.normalizedBins,
      detectorBins: capture.detectorBins,
    };
  };

  const beginSpectrogramNoiseCalibration = useCallback(() => {
    const noiseState = spectrogramNoiseRef.current;
    const binCount = audioRef.current.analyser?.frequencyBinCount ?? spectrogramRef.current.binCount;
    noiseState.calibrating = true;
    noiseState.sumBins = new Float32Array(binCount);
    noiseState.sampleCount = 0;
    setSpectrogramNoiseCalibrating(true);
  }, []);

  const finishSpectrogramNoiseCalibration = useCallback((commitProfile) => {
    const noiseState = spectrogramNoiseRef.current;
    const hasSamples = noiseState.sampleCount > 0 && noiseState.sumBins;
    if (commitProfile && hasSamples) {
      const profile = new Float32Array(noiseState.sumBins.length);
      for (let i = 0; i < profile.length; i += 1) {
        profile[i] = noiseState.sumBins[i] / noiseState.sampleCount;
      }
      noiseState.profile = profile;
      writeSpectrogramNoiseProfile(profile);
      setSpectrogramNoiseProfileReady(true);
    }
    noiseState.calibrating = false;
    noiseState.sumBins = null;
    noiseState.sampleCount = 0;
    setSpectrogramNoiseCalibrating(false);
  }, []);

  const clearSpectrogramNoiseProfile = useCallback(() => {
    const noiseState = spectrogramNoiseRef.current;
    noiseState.profile = null;
    writeSpectrogramNoiseProfile(null);
    setSpectrogramNoiseProfileReady(false);
  }, []);

  const onNoiseCalibratePointerDown = useCallback((event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beginSpectrogramNoiseCalibration();
  }, [beginSpectrogramNoiseCalibration]);

  const onNoiseCalibratePointerUp = useCallback((event) => {
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const noiseState = spectrogramNoiseRef.current;
    if (!noiseState.calibrating) return;
    finishSpectrogramNoiseCalibration(true);
  }, [finishSpectrogramNoiseCalibration]);

  const onNoiseCalibrateContextMenu = useCallback((event) => {
    event.preventDefault();
  }, []);

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
    const minHz = currentView === "spectrogram" ? spectrogramMinHz : pitchRangeRef.current.minHz;
    const maxHz = currentView === "spectrogram" ? spectrogramMaxHz : pitchRangeRef.current.maxHz;
    let didTimelineChange = false;

    drainRawBuffer(raw, analysis, (windowSamples, nowMs) => {
      const capturedBins = captureSpectrogramBins();
      const sharedSpectrumBins = capturedBins?.spectrogramBins ?? null;
      const detectorSpectrumBins = capturedBins?.detectorBins ?? null;
      if (!detectorSpectrumBins) return;
      const result = analyzeAudioWindowFftPitch(
          audioRef.current,
          windowSamples,
          detectorSpectrumBins,
          minHz,
          maxHz
      );
      let pitchWriteResult = null;
      if (result) {
        pitchWriteResult = writePitchTimeline(timelineRef.current, {
          nowMs,
          hasVoice: result.hasVoice,
          cents: result.cents,
        });
        if (pitchWriteResult.steps > 0) {
          didTimelineChange = true;
        }
      }

      const spectrogramSilencePaused = pitchWriteResult?.paused ?? timelineRef.current.silencePaused;

      if (spectrogramClockRef.current.writeClockMs <= 0) {
        spectrogramClockRef.current.writeClockMs = nowMs;
        return;
      }

      const elapsedMs = nowMs - spectrogramClockRef.current.writeClockMs;
      spectrogramClockRef.current.writeClockMs = nowMs;
      const spectrogramStep = consumeTimelineElapsed(
          elapsedMs,
          SAMPLES_PER_SECOND,
          spectrogramClockRef.current.accumulator
      );
      spectrogramClockRef.current.accumulator = spectrogramStep.accumulator;
      if (spectrogramStep.steps <= 0 || !sharedSpectrumBins || spectrogramSilencePaused) return;

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
    });

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
      updateCenterFromHzBuffer(
          audioRef.current,
          pitchRangeRef.current.minHz,
          pitchRangeRef.current.maxHz
      );
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
      drawActiveChart();
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

  useEffect(() => {
    onSettingsRuntimeChange({
      spectrogramNoiseCalibrating,
      spectrogramNoiseProfileReady,
      onNoiseCalibratePointerDown,
      onNoiseCalibratePointerUp,
      onNoiseCalibrateContextMenu,
      onClearSpectrogramNoiseProfile: clearSpectrogramNoiseProfile,
      batteryUsagePerMinute,
    });
  }, [
    batteryUsagePerMinute,
    clearSpectrogramNoiseProfile,
    onNoiseCalibrateContextMenu,
    onNoiseCalibratePointerDown,
    onNoiseCalibratePointerUp,
    onSettingsRuntimeChange,
    spectrogramNoiseCalibrating,
    spectrogramNoiseProfileReady,
  ]);

  const showStartOverlay = !ui.isRunning && !wantsToRun && (ui.error || !hasEverRun);
  const showPausedOverlay = !ui.isRunning && !wantsToRun && hasEverRun && !ui.error;
  return (
      <>
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
                <div className="pause-pill-fade absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-800/80 px-9 py-3 text-xl font-semibold uppercase tracking-[0.2em] text-slate-100">
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
      </>
  );
}
