import {
  CENTER_SECONDS,
  DISPLAY_PIXELS_PER_SECOND,
  FFT_SIZE,
  PITCH_MAX_NOTE_DEFAULT,
  PITCH_MIN_NOTE_DEFAULT,
  SILENCE_PAUSE_THRESHOLD_MS,
  SPECTROGRAM_BIN_COUNT,
  MIN_VOLUME_THRESHOLD_DEFAULT,
  readMaxVolume,
  writeMaxVolume,
} from "./config.js";
import { createPitchProcessingState, resizePitchProcessingState } from "./pitchProcessing.js";
import {
  createHighResSpectrogramBuffers,
  createSpectrogramBuffers,
  processOneAudioHop,
} from "./hopProcessing.js";
import { createRecorderAudioSession, destroyRecorderAudioSession } from "./audioSession.js";
import { BATTERY_SAMPLE_INTERVAL_MS, createBatteryUsageMonitor } from "./batteryUsage.js";
import { calibrateMinVolumeThreshold as runVolumeCalibration } from "./micCalibration.js";
import { computeIsForeground, subscribeToForegroundChanges } from "../foreground.js";
import { noteNameToCents, noteNameToHz } from "../pitchScale.js";
import { clamp } from "../tools.js";
import {
  appendRawAudioSamples,
  createRawAudioState,
  createWavBlob,
  readRawAudioSamples,
  resetRawAudioState,
} from "./rawAudio.js";

const VIBRATO_RATE_SMOOTHING_TIME_MS = 630;
const STARTUP_MAX_VOLUME_DECAY_FACTOR = 0.8;
let recordingEngineSingleton = null;

function createHzBuffer(length) {
  const hzBuffer = new Float32Array(length);
  hzBuffer.fill(Number.NaN);
  return hzBuffer;
}

function getChartSeconds(chartWidthPx) {
  return clamp(chartWidthPx / DISPLAY_PIXELS_PER_SECOND, 1 / DISPLAY_PIXELS_PER_SECOND, Infinity);
}

function formatShareTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function getCapturedSeconds(rawAudioState) {
  if (!(rawAudioState.sampleRate > 0)) return 0;
  return rawAudioState.ring.sampleCount / rawAudioState.sampleRate;
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
  constructor(config) {
    this.listeners = new Set();
    this.chartRefs = {
      pitchChartRef: null,
      vibratoChartRef: null,
      spectrogramChartRef: null,
      containerRef: null,
    };
    this.resizeObserver = null;
    // Decay the remembered max a little on each session start so it can adapt downward over time
    // while still retaining a device-specific sense of "loud enough" between runs.
    const initialMaxVolume = readMaxVolume() * STARTUP_MAX_VOLUME_DECAY_FACTOR;
    writeMaxVolume(initialMaxVolume);

    this.state = {
      ui: {
        isAudioRunning: false,
        error: "",
        hasRejectedMicPermission: false,
        hasEverRun: false,
        isWantedRunning: true,
        batteryUsagePerMinute: null,
        vibratoRate: null,
        isSharingRawAudio: false,
        rawAudioShareError: "",
      },
      isStarting: false,
      startAttempt: 0,
      isForeground: config.isForeground,
      keepRunningInBackground: config.keepRunningInBackground,
      activeView: "spectrogram",
      autoPauseOnSilence: config.autoPauseOnSilence,
      runAt30Fps: config.runAt30Fps,
      highResSpectrogram: config.highResSpectrogram,
      pitchRange: {
        minHz: noteNameToHz(config.pitchMinNote),
        maxHz: noteNameToHz(config.pitchMaxNote),
        minCents: noteNameToCents(config.pitchMinNote),
        maxCents: noteNameToCents(config.pitchMaxNote),
      },
      chartWidthPx: Math.max(1, Math.floor(window.innerWidth)),
      hopSize: Math.round(48_000 / DISPLAY_PIXELS_PER_SECOND),
      volume: 0,
      minVolumeThreshold: config.minVolumeThreshold,
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
      seconds: getChartSeconds(this.state.chartWidthPx),
      silencePauseStepThreshold: Math.round(
        (SILENCE_PAUSE_THRESHOLD_MS / 1000) * DISPLAY_PIXELS_PER_SECOND,
      ),
    });
    this.spectrogramBuffers = createSpectrogramBuffers(SPECTROGRAM_BIN_COUNT);
    this.highResSpectrogramBuffers = null;
    this.volumeTracking = {
      maxHeardVolume: initialMaxVolume,
    };
    this.rawAudioState = createRawAudioState({
      sampleRate: this.audioSessionState.sampleRate,
      seconds: getChartSeconds(this.state.chartWidthPx),
    });
    this.batteryUsageMonitor = createBatteryUsageMonitor();
    this.pendingAudioRestart = false;
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
        pitchRange: this.state.pitchRange,
        volume: this.state.volume,
        minVolumeThreshold: this.state.minVolumeThreshold,
        volumeTracking: this.volumeTracking,
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
    if (result.shouldPersistMaxVolume) {
      writeMaxVolume(this.state.volume);
    }
    if (result.spectrumDb) {
      this.chartRefs.spectrogramChartRef?.current?.appendColumn(
        result.spectrumDb,
        this.volumeTracking.maxHeardVolume,
      );
    }
    if (result.didFrameDataChange) {
      this.state.frameDirty = true;
    }
  };

  startAudio = async () => {
    if (this.state.ui.isAudioRunning || this.state.isStarting) return;
    this.state.isStarting = true;
    // If settings change WHILE audio is starting, we'll set this back to true and need to start again
    this.pendingAudioRestart = false;
    const startAttempt = ++this.state.startAttempt;
    this.setUi({ error: "" });
    try {
      const session = await createRecorderAudioSession({
        fftSize: FFT_SIZE,
        highResSpectrogram: this.state.highResSpectrogram,
        displayPixelsPerSecond: DISPLAY_PIXELS_PER_SECOND,
        workletModuleUrl: new URL("./worklets/audioWorklet.js", import.meta.url),
        onWorkletMessage: (event) => {
          const sampleCount = Number(event.data.sampleCount);
          this.state.volume = Number(event.data.volume) || 0;
          appendRawAudioSamples(this.rawAudioState, event.data.samples);
          if (!Number.isFinite(sampleCount) || sampleCount !== this.state.hopSize) {
            console.error("something has gone very wrong this should not be possible", {
              sampleCount,
              expectedHopSize: this.state.hopSize,
            });
          }
          this.processCurrentAudioHop();
        },
      });
      if (startAttempt !== this.state.startAttempt || this.pendingAudioRestart) {
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
      resetRawAudioState(this.rawAudioState, {
        sampleRate: session.sampleRate,
        seconds: getChartSeconds(this.state.chartWidthPx),
      });

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
      if (this.pendingAudioRestart) {
        this.syncAudioState();
      }
    }
  };

  calibrateMinVolumeThreshold = async ({ settleMs = 100, captureMs = 1000 } = {}) => {
    if (this.state.isStarting) {
      throw new Error("Microphone is still starting.");
    }
    if (!this.state.ui.isAudioRunning) {
      this.setWantsToRun(true);
      await this.startAudio();
    }
    if (!this.state.ui.isAudioRunning) {
      throw new Error("Microphone is not running.");
    }

    // We reuse the live analyser when recorder audio is already active so calibration does not need
    // a second temporary mic context on top of the existing one.
    return runVolumeCalibration({
      settleMs,
      captureMs,
    });
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
    this.state.volume = 0;
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
      this.chartRefs.spectrogramChartRef?.current?.draw({
        binCount: this.state.highResSpectrogram ? SPECTROGRAM_BIN_COUNT * 2 : SPECTROGRAM_BIN_COUNT,
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
        resizePitchProcessingState(
          this.pitchProcessingState,
          Math.max(1, Math.floor(DISPLAY_PIXELS_PER_SECOND * getChartSeconds(nextWidth))),
        );
        resetRawAudioState(this.rawAudioState, {
          sampleRate: this.audioSessionState.sampleRate,
          seconds: getChartSeconds(nextWidth),
        });
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
    minVolumeThreshold,
    pitchMinNote,
    pitchMaxNote,
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
    if (Number.isFinite(minVolumeThreshold) && minVolumeThreshold > 0) {
      this.state.minVolumeThreshold = minVolumeThreshold;
    }
    let shouldRestartAudio = false;
    if (typeof highResSpectrogram === "boolean") {
      if (highResSpectrogram !== this.state.highResSpectrogram) {
        if (this.state.isStarting && !this.state.ui.isAudioRunning) {
          this.pendingAudioRestart = true;
        }
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
    this.setUi({ isWantedRunning: Boolean(isWanted), rawAudioShareError: "" });
    this.syncAudioState();
  };

  canShareRawAudio = () => {
    if (this.state.ui.isWantedRunning || !this.state.ui.hasEverRun) return false;
    if (this.rawAudioState.ring.sampleCount <= 0) return false;
    if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function")
      return false;
    const seconds = Math.max(1, Math.ceil(getCapturedSeconds(this.rawAudioState)));
    const file = new File(
      [],
      `voicebox-last-${seconds}-seconds-${formatShareTimestamp(new Date())}.wav`,
      {
        type: "audio/wav",
      },
    );
    return navigator.canShare({ files: [file] });
  };

  shareRawAudio = async () => {
    this.setUi({ isSharingRawAudio: true, rawAudioShareError: "" });
    try {
      const samples = readRawAudioSamples(this.rawAudioState);
      const blob = createWavBlob(samples, this.rawAudioState.sampleRate);
      const seconds = Math.max(1, Math.ceil(getCapturedSeconds(this.rawAudioState)));
      const file = new File(
        [blob],
        `voicebox-last-${seconds}-seconds-${formatShareTimestamp(new Date())}.wav`,
        { type: blob.type },
      );
      await navigator.share({
        files: [file],
        title: "Voicebox capture",
        text: "Pitch capture from Voicebox",
      });
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        return false;
      }
      this.setUi({ rawAudioShareError: error?.message || "Unable to share audio." });
      return false;
    } finally {
      this.setUi({ isSharingRawAudio: false });
    }
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
