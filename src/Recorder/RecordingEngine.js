import {
  CENTER_SECONDS,
  DISPLAY_PIXELS_PER_SECOND,
  FFT_SIZE,
  PITCH_MAX_NOTE_DEFAULT,
  PITCH_MIN_NOTE_DEFAULT,
  SILENCE_PAUSE_THRESHOLD_MS,
  SPECTROGRAM_BIN_COUNT,
  readMaxSignalLevel,
  writeMaxSignalLevel,
} from "./config.js";
import { createPitchProcessingState, resizePitchProcessingState } from "./pitchProcessing.js";
import {
  createHighResSpectrogramBuffers,
  createSpectrogramBuffers,
  processOneAudioHop,
} from "./hopProcessing.js";
import { createRecorderAudioSession, destroyRecorderAudioSession } from "./audioSession.js";
import { BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor } from "./batteryUsage.js";
import { computeIsForeground, subscribeToForegroundChanges } from "../foreground.js";
import { noteNameToCents, noteNameToHz } from "../pitchScale.js";
import { pickPreferredAudioInputDeviceId } from "../tools.js";

const MIN_SIGNAL_THRESHOLD = 0.015;
const VIBRATO_RATE_SMOOTHING_TIME_MS = 630;
let recordingEngineSingleton = null;

function createHzBuffer(length) {
  const hzBuffer = new Float32Array(length);
  hzBuffer.fill(Number.NaN);
  return hzBuffer;
}

function setStreamListeningEnabled(stream, enabled) {
  if (!stream) return;
  const tracks =
    typeof stream.getAudioTracks === "function"
      ? stream.getAudioTracks()
      : typeof stream.getTracks === "function"
        ? stream.getTracks()
        : [];
  for (const track of tracks) {
    track.enabled = enabled;
  }
}

export class RecordingEngine {
  constructor() {
    this.listeners = new Set();
    this.chartRefs = {
      pitchChartRef: null,
      vibratoChartRef: null,
      spectrogramChartRef: null,
      containerRef: null,
    };
    this.resizeObserver = null;
    this.batteryUsageMonitor = createBatteryUsageMonitor();
    const initialMaxSignalLevel = readMaxSignalLevel() * 0.9;
    writeMaxSignalLevel(initialMaxSignalLevel);

    this.state = {
      ui: {
        isAudioRunning: false,
        error: "",
        hasRejectedMicPermission: false,
        hasEverRun: false,
        isWantedRunning: true,
        batteryUsagePerMinute: null,
        vibratoRate: null,
      },
      isStarting: false,
      startAttempt: 0,
      isForeground: computeIsForeground(),
      keepRunningInBackground: false,
      activeView: "spectrogram",
      autoPauseOnSilence: true,
      runAt30Fps: false,
      highResSpectrogram: false,
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
      lineStrengthEma: 0,
      skipNextSpectrumFrame: false,
      frameDirty: false,
      forceRedraw: true,
      batteryIntervalId: 0,
    };

    this.renderState = {
      rafId: 0,
      lastFrameMs: 0,
      displayedVibratoRate: null,
      lastVibratoRateUpdateMs: null,
      lastKnownVibratoRate: null,
    };

    this.audioSessionState = {
      context: null,
      analyser: null,
      highResAnalyser: null,
      source: null,
      stream: null,
      captureNode: null,
      silentOutputGain: null,
      hzBuffer: null,
      hzIndex: 0,
      sampleRate: 48000,
    };
    this.pitchProcessingState = createPitchProcessingState({
      columnRateHz: DISPLAY_PIXELS_PER_SECOND,
      seconds: this.state.chartWidthPx / DISPLAY_PIXELS_PER_SECOND,
      silencePauseStepThreshold: Math.round(
        (SILENCE_PAUSE_THRESHOLD_MS / 1000) * DISPLAY_PIXELS_PER_SECOND,
      ),
    });
    this.spectrogramBuffers = createSpectrogramBuffers(SPECTROGRAM_BIN_COUNT);
    this.highResSpectrogramBuffers = null;
    this.signalTracking = {
      maxHeardSignalLevel: initialMaxSignalLevel,
    };
    this.unsubscribeForeground = subscribeToForegroundChanges(this.onForegroundChange);

    this.syncBatteryPolling();
    this.ensureRenderLoop();
  }

