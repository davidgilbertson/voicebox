import {useEffect, useRef, useState} from "react";
import colors from "tailwindcss/colors";
import {
  drawGrid,
  drawSemitoneLabels,
  lerp,
} from "./tools.js";
import {analyzeAudioWindow, createAudioState, setupAudioState} from "./audioSeries.js";
import {createPitchTimeline, writePitchTimeline} from "./pitchTimeline.js";
import {estimateTimelineVibratoRateHz} from "./vibratoRate.js";
import Chart from "./Chart.jsx";
import SettingsPanel from "./SettingsPanel.jsx";

const FFT_SIZE = 2048;
const SAMPLES_PER_SECOND = 200;
const SILENCE_PAUSE_THRESHOLD_MS = 300;
const PITCH_SECONDS = 5; // x axis range
const WAVE_Y_RANGE = 300; // in cents
const MIN_HZ = 65; // ~C2
const MAX_HZ = 1100; // ~C6
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
const WAVEFORM_LINE_COLOR = colors.sky[400];

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
  if (typeof document === "undefined") return true;
  if (document.visibilityState === "hidden") return false;
  if (typeof document.hasFocus === "function") {
    return document.hasFocus();
  }
  return true;
}

export default function App() {
  const chartRef = useRef(null);
  const vibratoBarRef = useRef(null);
  const audioRef = useRef(createAudioState(SAMPLES_PER_SECOND));
  const timelineRef = useRef(createPitchTimeline({
    samplesPerSecond: SAMPLES_PER_SECOND,
    seconds: PITCH_SECONDS,
    silencePauseThresholdMs: SILENCE_PAUSE_THRESHOLD_MS,
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
  const [ui, setUi] = useState({
    isRunning: false,
    error: "",
    timings: {data: null, draw: 0},
    level: {rms: 0},
    rawHz: 0,
    hasVoice: false,
    vibratoRateHz: null,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wantsToRun, setWantsToRun] = useState(true);
  const [isForeground, setIsForeground] = useState(() => computeIsForeground());
  const [keepRunningInBackground, setKeepRunningInBackground] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem("voicebox.keepRunningInBackground");
      return stored ? JSON.parse(stored) === true : false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
          "voicebox.keepRunningInBackground",
          JSON.stringify(keepRunningInBackground)
      );
    } catch {
      // Ignore storage errors (private mode / quota).
    }
  }, [keepRunningInBackground]);

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
        // Overwrite oldest samples if producer outruns consumer.
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
      const result = analyzeAudioWindow(audioRef.current, windowSamples, MIN_HZ, MAX_HZ);
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
          echoCancellation: false, // The killer on mobile!
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

      // Keep the worklet active without audible playback.
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
    // Only clear audio resources, preserve pitch state for chart continuity
    audioRef.current.context = null;
    audioRef.current.source = null;
    audioRef.current.stream = null;
    audioRef.current.captureNode = null;
    audioRef.current.sinkGain = null;
    rawBufferRef.current = createRawAudioBuffer(analysisRef.current.sampleRate);
    analysisRef.current = createAnalysisState(analysisRef.current.sampleRate);
    setUi((prev) => ({...prev, isRunning: false}));
  };

  const drawWaveform = () => {
    const {centerCents} = audioRef.current;
    const {values, writeIndex, count} = timelineRef.current;
    chartRef.current?.draw({
      values,
      writeIndex,
      count,
      yOffset: centerCents,
      yRange: WAVE_Y_RANGE,
      lineColor: WAVEFORM_LINE_COLOR,
      lineWidth: 1.5,
      gapThreshold: 300,
      drawBackground: (ctx, width, height) => {
        ctx.imageSmoothingEnabled = true;
        ctx.lineWidth = 1;
        drawGrid(ctx, width, height, WAVE_Y_RANGE);
        drawSemitoneLabels(ctx, width, height, WAVE_Y_RANGE);
        ctx.imageSmoothingEnabled = true;
      },
    });
  };

  const renderLoop = () => {
    const didTimelineChange = processBufferedAudio();
    const nowMs = performance.now();
    const previousDisplayedRateHz = animationRef.current.displayedVibratoRateHz;
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

    const latestMetrics = metricsRef.current;
    let displayedRateHz = null;

    if (estimatedRateHz !== null) {
      animationRef.current.lastValidVibratoRateMs = nowMs;
      const previousRateHz = animationRef.current.displayedVibratoRateHz;
      if (previousRateHz === null) {
        displayedRateHz = estimatedRateHz;
      } else {
        const barWidth = Math.max(1, vibratoBarRef.current?.clientWidth ?? 1);
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

    const didDisplayRateChange = displayedRateHz !== previousDisplayedRateHz;
    animationRef.current.displayedVibratoRateHz = displayedRateHz;

    if (didTimelineChange) {
      const drawStart = performance.now();
      drawWaveform();
      const drawElapsed = performance.now() - drawStart;

      animationRef.current.drawAvg = lerp(
          animationRef.current.drawAvg,
          drawElapsed,
          0.2
      );
    }

    if (didTimelineChange || didDisplayRateChange) {
      setUi((prev) => ({
        ...prev,
        timings: {
          data: latestMetrics.hasVoice ? animationRef.current.dataAvg : null,
          draw: animationRef.current.drawAvg,
        },
        level: latestMetrics.level,
        rawHz: latestMetrics.rawHz,
        hasVoice: latestMetrics.hasVoice,
        vibratoRateHz: displayedRateHz,
      }));
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
        drawWaveform();
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
  }, [ui.isRunning]);

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

  const vibratoRatePositionPct = ui.vibratoRateHz === null
      ? null
      : ((ui.vibratoRateHz - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100;
  const vibratoRatePillPct = vibratoRatePositionPct === null
      ? null
      : Math.max(8, Math.min(92, vibratoRatePositionPct));
  const sweetStartPct = ((VIBRATO_SWEET_MIN_HZ - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100;
  const sweetEndPct = ((VIBRATO_SWEET_MAX_HZ - VIBRATO_RATE_MIN_HZ) / (VIBRATO_RATE_MAX_HZ - VIBRATO_RATE_MIN_HZ)) * 100;

  return (
      <div className="h-[100dvh] w-full overflow-hidden bg-slate-900 text-slate-100 md:bg-slate-950">
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-slate-900 md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
            <div className="relative min-h-0 flex-[2] p-2">
              <Chart ref={chartRef} className="h-full w-full"/>
              {ui.error ? (
                  <div className="absolute inset-x-3 top-14 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-200">
                    {ui.error}
                  </div>
              ) : null}
            </div>
            <div className="pointer-events-none border-t border-slate-800/70 px-2 pb-2 pt-1">
              <div className="relative">
                <div ref={vibratoBarRef} className="relative h-3 w-full overflow-hidden rounded-none bg-slate-600/80">
                  <div
                      className="absolute top-0 bottom-0 bg-emerald-400/85"
                      style={{
                        left: `${sweetStartPct}%`,
                        width: `${sweetEndPct - sweetStartPct}%`,
                      }}
                  />
                </div>
                {vibratoRatePositionPct !== null ? (
                    <>
                      <div
                          className="absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-full border border-slate-300/20 bg-slate-900/85 px-2 py-0.5 text-xs font-medium text-slate-100"
                          style={{left: `${vibratoRatePillPct}%`}}
                      >
                        {ui.vibratoRateHz.toFixed(1)} Hz
                      </div>
                      <div
                          className="absolute -top-3 bottom-0 w-0.5 bg-white/90"
                          style={{left: `${vibratoRatePositionPct}%`, transform: "translateX(-1px)"}}
                      />
                    </>
                ) : null}
              </div>
              <div className="relative mt-1 h-3 text-[10px] leading-none text-slate-400/65">
                <span className="absolute left-0 top-0">{VIBRATO_RATE_MIN_HZ} Hz</span>
                <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetStartPct}%`}}>
                  {VIBRATO_SWEET_MIN_HZ} Hz
                </span>
                <span className="absolute top-0 -translate-x-1/2 text-slate-300/85" style={{left: `${sweetEndPct}%`}}>
                  {VIBRATO_SWEET_MAX_HZ} Hz
                </span>
                <span className="absolute right-0 top-0">{VIBRATO_RATE_MAX_HZ} Hz</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
              <div>Data: {ui.timings.data === null ? "--" : `${ui.timings.data.toFixed(2)} ms`}</div>
              <div>Draw: {ui.timings.draw.toFixed(2)} ms</div>
              <div>RMS: {ui.level.rms?.toFixed(3) ?? "--"}</div>
              <div>Hz: {ui.rawHz ? ui.rawHz.toFixed(1) : "0"}</div>
            </div>
            <footer className="relative flex items-center justify-center gap-3 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
              <button
                  type="button"
                  onClick={() => setWantsToRun((prev) => !prev)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold shadow ${
                      ui.isRunning
                          ? "bg-emerald-400 text-emerald-950"
                          : "bg-red-400 text-red-950"
                  }`}
              >
                {ui.isRunning ? "Stop" : "Start"}
              </button>
              <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="absolute right-4 text-2xl text-slate-200 transition hover:text-white"
                  aria-label="Open settings"
              >
                ⚙
              </button>
            </footer>
          </main>
          <SettingsPanel
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              keepRunningInBackground={keepRunningInBackground}
              onKeepRunningInBackgroundChange={setKeepRunningInBackground}
          />
        </div>
      </div>
  );
}
