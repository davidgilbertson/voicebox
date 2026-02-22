import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Pause} from "lucide-react";
import {
  analyzeAudioWindowFftPitch,
  updateCenterFromHzBuffer,
} from "./audioSeries.js";
import {createPitchTimeline, resizePitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {estimateTimelineVibratoRateHz} from "./vibratoRate.js";
import VibratoChart from "./VibratoChart.jsx";
import PitchChart from "./PitchChart.jsx";
import SpectrogramChart from "./SpectrogramChart.jsx";
import {noteNameToCents, noteNameToHz} from "../pitchScale.js";
import {BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor} from "./batteryUsage.js";
import {
  CENTER_SECONDS,
  DISPLAY_PIXELS_PER_SECOND,
  FFT_SIZE,
  PITCH_MAX_NOTE_DEFAULT,
  PITCH_MIN_NOTE_DEFAULT,
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
const PEAK_MAGNITUDE_FOR_FULL_INTENSITY = 0.07; // TODO (@davidgilbertson): maybe we make this dynamic (max over time) or user-settable
const MIN_PEAK_MAGNITUDE_FOR_SIGNAL = 0.0018;

function computeIsForeground() {
  if (document.visibilityState === "hidden") return false;
  if (document.hasFocus) {
    return document.hasFocus();
  }
  return true;
}

function setStreamListeningEnabled(stream, enabled) {
  if (!stream) return;
  const tracks = typeof stream.getAudioTracks === "function"
      ? stream.getAudioTracks()
      : (typeof stream.getTracks === "function" ? stream.getTracks() : []);
  for (const track of tracks) {
    track.enabled = enabled;
  }
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
                                   pitchLineColorMode,
                                   spectrogramMinHz,
                                   spectrogramMaxHz,
                                   onSettingsRuntimeChange,
                                 }) {
  const initialNoiseProfile = useMemo(() => readSpectrogramNoiseProfile(), []);
  const vibratoChartRef = useRef(null);
  const pitchChartRef = useRef(null);
  const spectrogramChartRef = useRef(null);
  const chartContainerRef = useRef(null);
  const isStartingRef = useRef(false);
  const chartWidthPx = Math.max(1, Math.floor(window.innerWidth));
  const chartWidthPxRef = useRef(chartWidthPx);
  const hopSizeRef = useRef(Math.max(1, Math.round(48_000 / DISPLAY_PIXELS_PER_SECOND)));
  const audioRef = useRef({
    context: null,
    analyser: null,
    source: null,
    stream: null,
    captureNode: null,
    sinkGain: null,
    hzBuffer: null,
    hzIndex: 0,
    sampleRate: 48000,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
  });
  // Single shared timeline feeds both pitch and vibrato views so switching preserves continuity.
  const timelineRef = useRef(createPitchTimeline({
    columnRateHz: DISPLAY_PIXELS_PER_SECOND,
    seconds: chartWidthPx / DISPLAY_PIXELS_PER_SECOND,
    silencePauseStepThreshold: Math.max(1, Math.round((SILENCE_PAUSE_THRESHOLD_MS / 1000) * DISPLAY_PIXELS_PER_SECOND)),
  }));
  const spectrogramCaptureRef = useRef({
    spectrumNormalized: new Float32Array(SPECTROGRAM_BIN_COUNT),
    spectrumDb: new Float32Array(SPECTROGRAM_BIN_COUNT),
    spectrumForPitchDetection: new Float32Array(SPECTROGRAM_BIN_COUNT),
    spectrumFiltered: new Float32Array(SPECTROGRAM_BIN_COUNT),
  });
  const spectrogramNoiseRef = useRef({
    profile: initialNoiseProfile,
    calibrating: false,
    sumBins: null,
    sampleCount: 0,
  });
  const batteryUsageMonitorRef = useRef(createBatteryUsageMonitor());
  const spectrumIntensityEmaRef = useRef(0);
  const animationRef = useRef({
    rafId: 0,
    lastFrameMs: 0,
    displayedVibratoRateHz: null,
    lastValidVibratoTick: null,
    timelineDirty: false, // TODO (@davidgilbertson): not convinced this is necessary
  });
  const forceRedrawRef = useRef(false);
  const activeViewRef = useRef(activeView);
  const wantsToRunRef = useRef(true);
  const manualPauseRef = useRef(false);
  const skipNextSpectrumFrameRef = useRef(false);
  const autoPauseOnSilenceRef = useRef(autoPauseOnSilence);
  const runAt30FpsRef = useRef(RUN_AT_30_FPS_DEFAULT);
  const pitchRangeRef = useRef({
    minHz: noteNameToHz(PITCH_MIN_NOTE_DEFAULT),
    maxHz: noteNameToHz(PITCH_MAX_NOTE_DEFAULT),
    minCents: noteNameToCents(PITCH_MIN_NOTE_DEFAULT),
    maxCents: noteNameToCents(PITCH_MAX_NOTE_DEFAULT),
  });
  const spectrogramRangeRef = useRef({
    minHz: spectrogramMinHz,
    maxHz: spectrogramMaxHz,
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
    wantsToRunRef.current = wantsToRun;
  }, [wantsToRun]);

  useEffect(() => {
    pitchRangeRef.current = {
      minHz: pitchMinHz,
      maxHz: pitchMaxHz,
      minCents: pitchMinCents,
      maxCents: pitchMaxCents,
    };
  }, [pitchMaxCents, pitchMaxHz, pitchMinCents, pitchMinHz]);

  useEffect(() => {
    spectrogramRangeRef.current = {
      minHz: spectrogramMinHz,
      maxHz: spectrogramMaxHz,
    };
  }, [spectrogramMaxHz, spectrogramMinHz]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  useEffect(() => {
    autoPauseOnSilenceRef.current = autoPauseOnSilence;
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
    const analyser = audioRef.current.analyser;
    const binCount = analyser ? analyser.frequencyBinCount : SPECTROGRAM_BIN_COUNT;
    spectrogramCaptureRef.current = {
      spectrumNormalized: new Float32Array(binCount),
      spectrumDb: new Float32Array(binCount),
      spectrumForPitchDetection: new Float32Array(binCount),
      spectrumFiltered: new Float32Array(binCount),
    };
    spectrogramChartRef.current?.clear();
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
    if (capture.spectrumNormalized.length !== analyser.frequencyBinCount) {
      capture.spectrumNormalized = new Float32Array(analyser.frequencyBinCount);
      capture.spectrumDb = new Float32Array(analyser.frequencyBinCount);
      capture.spectrumForPitchDetection = new Float32Array(analyser.frequencyBinCount);
    }
    analyser.getFloatFrequencyData(capture.spectrumDb);
    const minDb = analyser.minDecibels;
    const maxDb = analyser.maxDecibels;
    const dbRange = maxDb - minDb;
    const invDbRange = dbRange > 0 ? 1 / dbRange : 0;
    let allNegativeInfinity = true;
    let maxMagnitude = 0;
    for (let i = 0; i < capture.spectrumDb.length; i += 1) {
      const dbValue = capture.spectrumDb[i];
      if (dbValue !== Number.NEGATIVE_INFINITY) {
        allNegativeInfinity = false;
      }
      const finiteDb = Number.isFinite(dbValue) ? dbValue : minDb;
      const magnitude = 10 ** (finiteDb / 20);
      capture.spectrumForPitchDetection[i] = magnitude;
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
      }
      const normalized = (finiteDb - minDb) * invDbRange;
      capture.spectrumNormalized[i] = Math.max(0, Math.min(1, normalized));
    }
    if (maxMagnitude > 0) {
      const scale = 1 / maxMagnitude;
      for (let i = 0; i < capture.spectrumForPitchDetection.length; i += 1) {
        capture.spectrumForPitchDetection[i] *= scale;
      }
    }
    // After unpausing, some devices can output all -Infinity frames briefly; ignore that frame and one follow-up frame.
    if (allNegativeInfinity) {
      skipNextSpectrumFrameRef.current = true;
      return null;
    }
    if (skipNextSpectrumFrameRef.current) {
      skipNextSpectrumFrameRef.current = false;
      return null;
    }
    return {
      spectrumNormalized: capture.spectrumNormalized,
      spectrumForPitchDetection: capture.spectrumForPitchDetection,
      spectrumPeakMagnitude: maxMagnitude,
    };
  };

  const beginSpectrogramNoiseCalibration = useCallback(() => {
    const noiseState = spectrogramNoiseRef.current;
    const binCount = audioRef.current.analyser?.frequencyBinCount ?? spectrogramCaptureRef.current.spectrumNormalized.length;
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

  const applyNoiseProfileToSpectrum = (spectrumNormalized) => {
    // Removes background noise from the spectrogram (e.g. air con)
    const noiseState = spectrogramNoiseRef.current;
    if (noiseState.calibrating && noiseState.sumBins) {
      const captureCount = Math.min(noiseState.sumBins.length, spectrumNormalized.length);
      for (let i = 0; i < captureCount; i += 1) {
        noiseState.sumBins[i] += spectrumNormalized[i];
      }
      noiseState.sampleCount += 1;
    }

    if (!noiseState.profile) return spectrumNormalized;
    const capture = spectrogramCaptureRef.current;
    if (capture.spectrumFiltered.length !== spectrumNormalized.length) {
      capture.spectrumFiltered = new Float32Array(spectrumNormalized.length);
    }
    const spectrumFiltered = capture.spectrumFiltered;
    const profileCount = Math.min(noiseState.profile.length, spectrumNormalized.length);
    for (let i = 0; i < profileCount; i += 1) {
      const value = spectrumNormalized[i];
      const weightedNoise = noiseState.profile[i] * (1 - value);
      spectrumFiltered[i] = Math.max(0, value - weightedNoise);
    }
    for (let i = profileCount; i < spectrumNormalized.length; i += 1) {
      spectrumFiltered[i] = spectrumNormalized[i];
    }
    return spectrumFiltered;
  };

  const processAudioHop = () => {
    if (manualPauseRef.current) return false;
    const currentView = activeViewRef.current;
    const minHz = currentView === "spectrogram" ? spectrogramRangeRef.current.minHz : pitchRangeRef.current.minHz;
    const maxHz = currentView === "spectrogram" ? spectrogramRangeRef.current.maxHz : pitchRangeRef.current.maxHz;
    let didTimelineChange = false;
    const capturedSpectrum = captureSpectrogramBins();
    const spectrumNormalized = capturedSpectrum?.spectrumNormalized ?? null;
    const spectrumForPitchDetection = capturedSpectrum?.spectrumForPitchDetection ?? null;
    const spectrumPeakMagnitude = capturedSpectrum?.spectrumPeakMagnitude ?? 0;
    if (!spectrumForPitchDetection) return false;
    const isAboveSilenceThreshold = spectrumPeakMagnitude >= MIN_PEAK_MAGNITUDE_FOR_SIGNAL;
    const result = isAboveSilenceThreshold
        ? analyzeAudioWindowFftPitch(
            audioRef.current,
            null,
            spectrumForPitchDetection,
            minHz,
            maxHz
        )
        : {
          cents: Number.NaN,
        };
    let pitchWriteResult = null;
    if (result) {
      const spectrumIntensity = Math.max(
          0,
          Math.min(1, spectrumPeakMagnitude / PEAK_MAGNITUDE_FOR_FULL_INTENSITY)
      );
      const previousSpectrumIntensity = spectrumIntensityEmaRef.current;
      const smoothedSpectrumIntensity = previousSpectrumIntensity + ((spectrumIntensity - previousSpectrumIntensity) * 0.2);
      spectrumIntensityEmaRef.current = smoothedSpectrumIntensity;
      pitchWriteResult = writePitchTimeline(timelineRef.current, {
        autoPauseOnSilence: autoPauseOnSilenceRef.current,
        hasSignal: isAboveSilenceThreshold,
        cents: result.cents,
        intensity: smoothedSpectrumIntensity,
      });
      if (pitchWriteResult.steps > 0) {
        didTimelineChange = true;
      }
    }

    const spectrogramSilencePaused = pitchWriteResult?.paused ?? timelineRef.current.silencePaused;
    if (!spectrumNormalized || spectrogramSilencePaused) return didTimelineChange;
    const spectrumFiltered = applyNoiseProfileToSpectrum(spectrumNormalized);
    spectrogramChartRef.current?.appendColumn(spectrumFiltered);
    didTimelineChange = true;

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
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0;
      captureNode.port.onmessage = (event) => {
        const sampleCount = Number(event.data);
        const expectedHopSize = hopSizeRef.current;
        if (!Number.isFinite(sampleCount) || sampleCount !== expectedHopSize) {
          console.log("something has gone very wrong this should not be possible", {
            sampleCount,
            expectedHopSize,
          });
        }
        const didTimelineChange = processAudioHop();
        if (didTimelineChange) {
          animationRef.current.timelineDirty = true;
          forceRedrawRef.current = true;
        }
      };
      source.connect(captureNode);
      source.connect(analyser);

      const sinkGain = context.createGain();
      sinkGain.gain.value = 0;
      captureNode.connect(sinkGain);
      sinkGain.connect(context.destination);

      const sampleRate = context.sampleRate;
      const hopSize = Math.max(1, Math.round(sampleRate / DISPLAY_PIXELS_PER_SECOND));
      hopSizeRef.current = hopSize;
      captureNode.port.postMessage({
        type: "set-batch-size",
        batchSize: hopSize,
      });
      const previousAudioState = audioRef.current;
      const hzLength = Math.floor(CENTER_SECONDS * DISPLAY_PIXELS_PER_SECOND);
      const hzBuffer = previousAudioState.hzBuffer && previousAudioState.hzBuffer.length === hzLength
          ? previousAudioState.hzBuffer
          : (() => {
            const nextHzBuffer = new Float32Array(hzLength);
            nextHzBuffer.fill(Number.NaN);
            return nextHzBuffer;
          })();
      audioRef.current = {
        ...previousAudioState,
        context,
        source,
        stream,
        captureNode,
        analyser,
        sinkGain,
        hzBuffer,
        sampleRate,
        centerHz: previousAudioState.centerHz || 220,
        centerCents: previousAudioState.centerCents || 1200 * Math.log2(220),
      };
      const shouldListen = wantsToRunRef.current;
      manualPauseRef.current = !shouldListen;
      setStreamListeningEnabled(stream, shouldListen);
      spectrogramCaptureRef.current = {
        spectrumNormalized: new Float32Array(analyser.frequencyBinCount),
        spectrumDb: new Float32Array(analyser.frequencyBinCount),
        spectrumForPitchDetection: new Float32Array(analyser.frequencyBinCount),
        spectrumFiltered: new Float32Array(analyser.frequencyBinCount),
      };

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
    manualPauseRef.current = false;
    setUi((prev) => ({...prev, isRunning: false}));
    animationRef.current.timelineDirty = false;
  };

  const onStartButtonClick = () => {
    setWantsToRun(true);
    startAudio();
  };

  const onChartPointerDown = (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if (settingsOpen || !hasEverRun || isStartingRef.current) return;
    setWantsToRun((prev) => !prev);
  };

  const drawActiveChart = () => {
    const timeline = timelineRef.current;
    const currentView = activeViewRef.current;
    if (currentView === "vibrato") {
      vibratoChartRef.current?.draw({
        values: timeline.values,
        intensities: timeline.intensities,
        writeIndex: timeline.writeIndex,
        count: timeline.count,
        yOffset: audioRef.current.centerCents,
      });
      return;
    }
    if (currentView === "spectrogram") {
      spectrogramChartRef.current?.draw({
        binCount: spectrogramCaptureRef.current.spectrumNormalized.length,
        sampleRate: audioRef.current.sampleRate,
      });
      return;
    }
    pitchChartRef.current?.draw({
      values: timeline.values,
      intensities: timeline.intensities,
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

    const didTimelineChange = animationRef.current.timelineDirty;
    animationRef.current.timelineDirty = false;
    const previousDisplayedRateHz = animationRef.current.displayedVibratoRateHz;
    let displayedRateHz = null;
    const currentView = activeViewRef.current;

    if (currentView === "vibrato") {
      const timelineTickCount = timelineRef.current.diagnostics.totalTickCount;
      const holdTickThreshold = Math.max(
          1,
          Math.round((VIBRATO_RATE_HOLD_MS / 1000) * timelineRef.current.columnRateHz)
      );
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
          samplesPerSecond: timelineRef.current.columnRateHz,
          minRateHz: VIBRATO_RATE_MIN_HZ,
          maxRateHz: VIBRATO_RATE_MAX_HZ,
          analysisWindowSeconds: VIBRATO_ANALYSIS_WINDOW_SECONDS,
          minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
        });
      }

      if (estimatedRateHz !== null) {
        animationRef.current.lastValidVibratoTick = timelineTickCount;
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
          animationRef.current.lastValidVibratoTick !== null &&
          timelineTickCount - animationRef.current.lastValidVibratoTick <= holdTickThreshold
      ) {
        displayedRateHz = previousDisplayedRateHz;
      }
    } else {
      animationRef.current.lastValidVibratoTick = null;
    }

    const didDisplayRateChange = displayedRateHz !== previousDisplayedRateHz;
    animationRef.current.displayedVibratoRateHz = displayedRateHz;

    const shouldDrawNow = forceRedrawRef.current || didTimelineChange;
    if (shouldDrawNow) {
      forceRedrawRef.current = false;
      drawActiveChart();
    }
    if (didDisplayRateChange) {
      setUi((prev) => ({
        ...prev,
        vibratoRateHz: displayedRateHz,
      }));
    }
    animationRef.current.rafId = requestAnimationFrame(renderLoop);
  };

  useEffect(() => {
    let rafId = 0;
    let resizeObserver = null;
    const onChartResize = () => {
      const nextWidth = Math.max(1, Math.floor(chartContainerRef.current?.clientWidth ?? window.innerWidth));
      if (nextWidth !== chartWidthPxRef.current) {
        chartWidthPxRef.current = nextWidth;
        resizePitchTimeline(timelineRef.current, nextWidth);
      }
      if (ui.isRunning) return;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        drawActiveChart();
      });
    };

    onChartResize();
    if (typeof ResizeObserver === "function" && chartContainerRef.current) {
      resizeObserver = new ResizeObserver(onChartResize);
      resizeObserver.observe(chartContainerRef.current);
    }
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
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

  useEffect(() => {
    if (!(keepRunningInBackground || isForeground) && ui.isRunning) {
      stopAudio();
    }
    if ((keepRunningInBackground || isForeground) && wantsToRun && !ui.isRunning) {
      startAudio();
    }
  }, [isForeground, keepRunningInBackground, ui.isRunning, wantsToRun]);

  useEffect(() => {
    if (!ui.isRunning) return;
    const shouldListen = wantsToRun;
    manualPauseRef.current = !shouldListen;
    const stream = audioRef.current.stream;
    setStreamListeningEnabled(stream, shouldListen);
  }, [ui.isRunning, wantsToRun]);

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
  const showPausedOverlay = !wantsToRun && hasEverRun && !ui.error;
  return (
      <>
        <div
            ref={chartContainerRef}
            className="relative flex min-h-0 flex-1 flex-col"
            onPointerDown={onChartPointerDown}
            data-testid="recorder-chart-area"
        >
          <div className={activeView === "vibrato" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}>
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
                lineColorMode={pitchLineColorMode}
            />
          </div>
          <div className={activeView === "spectrogram" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}>
            <SpectrogramChart
                ref={spectrogramChartRef}
                className="h-full w-full"
                minHz={spectrogramMinHz}
                maxHz={spectrogramMaxHz}
                renderScale={halfResolutionCanvas ? 0.5 : 1}
            />
          </div>
          <div className={activeView === "pitch" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}>
            <PitchChart
                ref={pitchChartRef}
                minCents={pitchMinCents}
                maxCents={pitchMaxCents}
                maxDrawJumpCents={MAX_DRAW_JUMP_CENTS}
                renderScale={halfResolutionCanvas ? 0.5 : 1}
                lineColorMode={pitchLineColorMode}
            />
          </div>
          {showStartOverlay ? (
              <div
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/60"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
              >
                <button
                    type="button"
                    onClick={onStartButtonClick}
                    className="rounded-full bg-blue-400 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-blue-400/30"
                >
                  Start
                </button>
              </div>
          ) : null}
          {showPausedOverlay ? (
              <div className="pointer-events-none absolute inset-0 z-10">
                <div
                    role="status"
                    className="pause-pill bg-slate-800/80 text-base font-semibold uppercase tracking-wide text-slate-100 shadow-lg"
                >
                  <Pause aria-hidden="true" className="pause-pill-icon h-5 w-5"/>
                  <span className="pause-pill-label">Paused</span>
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