  onForegroundChange = (isForeground) => {
    this.state.isForeground = isForeground;
    this.syncBatteryPolling();
    this.syncAudioState();
  };

  setUi = (nextPartial) => {
    this.state.ui = { ...this.state.ui, ...nextPartial };
    for (const listener of this.listeners) {
      listener(this.state.ui);
    }
  };

  sampleBatteryUsage = async () => {
    const usage = await this.batteryUsageMonitor.readUsagePerMinute();
    this.setUi({ batteryUsagePerMinute: usage });
  };

  syncBatteryPolling = () => {
    if (this.state.batteryIntervalId) {
      window.clearInterval(this.state.batteryIntervalId);
      this.state.batteryIntervalId = 0;
    }
    this.sampleBatteryUsage();
    if (this.state.isForeground) {
      this.state.batteryIntervalId = window.setInterval(
        this.sampleBatteryUsage,
        BATTERY_SAMPLE_INTERVAL_MS,
      );
    }
  };

  processCurrentAudioHop = () => {
    if (!this.state.ui.isWantedRunning) return;
    const result = processOneAudioHop({
      engineState: {
        activeView: this.state.activeView,
        pitchRange: this.state.pitchRange,
        spectrogramRange: this.state.spectrogramRange,
        signalLevel: this.state.signalLevel,
        minSignalThreshold: MIN_SIGNAL_THRESHOLD,
        signalTracking: this.signalTracking,
        lineStrengthEma: this.state.lineStrengthEma,
        autoPauseOnSilence: this.state.autoPauseOnSilence,
        skipNextSpectrumFrame: this.state.skipNextSpectrumFrame,
      },
      hopState: {
        audioSessionState: this.audioSessionState,
        processingState: this.pitchProcessingState,
        spectrogramBuffers: this.spectrogramBuffers,
        highResSpectrogramBuffers: this.highResSpectrogramBuffers,
      },
    });
    this.state.skipNextSpectrumFrame = result.nextSkipNextSpectrumFrame;
    this.state.lineStrengthEma = result.nextLineStrengthEma;
    this.spectrogramBuffers = result.spectrogramBuffers;
    this.highResSpectrogramBuffers = result.highResSpectrogramBuffers;
    if (result.shouldPersistMaxSignalLevel) {
      writeMaxSignalLevel(this.state.signalLevel);
    }
    if (result.spectrogramColumn) {
      this.chartRefs.spectrogramChartRef?.current?.appendColumn(result.spectrogramColumn);
    }
    if (result.didFrameDataChange) {
      this.state.frameDirty = true;
    }
  };

