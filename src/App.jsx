import {useEffect, useRef, useState} from "react";
import {lerp, ls} from "./tools.js";
import {analyzeAudioWindow, createAudioState, setupAudioState} from "./audioSeries.js";
import {createPitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {estimateTimelineVibratoRateHz} from "./vibratoRate.js";
import SettingsPanel from "./SettingsPanel.jsx";
import VibratoChart from "./VibratoChart.jsx";
import PitchChart from "./PitchChart.jsx";
import {noteNameToCents, noteNameToHz, PITCH_NOTE_OPTIONS} from "./pitchScale.js";

const FFT_SIZE = 2048;
const SAMPLES_PER_SECOND = 200;
const SILENCE_PAUSE_THRESHOLD_MS = 300;
const PITCH_SECONDS = 5; // x axis range
const WAVE_Y_RANGE = 300; // in cents
const VIBRATO_MIN_HZ = 65; // ~C2
const VIBRATO_MAX_HZ = 1100; // ~C6
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
const ACTIVE_VIEW_STORAGE_KEY = "voicebox.activeView";
const ACTIVE_VIEW_DEFAULT = "vibrato";
const AUTO_PAUSE_ON_SILENCE_STORAGE_KEY = "voicebox.autoPauseOnSilence";
const SHOW_STATS_STORAGE_KEY = "voicebox.showStats";
const AUTO_PAUSE_ON_SILENCE_DEFAULT = true;
const SHOW_STATS_DEFAULT = false;
const MAX_DRAW_JUMP_CENTS = 80;

function createRawAudioBuffer(sampleRate) {
  const capacity = Math.max(FFT_SIZE * 2, Math.floor(sampleRate * RAW_BUFFER_SECONDS));
  return {
    values: new Float32Array(capacity),
    writeIndex: 0,
    readIndex: 0,
    size: 0,
  };
}

function createAnalysisState(sampleRate) {
  return {
    sampleRate,
    hopSize: sampleRate / SAMPLES_PER_SECOND,
    hopAccumulator: 0,
    processedSamples: 0,
    windowValues: new Float32Array(FFT_SIZE),
    windowIndex: 0,
    windowCount: 0,
    scratch: new Float32Array(FFT_SIZE),
  };
}

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
  return stored === "pitch" || stored === "vibrato" ? stored : ACTIVE_VIEW_DEFAULT;
}

