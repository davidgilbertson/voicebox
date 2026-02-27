import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Pause} from "lucide-react";
import {
  analyzeAudioWindowFftPitch,
  updateCenterFromHzBuffer,
} from "./audioSeries.js";
import {createPitchTimeline, resizePitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {
  estimateTimelineVibratoRate
} from "./vibratoRate.js";
import VibratoChart from "./VibratoChart.jsx";
import PitchChart from "./PitchChart.jsx";
import SpectrogramChart from "./SpectrogramChart.jsx";
import {noteNameToCents, noteNameToHz} from "../pitchScale.js";
import {clamp, pickPreferredAudioInputDeviceId} from "../tools.js";
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
  VIBRATO_MIN_CONTIGUOUS_SECONDS,
  VIBRATO_RATE_HOLD_MS,
  VIBRATO_RATE_MAX_HZ,
  VIBRATO_RATE_MIN_HZ,
  VIBRATO_SWEET_MAX_HZ,
  VIBRATO_SWEET_MIN_HZ,
  readMaxSignalLevel,
  readSpectrogramNoiseProfile,
  writeMaxSignalLevel,
  writeSpectrogramNoiseProfile,
} from "./config.js";

const MAX_DRAW_JUMP_CENTS = 80;
const MIN_SIGNAL_THRESHOLD = 0.015; // Time-domain RMS threshold from worklet for auto-pause
const DEFAULT_CENTER_HZ = 220;

function createHzBuffer(length) {
  const hzBuffer = new Float32Array(length);
  hzBuffer.fill(Number.NaN);
  return hzBuffer;
}

