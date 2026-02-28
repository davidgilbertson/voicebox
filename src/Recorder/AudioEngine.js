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
  VIBRATO_RATE_MAX_HZ,
  VIBRATO_RATE_MIN_HZ,
  readMaxSignalLevel,
  readSpectrogramNoiseProfile,
  writeMaxSignalLevel,
  writeSpectrogramNoiseProfile,
} from "./config.js";
import {createPitchTimeline, resizePitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {estimateTimelineCenterCents, estimateTimelineVibratoRate} from "./vibratoRate.js";
import {analyzeAudioWindowFftPitch} from "./audioSeries.js";
import {createSpectrogramCaptureBuffers, processOneAudioHop} from "./hopProcessing.js";
import {createRecorderAudioSession, destroyRecorderAudioSession} from "./audioSession.js";
import {BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor} from "./batteryUsage.js";
import {computeIsForeground, subscribeToForegroundChanges} from "../foreground.js";
import {noteNameToCents, noteNameToHz} from "../pitchScale.js";
import {findMostRecentFiniteInRing, pickPreferredAudioInputDeviceId, readNewestRingValue} from "../tools.js";

const DEFAULT_CENTER_HZ = 220;
const MIN_SIGNAL_THRESHOLD = 0.015;
const NON_VIBRATO_ALPHA = 0.25;
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

function fillDetectionAlphaFromVibratoRate(vibratoRates, output) {
  for (let i = 0; i < vibratoRates.length; i += 1) {
    output[i] = Number.isFinite(vibratoRates[i]) ? 1 : NON_VIBRATO_ALPHA;
  }
}

export function createAudioEngine() {
  const listeners = new Set();
  const chartRefs = {
    pitchChart: null,
    vibratoChart: null,
    spectrogramChart: null,
    container: null,
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
    vibratoDetectionAlpha: null,
  };

  const audioState = {
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
  };
  const timeline = createPitchTimeline({
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

  function notifyUi() {
    for (const listener of listeners) {
      listener(state.ui);
    }
  }

  function setUi(nextPartial) {
    state.ui = {...state.ui, ...nextPartial};
    notifyUi();
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
      timeline,
      audioState,
      spectrogramNoiseState,
      spectrogramCapture,
      skipNextSpectrumFrame: state.skipNextSpectrumFrame,
      analyzePitch: analyzeAudioWindowFftPitch,
      writePitchTimeline,
      estimateTimelineVibratoRate,
      vibratoRateConfig: {
        minRateHz: VIBRATO_RATE_MIN_HZ,
        maxRateHz: VIBRATO_RATE_MAX_HZ,
        analysisWindowSeconds: VIBRATO_ANALYSIS_WINDOW_SECONDS,
        minContinuousSeconds: VIBRATO_MIN_CONTIGUOUS_SECONDS,
      },
    });
    state.skipNextSpectrumFrame = result.nextSkipNextSpectrumFrame;
    state.spectrumIntensityEma = result.nextSpectrumIntensityEma;
    spectrogramCapture = result.spectrogramCapture;
    if (result.shouldPersistMaxSignalLevel) {
      writeMaxSignalLevel(state.signalLevel);
    }
    if (result.spectrogramColumn) {
      chartRefs.spectrogramChart?.appendColumn(result.spectrogramColumn);
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
      audioState.sinkGain = session.sinkGain;
      audioState.sampleRate = session.sampleRate;
      audioState.hzBuffer = hzBuffer;
      audioState.centerHz = audioState.centerHz || DEFAULT_CENTER_HZ;
      audioState.centerCents = audioState.centerCents || 1200 * Math.log2(DEFAULT_CENTER_HZ);

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
    audioState.sinkGain = null;
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
      if (!renderState.vibratoDetectionAlpha || renderState.vibratoDetectionAlpha.length !== timeline.vibratoRates.length) {
        renderState.vibratoDetectionAlpha = new Float32Array(timeline.vibratoRates.length);
      }
      fillDetectionAlphaFromVibratoRate(timeline.vibratoRates, renderState.vibratoDetectionAlpha);
      const detectionAlphas = renderState.vibratoDetectionAlpha;
      const centerFromVibrato = estimateTimelineCenterCents({
        values: timeline.values,
        writeIndex: timeline.writeIndex,
        count: timeline.count,
        detectionAlphas,
      });
      if (centerFromVibrato !== null) {
        audioState.centerCents = centerFromVibrato;
      }
      chartRefs.vibratoChart?.draw({
        values: timeline.displayValues,
        intensities: timeline.intensities,
        detectionAlphas,
        writeIndex: timeline.writeIndex,
        count: timeline.count,
        yOffset: audioState.centerCents,
      });
      return;
    }
    if (currentView === "spectrogram") {
      chartRefs.spectrogramChart?.draw({
        binCount: spectrogramCapture.spectrumNormalized.length,
        sampleRate: audioState.sampleRate,
      });
      return;
    }
    chartRefs.pitchChart?.draw({
      values: timeline.displayValues,
      intensities: timeline.intensities,
      writeIndex: timeline.writeIndex,
      count: timeline.count,
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
      const newestRate = readNewestRingValue(
          timeline.vibratoRates,
          timeline.writeIndex,
          timeline.count
      );
      let estimatedRate = null;
      if (Number.isFinite(newestRate)) {
        estimatedRate = newestRate;
        renderState.lastKnownVibratoRate = newestRate;
      } else if (previousDisplayedRate !== null) {
        estimatedRate = previousDisplayedRate;
      } else {
        estimatedRate = renderState.lastKnownVibratoRate ?? findMostRecentFiniteInRing(
            timeline.vibratoRates,
            timeline.writeIndex,
            timeline.count
        );
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
    const container = chartRefs.container;
    if (!container || typeof ResizeObserver !== "function") return;
    const onResize = () => {
      const nextWidth = Math.max(1, Math.floor(container.clientWidth ?? window.innerWidth));
      if (nextWidth !== state.chartWidthPx) {
        state.chartWidthPx = nextWidth;
        resizePitchTimeline(timeline, nextWidth);
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
      chartRefs.pitchChart = pitchChart ?? null;
      chartRefs.vibratoChart = vibratoChart ?? null;
      chartRefs.spectrogramChart = spectrogramChart ?? null;
      chartRefs.container = container ?? null;
      setupResizeObserver();
      state.forceRedraw = true;
    },
    detachCharts() {
      chartRefs.pitchChart = null;
      chartRefs.vibratoChart = null;
      chartRefs.spectrogramChart = null;
      chartRefs.container = null;
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