export default function App() {
  const vibratoChartRef = useRef(null);
  const pitchChartRef = useRef(null);
  const audioRef = useRef(createAudioState(SAMPLES_PER_SECOND));
  // Single shared timeline feeds both pitch and vibrato views so switching preserves continuity.
  const timelineRef = useRef(createPitchTimeline({
    samplesPerSecond: SAMPLES_PER_SECOND,
    seconds: PITCH_SECONDS,
    silencePauseThresholdMs: SILENCE_PAUSE_THRESHOLD_MS,
    autoPauseOnSilence: AUTO_PAUSE_ON_SILENCE_DEFAULT,
    nowMs: performance.now(),
  }));
  const rawBufferRef = useRef(createRawAudioBuffer(48_000));
  const analysisRef = useRef(createAnalysisState(48_000));
  const animationRef = useRef({
    rafId: 0,
    drawAvg: 0,
    dataAvg: 0,
    displayedVibratoRateHz: null,
    lastValidVibratoRateMs: null,
  });
  const metricsRef = useRef({
    level: {rms: 0},
    rawHz: 0,
    hasVoice: false,
  });
  const forceRedrawRef = useRef(false);
  const activeViewRef = useRef(ACTIVE_VIEW_DEFAULT);
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
  const [pitchMinNote, setPitchMinNote] = useState(() => safeReadPitchNote(
      "voicebox.pitchMinNote",
      PITCH_MIN_NOTE_DEFAULT
  ));
  const [pitchMaxNote, setPitchMaxNote] = useState(() => safeReadPitchNote(
      "voicebox.pitchMaxNote",
      PITCH_MAX_NOTE_DEFAULT
  ));

  const pitchMinHz = noteNameToHz(pitchMinNote);
  const pitchMaxHz = noteNameToHz(pitchMaxNote);
  const pitchMinCents = noteNameToCents(pitchMinNote);
  const pitchMaxCents = noteNameToCents(pitchMaxNote);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

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
    ls.set("voicebox.pitchMinNote", pitchMinNote);
    ls.set("voicebox.pitchMaxNote", pitchMaxNote);
  }, [pitchMinNote, pitchMaxNote]);

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

  const enqueueAudioSamples = (chunk) => {
    if (!chunk?.length) return;
    const raw = rawBufferRef.current;
    for (let i = 0; i < chunk.length; i += 1) {
      raw.values[raw.writeIndex] = chunk[i];
      raw.writeIndex = (raw.writeIndex + 1) % raw.values.length;
      if (raw.size < raw.values.length) {
        raw.size += 1;
      } else {
        raw.readIndex = (raw.readIndex + 1) % raw.values.length;
      }
    }
  };

  const copyAnalysisWindowToScratch = () => {
    const analysis = analysisRef.current;
    if (analysis.windowCount < FFT_SIZE) return null;
    const start = analysis.windowIndex;
    const tailLength = FFT_SIZE - start;
    analysis.scratch.set(analysis.windowValues.subarray(start), 0);
    analysis.scratch.set(analysis.windowValues.subarray(0, start), tailLength);
    return analysis.scratch;
  };

  const processBufferedAudio = () => {
    const raw = rawBufferRef.current;
    const analysis = analysisRef.current;
    const currentView = activeViewRef.current;
    const minHz = currentView === "pitch" ? pitchRangeRef.current.minHz : VIBRATO_MIN_HZ;
    const maxHz = currentView === "pitch" ? pitchRangeRef.current.maxHz : VIBRATO_MAX_HZ;
    let processedWindows = 0;
    let analysisElapsedMs = 0;
    let didTimelineChange = false;

    while (raw.size > 0) {
      const sample = raw.values[raw.readIndex];
      raw.readIndex = (raw.readIndex + 1) % raw.values.length;
      raw.size -= 1;

      analysis.windowValues[analysis.windowIndex] = sample;
      analysis.windowIndex = (analysis.windowIndex + 1) % analysis.windowValues.length;
      if (analysis.windowCount < analysis.windowValues.length) {
        analysis.windowCount += 1;
      }
      analysis.processedSamples += 1;
      analysis.hopAccumulator += 1;

      if (analysis.hopAccumulator < analysis.hopSize) {
        continue;
      }
      analysis.hopAccumulator -= analysis.hopSize;
      const windowSamples = copyAnalysisWindowToScratch();
      if (!windowSamples) continue;

      const start = performance.now();
      const result = analyzeAudioWindow(audioRef.current, windowSamples, minHz, maxHz, {
        adaptiveRange: currentView === "pitch",
      });
      analysisElapsedMs += performance.now() - start;
      processedWindows += 1;
      if (!result) continue;

      const nowMs = (analysis.processedSamples / analysis.sampleRate) * 1000;
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
      };
    }

    if (processedWindows > 0) {
      const avgPerWindowMs = analysisElapsedMs / processedWindows;
      animationRef.current.dataAvg = lerp(animationRef.current.dataAvg, avgPerWindowMs, 0.2);
    }
    return didTimelineChange;
  };

  const startAudio = async () => {
    setUi((prev) => ({...prev, error: ""}));
    if (ui.isRunning) return;
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
      captureNode.port.onmessage = (event) => {
        enqueueAudioSamples(event.data);
      };
      source.connect(captureNode);

      const sinkGain = context.createGain();
      sinkGain.gain.value = 0;
      captureNode.connect(sinkGain);
      sinkGain.connect(context.destination);

      const sampleRate = context.sampleRate;
      rawBufferRef.current = createRawAudioBuffer(sampleRate);
      analysisRef.current = createAnalysisState(sampleRate);
      audioRef.current = setupAudioState(audioRef.current, {
        context,
        source,
        stream,
        captureNode,
        sinkGain,
        analysisFps: SAMPLES_PER_SECOND,
        centerSeconds: CENTER_SECONDS,
        sampleRate,
      });

      setUi((prev) => ({...prev, isRunning: true}));
      animationRef.current.drawAvg = 0;
      animationRef.current.dataAvg = 0;
      animationRef.current.rafId = requestAnimationFrame(renderLoop);
    } catch (err) {
      setWantsToRun(false);
      setUi((prev) => ({
        ...prev,
        error: err?.message || "Microphone access failed.",
      }));
    }
  };

  const stopAudio = () => {
    if (animationRef.current.rafId) {
      cancelAnimationFrame(animationRef.current.rafId);
      animationRef.current.rafId = 0;
    }
    const {context, stream, source, captureNode, sinkGain} = audioRef.current;
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
    audioRef.current.sinkGain = null;
    rawBufferRef.current = createRawAudioBuffer(analysisRef.current.sampleRate);
    analysisRef.current = createAnalysisState(analysisRef.current.sampleRate);
    setUi((prev) => ({...prev, isRunning: false}));
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
    pitchChartRef.current?.draw({
      values: timeline.values,
      writeIndex: timeline.writeIndex,
      count: timeline.count,
    });
  };

  const renderLoop = () => {
    const didTimelineChange = processBufferedAudio();
    const nowMs = performance.now();
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

    const shouldDrawNow = didTimelineChange || forceRedrawRef.current;
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
          data: latestMetrics.hasVoice ? animationRef.current.dataAvg : null,
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
  }, [activeView, pitchMaxCents, pitchMinCents, settingsOpen]);

  const shouldRun =
      wantsToRun &&
      !settingsOpen &&
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

  return (
      <div className="h-[var(--app-height)] w-full overflow-hidden bg-slate-900 text-slate-100 md:bg-slate-950">
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-slate-900 md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
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
                />
            ) : (
                <PitchChart
                    ref={pitchChartRef}
                    minCents={pitchMinCents}
                    maxCents={pitchMaxCents}
                    maxDrawJumpCents={MAX_DRAW_JUMP_CENTS}
                />
            )}
            {ui.error ? (
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
            <footer className="relative flex h-12 items-stretch gap-1 border-t border-slate-800 px-2 py-1 text-xs text-slate-300">
              <div className="flex w-40 items-stretch gap-1">
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
              </div>
              <div className="flex flex-1 items-stretch justify-center">
                <button
                    type="button"
                    onClick={() => setWantsToRun((prev) => !prev)}
                    className={`min-h-10 rounded-lg px-5 text-sm font-semibold shadow ${
                        ui.isRunning
                            ? "bg-emerald-400 text-emerald-950"
                            : "bg-red-400 text-red-950"
                    }`}
                >
                  {ui.isRunning ? "Stop" : "Start"}
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
          <SettingsPanel
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              keepRunningInBackground={keepRunningInBackground}
              onKeepRunningInBackgroundChange={setKeepRunningInBackground}
              autoPauseOnSilence={autoPauseOnSilence}
              onAutoPauseOnSilenceChange={setAutoPauseOnSilence}
              showStats={showStats}
              onShowStatsChange={setShowStats}
              pitchMinNote={pitchMinNote}
              pitchMaxNote={pitchMaxNote}
              pitchNoteOptions={PITCH_NOTE_OPTIONS}
              onPitchMinNoteChange={onPitchMinNoteChange}
              onPitchMaxNoteChange={onPitchMaxNoteChange}
          />
        </div>
      </div>
  );
}
