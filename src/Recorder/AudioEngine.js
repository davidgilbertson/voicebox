import {
  CENTER_SECONDS,
  DISPLAY_PIXELS_PER_SECOND,
  FFT_SIZE,
  PITCH_MAX_NOTE_DEFAULT,
  PITCH_MIN_NOTE_DEFAULT,
  SILENCE_PAUSE_THRESHOLD_MS,
  SPECTROGRAM_BIN_COUNT,
  readMaxSignalLevel,
  readSpectrogramNoiseProfile,
  writeMaxSignalLevel,
  writeSpectrogramNoiseProfile,
} from "./config.js";
import {createPitchTimeline, resizePitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {estimateTimelineVibratoRate} from "./Vibrato/vibratoTools.js";
import {analyzeAudioWindowFftPitch} from "./audioSeries.js";
import {createSpectrogramCaptureBuffers, processOneAudioHop} from "./hopProcessing.js";
import {createRecorderAudioSession, destroyRecorderAudioSession} from "./audioSession.js";
import {BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor} from "./batteryUsage.js";
import {computeIsForeground, subscribeToForegroundChanges} from "../foreground.js";
import {noteNameToCents, noteNameToHz} from "../pitchScale.js";
import {findMostRecentFiniteInRing, pickPreferredAudioInputDeviceId, readNewestRingValue} from "../tools.js";

const DEFAULT_CENTER_HZ = 220;
const MIN_SIGNAL_THRESHOLD = 0.015;
const VIBRATO_RATE_SMOOTHING_TIME_MS = 630;

function createHzBuffer(length) {
  const hzBuffer = new Float32Array(length);
  hzBuffer.fill(Number.NaN);
  return hzBuffer;
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

export function createAudioEngine() {
  const listeners = new Set();
  const chartRefs = {
    pitchChartRef: null,
    vibratoChartRef: null,
    spectrogramChartRef: null,
    containerRef: null,
  };
  let resizeObserver = null;
  const batteryUsageMonitor = createBatteryUsageMonitor();
  const initialNoiseProfile = readSpectrogramNoiseProfile();
  const initialMaxSignalLevel = readMaxSignalLevel() * 0.9;
  writeMaxSignalLevel(initialMaxSignalLevel);

  const state = {
    ui: {
      isAudioRunning: false,
      error: "",
      hasEverRun: false,
      isWantedRunning: true,
      spectrogramNoiseCalibrating: false,
      spectrogramNoiseProfileReady: initialNoiseProfile !== null,
      batteryUsagePerMinute: null,
      vibratoRate: null,
    },
    isStarting: false,
    startAttempt: 0,
    isForeground: computeIsForeground(),
    keepRunningInBackground: false,
    activeView: "spectrogram",
    settingsOpen: false,
    autoPauseOnSilence: true,
    runAt30Fps: false,
    pitchRange: {
      minHz: noteNameToHz(PITCH_MIN_NOTE_DEFAULT),
      maxHz: noteNameToHz(PITCH_MAX_NOTE_DEFAULT),
      minCents: noteNameToCents(PITCH_MIN_NOTE_DEFAULT),
      maxCents: noteNameToCents(PITCH_MAX_NOTE_DEFAULT),
    },
    spectrogramRange: {
      minHz: 0,
      maxHz: 0,
    },
    chartWidthPx: Math.max(1, Math.floor(window.innerWidth)),
    hopSize: Math.round(48_000 / DISPLAY_PIXELS_PER_SECOND),
    signalLevel: 0,
    spectrumIntensityEma: 0,
    skipNextSpectrumFrame: false,
    frameDirty: false,
    forceRedraw: true,
    batteryIntervalId: 0,
  };

  const renderState = {
    rafId: 0,
    lastFrameMs: 0,
    displayedVibratoRate: null,
    lastVibratoRateUpdateMs: null,
    lastKnownVibratoRate: null,
  };

  const audioState = {
    context: null,
    analyser: null,
    source: null,
    stream: null,
    captureNode: null,
    silentOutputGain: null,
    hzBuffer: null,
    hzIndex: 0,
    sampleRate: 48000,
    centerHz: DEFAULT_CENTER_HZ,
  };
  const pitchHistory = createPitchTimeline({
    columnRateHz: DISPLAY_PIXELS_PER_SECOND,
    seconds: state.chartWidthPx / DISPLAY_PIXELS_PER_SECOND,
    silencePauseStepThreshold: Math.round((SILENCE_PAUSE_THRESHOLD_MS / 1000) * DISPLAY_PIXELS_PER_SECOND),
  });
  let spectrogramCapture = createSpectrogramCaptureBuffers(SPECTROGRAM_BIN_COUNT);
  const spectrogramNoiseState = {
    profile: initialNoiseProfile,
    calibrating: false,
    sumBins: null,
    sampleCount: 0,
  };
  const signalTracking = {
    maxHeardSignalLevel: initialMaxSignalLevel,
  };
  let unsubscribeForeground = subscribeToForegroundChanges((isForeground) => {
    state.isForeground = isForeground;
    syncBatteryPolling();
    syncAudioState();
  });

  function setUi(nextPartial) {
    state.ui = {...state.ui, ...nextPartial};
    for (const listener of listeners) {
      listener(state.ui);
    }
  }

  async function sampleBatteryUsage() {
    const usage = await batteryUsageMonitor.readUsagePerMinute();
    setUi({batteryUsagePerMinute: usage});
  }

  function syncBatteryPolling() {
    if (state.batteryIntervalId) {
      window.clearInterval(state.batteryIntervalId);
      state.batteryIntervalId = 0;
    }
    sampleBatteryUsage();
    if (state.isForeground) {
      state.batteryIntervalId = window.setInterval(sampleBatteryUsage, BATTERY_SAMPLE_INTERVAL_MS);
    }
  }

  function processCurrentAudioHop() {
    const result = processOneAudioHop({
      isManuallyPaused: !state.ui.isWantedRunning,
      activeView: state.activeView,
      pitchRange: state.pitchRange,
      spectrogramRange: state.spectrogramRange,
      signalLevel: state.signalLevel,
      minSignalThreshold: MIN_SIGNAL_THRESHOLD,
      signalTracking,
      spectrumIntensityEma: state.spectrumIntensityEma,
      autoPauseOnSilence: state.autoPauseOnSilence,
      pitchHistory,
      audioState,
      spectrogramNoiseState,
      spectrogramCapture,
      skipNextSpectrumFrame: state.skipNextSpectrumFrame,
      analyzePitch: analyzeAudioWindowFftPitch,
      writePitchTimeline,
      estimateTimelineVibratoRate,
    });
    state.skipNextSpectrumFrame = result.nextSkipNextSpectrumFrame;
    state.spectrumIntensityEma = result.nextSpectrumIntensityEma;
    spectrogramCapture = result.spectrogramCapture;
    if (result.shouldPersistMaxSignalLevel) {
      writeMaxSignalLevel(state.signalLevel);
    }
    if (result.spectrogramColumn) {
      chartRefs.spectrogramChartRef?.current?.appendColumn(result.spectrogramColumn);
    }
    if (result.didFrameDataChange) {
      state.frameDirty = true;
    }
  }

  async function startAudio() {
    if (state.ui.isAudioRunning || state.isStarting) return;
    state.isStarting = true;
    const startAttempt = ++state.startAttempt;
    setUi({error: ""});
    try {
      let preferredDeviceId = null;
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (startAttempt !== state.startAttempt) return;
        preferredDeviceId = pickPreferredAudioInputDeviceId(devices);
      }
      const session = await createRecorderAudioSession({
        preferredDeviceId,
        fftSize: FFT_SIZE,
        displayPixelsPerSecond: DISPLAY_PIXELS_PER_SECOND,
        workletModuleUrl: new URL("./worklets/audioWorklet.js", import.meta.url),
        onWorkletMessage: (event) => {
          const sampleCount = Number(event.data.sampleCount);
          state.signalLevel = Number(event.data.signalLevel) || 0;
          if (!Number.isFinite(sampleCount) || sampleCount !== state.hopSize) {
            console.error("something has gone very wrong this should not be possible", {
              sampleCount,
              expectedHopSize: state.hopSize,
            });
          }
          processCurrentAudioHop();
        },
      });
      if (startAttempt !== state.startAttempt) {
        destroyRecorderAudioSession(session);
        return;
      }

      const hzLength = Math.floor(CENTER_SECONDS * DISPLAY_PIXELS_PER_SECOND);
      const hzBuffer = audioState.hzBuffer && audioState.hzBuffer.length === hzLength
          ? audioState.hzBuffer
          : createHzBuffer(hzLength);

      state.hopSize = session.hopSize;
      audioState.context = session.context;
      audioState.source = session.source;
      audioState.stream = session.stream;
      audioState.captureNode = session.captureNode;
      audioState.analyser = session.analyser;
      audioState.silentOutputGain = session.silentOutputGain;
      audioState.sampleRate = session.sampleRate;
      audioState.hzBuffer = hzBuffer;
      audioState.centerHz = audioState.centerHz || DEFAULT_CENTER_HZ;

      setStreamListeningEnabled(session.stream, state.ui.isWantedRunning);
      spectrogramCapture = createSpectrogramCaptureBuffers(session.analyser.frequencyBinCount);
      state.forceRedraw = true;
      setUi({
        isAudioRunning: true,
        hasEverRun: true,
      });
    } catch (error) {
      if (startAttempt !== state.startAttempt) {
        return;
      }
      setUi({
        isWantedRunning: false,
        error: error?.message || "Microphone access failed.",
      });
    } finally {
      state.isStarting = false;
    }
  }

  function stopAudio() {
    state.startAttempt += 1;
    if (spectrogramNoiseState.calibrating) {
      finishSpectrogramNoiseCalibration(false);
    }
    destroyRecorderAudioSession(audioState);
    audioState.context = null;
    audioState.source = null;
    audioState.stream = null;
    audioState.captureNode = null;
    audioState.analyser = null;
    audioState.silentOutputGain = null;
    state.signalLevel = 0;
    state.frameDirty = false;
    setUi({isAudioRunning: false});
  }

  function syncAudioState() {
    const shouldRun = (state.keepRunningInBackground || state.isForeground) && state.ui.isWantedRunning;
    if (!shouldRun) {
      if (state.isStarting) {
        state.startAttempt += 1;
      }
      if (state.ui.isAudioRunning) {
        stopAudio();
      }
      return;
    }
    if (shouldRun && !state.ui.isAudioRunning) {
      startAudio();
      return;
    }
    if (state.ui.isAudioRunning && audioState.stream) {
      setStreamListeningEnabled(audioState.stream, state.ui.isWantedRunning);
    }
  }

  function beginSpectrogramNoiseCalibration() {
    const binCount = audioState.analyser?.frequencyBinCount ?? spectrogramCapture.spectrumNormalized.length;
    spectrogramNoiseState.calibrating = true;
    spectrogramNoiseState.sumBins = new Float32Array(binCount);
    spectrogramNoiseState.sampleCount = 0;
    setUi({spectrogramNoiseCalibrating: true});
  }

  function finishSpectrogramNoiseCalibration(commitProfile) {
    const hasSamples = spectrogramNoiseState.sampleCount > 0 && spectrogramNoiseState.sumBins;
    if (commitProfile && hasSamples) {
      const profile = new Float32Array(spectrogramNoiseState.sumBins.length);
      for (let i = 0; i < profile.length; i += 1) {
        profile[i] = spectrogramNoiseState.sumBins[i] / spectrogramNoiseState.sampleCount;
      }
      spectrogramNoiseState.profile = profile;
      writeSpectrogramNoiseProfile(profile);
      setUi({spectrogramNoiseProfileReady: true});
    }
    spectrogramNoiseState.calibrating = false;
    spectrogramNoiseState.sumBins = null;
    spectrogramNoiseState.sampleCount = 0;
    setUi({spectrogramNoiseCalibrating: false});
  }

  function clearNoiseProfile() {
    spectrogramNoiseState.profile = null;
    writeSpectrogramNoiseProfile(null);
    setUi({spectrogramNoiseProfileReady: false});
  }

  function drawActiveChart() {
    const currentView = state.activeView;
    if (currentView === "vibrato") {
      chartRefs.vibratoChartRef?.current?.draw({
        smoothedPitchCentsRing: pitchHistory.smoothedPitchCentsRing,
        rawPitchCentsRing: pitchHistory.rawPitchCentsRing,
        signalStrengthRing: pitchHistory.signalStrengthRing,
        vibratoRateHzRing: pitchHistory.vibratoRateHzRing,
      });
      return;
    }
    if (currentView === "spectrogram") {
      chartRefs.spectrogramChartRef?.current?.draw({
        binCount: spectrogramCapture.spectrumNormalized.length,
        sampleRate: audioState.sampleRate,
      });
      return;
    }
    chartRefs.pitchChartRef?.current?.draw({
      smoothedPitchCentsRing: pitchHistory.smoothedPitchCentsRing,
      signalStrengthRing: pitchHistory.signalStrengthRing,
    });
  }

  function renderLoop(nowMs) {
    if (state.runAt30Fps) {
      const lastFrameMs = renderState.lastFrameMs;
      if (lastFrameMs > 0 && (nowMs - lastFrameMs) <= 25) {
        renderState.rafId = requestAnimationFrame(renderLoop);
        return;
      }
      renderState.lastFrameMs = nowMs;
    } else {
      renderState.lastFrameMs = 0;
    }

    const didFrameDataChange = state.frameDirty;
    state.frameDirty = false;
    const previousDisplayedRate = renderState.displayedVibratoRate;
    let displayedRate = previousDisplayedRate;

    if (state.activeView === "vibrato") {
      const vibratoRateRing = pitchHistory.vibratoRateHzRing;
      const newestRate = readNewestRingValue(vibratoRateRing);
      let estimatedRate = null;
      if (Number.isFinite(newestRate)) {
        estimatedRate = newestRate;
        renderState.lastKnownVibratoRate = newestRate;
      } else if (previousDisplayedRate !== null) {
        estimatedRate = previousDisplayedRate;
      } else {
        estimatedRate = renderState.lastKnownVibratoRate ?? findMostRecentFiniteInRing(vibratoRateRing);
      }

      if (estimatedRate !== null) {
        if (previousDisplayedRate === null) {
          displayedRate = estimatedRate;
        } else {
          const elapsedSinceLastRateUpdateMs = renderState.lastVibratoRateUpdateMs === null
              ? 16
              : Math.max(0, nowMs - renderState.lastVibratoRateUpdateMs);
          const baseSmoothingFactor = 1 - Math.exp(-elapsedSinceLastRateUpdateMs / VIBRATO_RATE_SMOOTHING_TIME_MS);
          displayedRate = previousDisplayedRate + ((estimatedRate - previousDisplayedRate) * baseSmoothingFactor);
        }
        renderState.lastVibratoRateUpdateMs = nowMs;
      }
    }

    const shouldDrawNow = state.forceRedraw || didFrameDataChange;
    if (shouldDrawNow) {
      state.forceRedraw = false;
      drawActiveChart();
    }

    if (displayedRate !== previousDisplayedRate) {
      setUi({vibratoRate: displayedRate});
    }
    renderState.displayedVibratoRate = displayedRate;
    renderState.rafId = requestAnimationFrame(renderLoop);
  }

  function ensureRenderLoop() {
    if (!renderState.rafId) {
      renderState.rafId = requestAnimationFrame(renderLoop);
    }
  }

  function teardownResizeObserver() {
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  function setupResizeObserver() {
    teardownResizeObserver();
    const container = chartRefs.containerRef?.current;
    if (!container || typeof ResizeObserver !== "function") return;
    const onResize = () => {
      const nextWidth = Math.max(1, Math.floor(container.clientWidth ?? window.innerWidth));
      if (nextWidth !== state.chartWidthPx) {
        state.chartWidthPx = nextWidth;
        resizePitchTimeline(pitchHistory, nextWidth);
      }
      if (!state.ui.isAudioRunning) {
        state.forceRedraw = true;
      }
    };
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);
    onResize();
  }

  syncBatteryPolling();
  ensureRenderLoop();

  const engine = {
    attachCharts({pitchChart, vibratoChart, spectrogramChart, container}) {
      chartRefs.pitchChartRef = pitchChart ?? null;
      chartRefs.vibratoChartRef = vibratoChart ?? null;
      chartRefs.spectrogramChartRef = spectrogramChart ?? null;
      chartRefs.containerRef = container ?? null;
      setupResizeObserver();
      state.forceRedraw = true;
    },
    detachCharts() {
      chartRefs.pitchChartRef = null;
      chartRefs.vibratoChartRef = null;
      chartRefs.spectrogramChartRef = null;
      chartRefs.containerRef = null;
      teardownResizeObserver();
    },
    updateSettings({
                     keepRunningInBackground,
                     autoPauseOnSilence,
                     runAt30Fps,
                     pitchMinNote,
                     pitchMaxNote,
                     spectrogramMinHz,
                     spectrogramMaxHz,
                   }) {
      if (typeof keepRunningInBackground === "boolean") {
        state.keepRunningInBackground = keepRunningInBackground;
      }
      if (typeof autoPauseOnSilence === "boolean") {
        state.autoPauseOnSilence = autoPauseOnSilence;
      }
      if (typeof runAt30Fps === "boolean") {
        state.runAt30Fps = runAt30Fps;
      }
      if (pitchMinNote && pitchMaxNote) {
        state.pitchRange = {
          minHz: noteNameToHz(pitchMinNote),
          maxHz: noteNameToHz(pitchMaxNote),
          minCents: noteNameToCents(pitchMinNote),
          maxCents: noteNameToCents(pitchMaxNote),
        };
      }
      if (Number.isFinite(spectrogramMinHz) && Number.isFinite(spectrogramMaxHz)) {
        state.spectrogramRange = {
          minHz: spectrogramMinHz,
          maxHz: spectrogramMaxHz,
        };
      }
      state.forceRedraw = true;
      syncAudioState();
    },
    setActiveView(view) {
      state.activeView = view;
      state.forceRedraw = true;
    },
    setSettingsOpen(isOpen) {
      const wasOpen = state.settingsOpen;
      state.settingsOpen = Boolean(isOpen);
      if (wasOpen && !state.settingsOpen) {
        state.forceRedraw = true;
      }
    },
    setWantsToRun(isWanted) {
      setUi({isWantedRunning: Boolean(isWanted)});
      syncAudioState();
    },
    startIfNeeded() {
      syncAudioState();
    },
    stop() {
      stopAudio();
    },
    destroy() {
      teardownResizeObserver();
      if (renderState.rafId) {
        cancelAnimationFrame(renderState.rafId);
        renderState.rafId = 0;
      }
      if (state.batteryIntervalId) {
        window.clearInterval(state.batteryIntervalId);
        state.batteryIntervalId = 0;
      }
      unsubscribeForeground?.();
      unsubscribeForeground = null;
      stopAudio();
      listeners.clear();
    },
    subscribeUi(listener) {
      listeners.add(listener);
      listener(state.ui);
      return () => {
        listeners.delete(listener);
      };
    },
    getUiSnapshot() {
      return state.ui;
    },
    onNoiseCalibratePointerDown(event) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      beginSpectrogramNoiseCalibration();
    },
    onNoiseCalibratePointerUp(event) {
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!spectrogramNoiseState.calibrating) return;
      finishSpectrogramNoiseCalibration(true);
    },
    onNoiseCalibrateContextMenu(event) {
      event.preventDefault();
    },
    clearSpectrogramNoiseProfile() {
      clearNoiseProfile();
    },
  };

  return engine;
}