  startAudio = async () => {
    if (this.state.ui.isAudioRunning || this.state.isStarting) return;
    this.state.isStarting = true;
    const startAttempt = ++this.state.startAttempt;
    this.setUi({ error: "" });
    try {
      let preferredDeviceId = null;
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (startAttempt !== this.state.startAttempt) return;
        preferredDeviceId = pickPreferredAudioInputDeviceId(devices);
      }
      const session = await createRecorderAudioSession({
        preferredDeviceId,
        fftSize: FFT_SIZE,
        highResSpectrogram: this.state.highResSpectrogram,
        displayPixelsPerSecond: DISPLAY_PIXELS_PER_SECOND,
        workletModuleUrl: new URL("./worklets/audioWorklet.js", import.meta.url),
        onWorkletMessage: (event) => {
          const sampleCount = Number(event.data.sampleCount);
          this.state.signalLevel = Number(event.data.signalLevel) || 0;
          if (!Number.isFinite(sampleCount) || sampleCount !== this.state.hopSize) {
            console.error("something has gone very wrong this should not be possible", {
              sampleCount,
              expectedHopSize: this.state.hopSize,
            });
          }
          this.processCurrentAudioHop();
        },
      });
      if (startAttempt !== this.state.startAttempt) {
        destroyRecorderAudioSession(session);
        return;
      }

      const hzLength = Math.floor(CENTER_SECONDS * DISPLAY_PIXELS_PER_SECOND);
      const hzBuffer =
        this.audioSessionState.hzBuffer && this.audioSessionState.hzBuffer.length === hzLength
          ? this.audioSessionState.hzBuffer
          : createHzBuffer(hzLength);

      this.state.hopSize = session.hopSize;
      this.audioSessionState.context = session.context;
      this.audioSessionState.source = session.source;
      this.audioSessionState.stream = session.stream;
      this.audioSessionState.captureNode = session.captureNode;
      this.audioSessionState.analyser = session.analyser;
      this.audioSessionState.highResAnalyser = session.highResAnalyser;
      this.audioSessionState.silentOutputGain = session.silentOutputGain;
      this.audioSessionState.sampleRate = session.sampleRate;
      this.audioSessionState.hzBuffer = hzBuffer;

      setStreamListeningEnabled(session.stream, this.state.ui.isWantedRunning);
      this.spectrogramBuffers = createSpectrogramBuffers(session.analyser.frequencyBinCount);
      this.highResSpectrogramBuffers = session.highResAnalyser
        ? createHighResSpectrogramBuffers(session.highResAnalyser.frequencyBinCount)
        : null;
      this.state.forceRedraw = true;
      this.setUi({
        isAudioRunning: true,
        hasRejectedMicPermission: false,
        hasEverRun: true,
      });
    } catch (error) {
      if (startAttempt !== this.state.startAttempt) {
        return;
      }
      const isPermissionRejected =
        error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
      this.setUi({
        isWantedRunning: false,
        hasRejectedMicPermission: isPermissionRejected || this.state.ui.hasRejectedMicPermission,
        error: error?.message || "Microphone access failed.",
      });
    } finally {
      this.state.isStarting = false;
    }
  };

  stopAudio = () => {
    this.state.startAttempt += 1;
    destroyRecorderAudioSession(this.audioSessionState);
    this.audioSessionState.context = null;
    this.audioSessionState.source = null;
    this.audioSessionState.stream = null;
    this.audioSessionState.captureNode = null;
    this.audioSessionState.analyser = null;
    this.audioSessionState.highResAnalyser = null;
    this.audioSessionState.silentOutputGain = null;
    this.highResSpectrogramBuffers = null;
    this.state.signalLevel = 0;
    this.state.frameDirty = false;
    this.setUi({ isAudioRunning: false });
  };

  syncAudioState = () => {
    const shouldRun =
      (this.state.keepRunningInBackground || this.state.isForeground) &&
      this.state.ui.isWantedRunning;
    if (!shouldRun) {
      if (this.state.isStarting) {
        this.state.startAttempt += 1;
      }
      if (this.state.ui.isAudioRunning) {
        this.stopAudio();
      }
      return;
    }
    if (shouldRun && !this.state.ui.isAudioRunning) {
      this.startAudio();
      return;
    }
    if (this.state.ui.isAudioRunning && this.audioSessionState.stream) {
      setStreamListeningEnabled(this.audioSessionState.stream, this.state.ui.isWantedRunning);
    }
  };

  drawActiveChart = () => {
    if (this.state.activeView === "vibrato") {
      this.chartRefs.vibratoChartRef?.current?.draw({
        smoothedPitchCentsRing: this.pitchProcessingState.smoothedPitchCentsRing,
        lineStrengthRing: this.pitchProcessingState.lineStrengthRing,
        vibratoRateHzRing: this.pitchProcessingState.vibratoRateHzRing,
      });
      return;
    }
    if (this.state.activeView === "spectrogram") {
      const activeSpectrogramBuffers = this.highResSpectrogramBuffers ?? this.spectrogramBuffers;
      this.chartRefs.spectrogramChartRef?.current?.draw({
        binCount: activeSpectrogramBuffers.spectrumNormalized.length,
        sampleRate: this.audioSessionState.sampleRate,
      });
      return;
    }
    this.chartRefs.pitchChartRef?.current?.draw({
      smoothedPitchCentsRing: this.pitchProcessingState.smoothedPitchCentsRing,
      lineStrengthRing: this.pitchProcessingState.lineStrengthRing,
    });
  };

  renderLoop = (nowMs) => {
    if (this.state.runAt30Fps) {
      const lastFrameMs = this.renderState.lastFrameMs;
      if (lastFrameMs > 0 && nowMs - lastFrameMs <= 25) {
        this.renderState.rafId = requestAnimationFrame(this.renderLoop);
        return;
      }
      this.renderState.lastFrameMs = nowMs;
    } else {
      this.renderState.lastFrameMs = 0;
    }

    const didFrameDataChange = this.state.frameDirty;
    this.state.frameDirty = false;
    const previousDisplayedRate = this.renderState.displayedVibratoRate;
    let displayedRate = previousDisplayedRate;

    if (this.state.activeView === "vibrato") {
      const vibratoRateRing = this.pitchProcessingState.vibratoRateHzRing;
      const newestRate = vibratoRateRing.newest();
      let estimatedRate = null;
      if (Number.isFinite(newestRate)) {
        estimatedRate = newestRate;
        this.renderState.lastKnownVibratoRate = newestRate;
      } else if (previousDisplayedRate !== null) {
        estimatedRate = previousDisplayedRate;
      } else {
        estimatedRate =
          this.renderState.lastKnownVibratoRate ?? vibratoRateRing.findMostRecentFinite();
      }

      if (estimatedRate !== null) {
        if (previousDisplayedRate === null) {
          displayedRate = estimatedRate;
        } else {
          const elapsedSinceLastRateUpdateMs =
            this.renderState.lastVibratoRateUpdateMs === null
              ? 16
              : Math.max(0, nowMs - this.renderState.lastVibratoRateUpdateMs);
          const baseSmoothingFactor =
            1 - Math.exp(-elapsedSinceLastRateUpdateMs / VIBRATO_RATE_SMOOTHING_TIME_MS);
          displayedRate =
            previousDisplayedRate + (estimatedRate - previousDisplayedRate) * baseSmoothingFactor;
        }
        this.renderState.lastVibratoRateUpdateMs = nowMs;
      }
    }

    const shouldDrawNow = this.state.forceRedraw || didFrameDataChange;
    if (shouldDrawNow) {
      this.state.forceRedraw = false;
      this.drawActiveChart();
    }

    if (displayedRate !== previousDisplayedRate) {
      this.setUi({ vibratoRate: displayedRate });
    }
    this.renderState.displayedVibratoRate = displayedRate;
    this.renderState.rafId = requestAnimationFrame(this.renderLoop);
  };

  ensureRenderLoop = () => {
    if (!this.renderState.rafId) {
      this.renderState.rafId = requestAnimationFrame(this.renderLoop);
    }
  };

  teardownResizeObserver = () => {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  };

  setupResizeObserver = () => {
    this.teardownResizeObserver();
    const container = this.chartRefs.containerRef?.current;
    if (!container || typeof ResizeObserver !== "function") return;
    const onResize = () => {
      const nextWidth = Math.max(1, Math.floor(container.clientWidth ?? window.innerWidth));
      if (nextWidth !== this.state.chartWidthPx) {
        this.state.chartWidthPx = nextWidth;
        resizePitchProcessingState(this.pitchProcessingState, nextWidth);
      }
      this.state.forceRedraw = true;
    };
    this.resizeObserver = new ResizeObserver(onResize);
    this.resizeObserver.observe(container);
    onResize();
  };

  attachCharts = ({ pitchChart, vibratoChart, spectrogramChart, container }) => {
    this.chartRefs.pitchChartRef = pitchChart ?? null;
    this.chartRefs.vibratoChartRef = vibratoChart ?? null;
    this.chartRefs.spectrogramChartRef = spectrogramChart ?? null;
    this.chartRefs.containerRef = container ?? null;
    this.setupResizeObserver();
    this.state.forceRedraw = true;
  };

  detachCharts = () => {
    this.chartRefs.pitchChartRef = null;
    this.chartRefs.vibratoChartRef = null;
    this.chartRefs.spectrogramChartRef = null;
    this.chartRefs.containerRef = null;
    this.teardownResizeObserver();
  };

  updateSettings = ({
    keepRunningInBackground,
    autoPauseOnSilence,
    runAt30Fps,
    highResSpectrogram,
    pitchMinNote,
    pitchMaxNote,
    spectrogramMinHz,
    spectrogramMaxHz,
  }) => {
    if (typeof keepRunningInBackground === "boolean") {
      this.state.keepRunningInBackground = keepRunningInBackground;
    }
    if (typeof autoPauseOnSilence === "boolean") {
      this.state.autoPauseOnSilence = autoPauseOnSilence;
    }
    if (typeof runAt30Fps === "boolean") {
      this.state.runAt30Fps = runAt30Fps;
    }
    let shouldRestartAudio = false;
    if (typeof highResSpectrogram === "boolean") {
      if (highResSpectrogram !== this.state.highResSpectrogram) {
        this.state.highResSpectrogram = highResSpectrogram;
        shouldRestartAudio = true;
      }
    }
    if (pitchMinNote && pitchMaxNote) {
      this.state.pitchRange = {
        minHz: noteNameToHz(pitchMinNote),
        maxHz: noteNameToHz(pitchMaxNote),
        minCents: noteNameToCents(pitchMinNote),
        maxCents: noteNameToCents(pitchMaxNote),
      };
    }
    if (Number.isFinite(spectrogramMinHz) && Number.isFinite(spectrogramMaxHz)) {
      this.state.spectrogramRange = {
        minHz: spectrogramMinHz,
        maxHz: spectrogramMaxHz,
      };
    }
    this.state.forceRedraw = true;
    if (shouldRestartAudio && this.state.ui.isAudioRunning) {
      this.stopAudio();
    }
    this.syncAudioState();
  };

  setActiveView = (view) => {
    this.state.activeView = view;
    this.state.forceRedraw = true;
  };

  setWantsToRun = (isWanted) => {
    this.setUi({ isWantedRunning: Boolean(isWanted) });
    this.syncAudioState();
  };

  startIfNeeded = () => {
    this.syncAudioState();
  };

  stop = () => {
    this.stopAudio();
  };

  destroy = () => {
    this.teardownResizeObserver();
    if (this.renderState.rafId) {
      cancelAnimationFrame(this.renderState.rafId);
      this.renderState.rafId = 0;
    }
    if (this.state.batteryIntervalId) {
      window.clearInterval(this.state.batteryIntervalId);
      this.state.batteryIntervalId = 0;
    }
    this.unsubscribeForeground?.();
    this.unsubscribeForeground = null;
    this.stopAudio();
    this.listeners.clear();
  };

  subscribeUi = (listener) => {
    this.listeners.add(listener);
    listener(this.state.ui);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getUiSnapshot = () => this.state.ui;
}

export function getRecordingEngine() {
  if (!recordingEngineSingleton) {
    recordingEngineSingleton = new RecordingEngine();
  }
  return recordingEngineSingleton;
}

if (import.meta.env.MODE === "test") {
  globalThis.__resetRecordingEngineSingletonForTests = () => {
    if (!recordingEngineSingleton) return;
    recordingEngineSingleton.destroy();
    recordingEngineSingleton = null;
  };
}