function createSpectrogramCaptureBuffers(binCount) {
  return {
    spectrumNormalized: new Float32Array(binCount),
    spectrumDb: new Float32Array(binCount),
    spectrumForPitchDetection: new Float32Array(binCount),
    spectrumFiltered: new Float32Array(binCount),
  };
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
                                   isForeground,
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
  const startAttemptRef = useRef(0);
  const chartWidthPx = Math.max(1, Math.floor(window.innerWidth));
  const chartWidthPxRef = useRef(chartWidthPx);
  const hopSizeRef = useRef(Math.round(48_000 / DISPLAY_PIXELS_PER_SECOND));
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
    centerHz: DEFAULT_CENTER_HZ,
    centerCents: 1200 * Math.log2(DEFAULT_CENTER_HZ),
  });
  // Single shared timeline feeds both pitch and vibrato views so switching preserves continuity.
  const timelineRef = useRef(createPitchTimeline({
    columnRateHz: DISPLAY_PIXELS_PER_SECOND,
    seconds: chartWidthPx / DISPLAY_PIXELS_PER_SECOND,
    silencePauseStepThreshold: Math.round((SILENCE_PAUSE_THRESHOLD_MS / 1000) * DISPLAY_PIXELS_PER_SECOND),
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
  const signalLevelRef = useRef(0);
  // Decay on load so one unusually loud session does not pin the color scale forever.
  const initialMaxSignalLevel = useMemo(() => readMaxSignalLevel() * 0.9, []);
  const signalTrackingRef = useRef({
    maxHeardSignalLevel: initialMaxSignalLevel,
  });
  const spectrumIntensityEmaRef = useRef(0);
  const animationRef = useRef({
    rafId: 0,
    lastFrameMs: 0,
    displayedVibratoRate: null,
    lastVibratoRateUpdateMs: null,
    lastValidVibratoTick: null,
    missingVibratoTickCount: 0,
    timelineDirty: false, // TODO (@davidgilbertson): not convinced this is necessary
  });
  const forceRedrawRef = useRef(false);
  const activeViewRef = useRef(activeView);
  const wantsToRunRef = useRef(true);
  const manualPauseRef = useRef(false);
  const skipNextSpectrumFrameRef = useRef(false);
  const autoPauseOnSilenceRef = useRef(autoPauseOnSilence);
  const runAt30FpsRef = useRef(runAt30Fps);
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
    vibratoRate: null,
  });
  const [hasEverRun, setHasEverRun] = useState(false);
  const [wantsToRun, setWantsToRun] = useState(true);
  const [spectrogramNoiseCalibrating, setSpectrogramNoiseCalibrating] = useState(false);
  const [spectrogramNoiseProfileReady, setSpectrogramNoiseProfileReady] = useState(() => initialNoiseProfile !== null);
  const [batteryUsagePerMinute, setBatteryUsagePerMinute] = useState(null);
  const pitchMinHz = noteNameToHz(pitchMinNote);
  const pitchMaxHz = noteNameToHz(pitchMaxNote);
  const pitchMinCents = noteNameToCents(pitchMinNote);
  const pitchMaxCents = noteNameToCents(pitchMaxNote);

  useEffect(() => {
    // We read the max signal level on load and chop it to 0.9 times the value.
    // So now we save that value back to LS.
    writeMaxSignalLevel(initialMaxSignalLevel);
  }, [initialMaxSignalLevel]);

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
    spectrogramCaptureRef.current = createSpectrogramCaptureBuffers(binCount);
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
      const resizedCapture = createSpectrogramCaptureBuffers(analyser.frequencyBinCount);
      capture.spectrumNormalized = resizedCapture.spectrumNormalized;
      capture.spectrumDb = resizedCapture.spectrumDb;
      capture.spectrumForPitchDetection = resizedCapture.spectrumForPitchDetection;
      capture.spectrumFiltered = resizedCapture.spectrumFiltered;
    }
    // getFloatFrequencyData gives us decibels
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
      capture.spectrumNormalized[i] = clamp(normalized, 0, 1);
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
    const signalLevel = signalLevelRef.current;
    if (!spectrumForPitchDetection) return false;

    const signalTracking = signalTrackingRef.current;
    // We only update on non-trivial increases to minimize work
    if (signalLevel > (signalTracking.maxHeardSignalLevel + 0.01)) {
      signalTracking.maxHeardSignalLevel = signalLevel;
      writeMaxSignalLevel(signalLevel);
    }
    const maxHeardSignalLevel = signalTracking.maxHeardSignalLevel;
    const usedMaxSignalLevel = maxHeardSignalLevel * 0.8;

    const isAboveSilenceThreshold = signalLevel > MIN_SIGNAL_THRESHOLD;
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
      const signalSpan = usedMaxSignalLevel - MIN_SIGNAL_THRESHOLD;
      const signalIntensity = clamp(
          signalSpan > 0 ? ((signalLevel - MIN_SIGNAL_THRESHOLD) / signalSpan) : 0,
          0,
          1
      );
      const previousSpectrumIntensity = spectrumIntensityEmaRef.current;
      const smoothedSpectrumIntensity = previousSpectrumIntensity + ((signalIntensity - previousSpectrumIntensity) * 0.2);
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
    const startAttempt = ++startAttemptRef.current;
    setUi((prev) => ({...prev, error: ""}));
    try {
      let preferredDeviceId = null;
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (startAttempt !== startAttemptRef.current) return;
        preferredDeviceId = pickPreferredAudioInputDeviceId(devices);
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
          ...(preferredDeviceId ? {deviceId: preferredDeviceId} : {}),
        },
      });
      if (startAttempt !== startAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      await context.audioWorklet.addModule(
          new URL("./worklets/audioWorklet.js", import.meta.url)
      );
      await context.resume();
      if (startAttempt !== startAttemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        if (context.state !== "closed") {
          context.close();
        }
        return;
      }
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
        const sampleCount = Number(event.data.sampleCount);
        signalLevelRef.current = Number(event.data.signalLevel) || 0;
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
      if (startAttempt !== startAttemptRef.current) {
        captureNode.port.onmessage = null;
        captureNode.disconnect();
        source.disconnect();
        sinkGain.disconnect();
        analyser.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        if (context.state !== "closed") {
          context.close();
        }
        return;
      }

      const sampleRate = context.sampleRate;
      const hopSize = Math.round(sampleRate / DISPLAY_PIXELS_PER_SECOND);
      hopSizeRef.current = hopSize;
      captureNode.port.postMessage({
        type: "set-batch-size",
        batchSize: hopSize,
      });
      const previousAudioState = audioRef.current;
      const hzLength = Math.floor(CENTER_SECONDS * DISPLAY_PIXELS_PER_SECOND);
      const hzBuffer = previousAudioState.hzBuffer && previousAudioState.hzBuffer.length === hzLength
          ? previousAudioState.hzBuffer
          : createHzBuffer(hzLength);
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
        centerHz: previousAudioState.centerHz || DEFAULT_CENTER_HZ,
        centerCents: previousAudioState.centerCents || 1200 * Math.log2(DEFAULT_CENTER_HZ),
      };
      const shouldListen = wantsToRunRef.current;
      manualPauseRef.current = !shouldListen;
      setStreamListeningEnabled(stream, shouldListen);
      spectrogramCaptureRef.current = createSpectrogramCaptureBuffers(analyser.frequencyBinCount);

      setUi((prev) => ({...prev, isRunning: true}));
      setHasEverRun(true);
      if (!animationRef.current.rafId) {
        animationRef.current.rafId = requestAnimationFrame(renderLoop);
      }
    } catch (err) {
      if (startAttempt !== startAttemptRef.current) {
        return;
      }
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
    startAttemptRef.current += 1;
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
    signalLevelRef.current = 0;
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
    const previousDisplayedRate = animationRef.current.displayedVibratoRate;
    let displayedRate = null;
    const currentView = activeViewRef.current;

    if (currentView === "vibrato") {
      const timelineTickCount = timelineRef.current.diagnostics.totalTickCount;
      const holdTickThreshold = Math.round((VIBRATO_RATE_HOLD_MS / 1000) * timelineRef.current.columnRateHz);
      updateCenterFromHzBuffer(
          audioRef.current,
          pitchRangeRef.current.minHz,
          pitchRangeRef.current.maxHz
      );
      let estimatedRate = null;
      if (didTimelineChange) {
        estimatedRate = estimateTimelineVibratoRate({
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

      if (estimatedRate !== null) {
        animationRef.current.lastValidVibratoTick = timelineTickCount;
        if (previousDisplayedRate === null) {
          displayedRate = estimatedRate;
          animationRef.current.missingVibratoTickCount = 0;
        } else {
          const elapsedSinceLastRateUpdateMs = animationRef.current.lastVibratoRateUpdateMs === null
              ? 16
              : Math.max(0, nowMs - animationRef.current.lastVibratoRateUpdateMs);
          const baseSmoothingFactor = 1 - Math.exp(-elapsedSinceLastRateUpdateMs / 420);
          // Treat missing ticks like they had the current estimate; bigger gaps then pull faster.
          const missingTickCount = animationRef.current.missingVibratoTickCount;
          const smoothingFactor = 1 - ((1 - baseSmoothingFactor) ** (missingTickCount + 1));
          displayedRate = previousDisplayedRate + ((estimatedRate - previousDisplayedRate) * smoothingFactor);
          animationRef.current.missingVibratoTickCount = 0;
        }
        animationRef.current.lastVibratoRateUpdateMs = nowMs;
      } else if (
          previousDisplayedRate !== null &&
          animationRef.current.lastValidVibratoTick !== null &&
          timelineTickCount - animationRef.current.lastValidVibratoTick <= holdTickThreshold
      ) {
        displayedRate = previousDisplayedRate;
        animationRef.current.lastVibratoRateUpdateMs = nowMs;
        if (didTimelineChange) {
          animationRef.current.missingVibratoTickCount += 1;
        }
      }
    } else {
      animationRef.current.lastValidVibratoTick = null;
      animationRef.current.lastVibratoRateUpdateMs = null;
      animationRef.current.missingVibratoTickCount = 0;
    }

    const didDisplayRateChange = displayedRate !== previousDisplayedRate;
    animationRef.current.displayedVibratoRate = displayedRate;

    const shouldDrawNow = forceRedrawRef.current || didTimelineChange;
    if (shouldDrawNow) {
      forceRedrawRef.current = false;
      drawActiveChart();
    }
    if (didDisplayRateChange) {
      setUi((prev) => ({
        ...prev,
        vibratoRate: displayedRate,
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
                maxDrawJumpCents={MAX_DRAW_JUMP_CENTS}
                vibratoRate={ui.vibratoRate}
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
