import {useEffect, useRef, useState} from "react";
import {
  drawGrid,
  drawSemitoneLabels,
  lerp,
} from "./tools.js";
import {analyzeAudioFrame, createAudioState, setupAudioState} from "./audioSeries.js";
import SettingsPanel from "./SettingsPanel.jsx";

const FFT_SIZE = 2048;
const defaultSamplesPerSecond = 240;
const SILENCE_PAUSE_THRESHOLD_MS = 300;
const PITCH_SECONDS = 5; // x axis range
const WAVE_Y_RANGE = 300; // in cents
const MIN_HZ = 65; // ~C2
const MAX_HZ = 1100; // ~C6
const CENTER_SECONDS = 1; // Window to use for vertical centering

function createSeriesBuffer(samplesPerSecond) {
  const length = Math.max(1, Math.floor(PITCH_SECONDS * samplesPerSecond));
  const values = new Float32Array(length);
  values.fill(Number.NaN);
  return {
    values,
    writeIndex: 0,
    count: 0,
  };
}

export default function App() {
  const canvasRef = useRef(null);
  const audioRef = useRef(createAudioState(defaultSamplesPerSecond));
  const seriesRef = useRef(createSeriesBuffer(defaultSamplesPerSecond));
  const silenceSinceRef = useRef(null);
  const silencePausedRef = useRef(false);
  const animationRef = useRef({
    rafId: 0,
    drawAvg: 0,
    dataAvg: 0,
    analysisTimer: 0,
  });
  const metricsRef = useRef({
    level: {max: 0, rms: 0},
    rawHz: 0,
  });
  const [ui, setUi] = useState({
    isRunning: false,
    error: "",
    timings: {data: 0, draw: 0},
    level: {max: 0},
    rawHz: 0,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wantsToRun, setWantsToRun] = useState(true);
  const [isForeground, setIsForeground] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible" && document.hasFocus();
  });
  const [keepRunningInBackground, setKeepRunningInBackground] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const stored = window.localStorage.getItem("voicebox.keepRunningInBackground");
      return stored ? JSON.parse(stored) === true : false;
    } catch {
      return false;
    }
  });
  const [samplesPerSecond, setSamplesPerSecond] = useState(() => {
    if (typeof window === "undefined") return defaultSamplesPerSecond;
    try {
      const stored = window.localStorage.getItem("voicebox.samplesPerSecond");
      const parsed = Number.parseInt(stored ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } catch {
      // Ignore storage errors (private mode / quota).
    }
    return defaultSamplesPerSecond;
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
    try {
      window.localStorage.setItem("voicebox.samplesPerSecond", String(samplesPerSecond));
    } catch {
      // Ignore storage errors (private mode / quota).
    }
  }, [samplesPerSecond]);

  useEffect(() => {
    seriesRef.current = createSeriesBuffer(samplesPerSecond);
    silenceSinceRef.current = null;
    silencePausedRef.current = false;
  }, [samplesPerSecond]);

  useEffect(() => {
    const updateForeground = () => {
      setIsForeground(
          document.visibilityState === "visible" && document.hasFocus()
      );
    };
    updateForeground();
    window.addEventListener("focus", updateForeground);
    window.addEventListener("blur", updateForeground);
    document.addEventListener("visibilitychange", updateForeground);
    return () => {
      window.removeEventListener("focus", updateForeground);
      window.removeEventListener("blur", updateForeground);
      document.removeEventListener("visibilitychange", updateForeground);
    };
  }, []);

  const pushSeriesValue = (value) => {
    const series = seriesRef.current;
    series.values[series.writeIndex] = value;
    series.writeIndex = (series.writeIndex + 1) % series.values.length;
    if (series.count < series.values.length) {
      series.count += 1;
    }
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
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.1;
      source.connect(analyser);

      const sampleRate = context.sampleRate;
      audioRef.current = setupAudioState(audioRef.current, {
        analyser,
        context,
        source,
        stream,
        analysisFps: samplesPerSecond,
        fftSize: FFT_SIZE,
        centerSeconds: CENTER_SECONDS,
        sampleRate,
      });
      silencePausedRef.current = false;

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
    if (animationRef.current.analysisTimer) {
      clearInterval(animationRef.current.analysisTimer);
      animationRef.current.analysisTimer = 0;
    }
    const {context, stream} = audioRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (context && context.state !== "closed") {
      context.close();
    }
    // Only clear audio resources, preserve pitch state for chart continuity
    audioRef.current.context = null;
    audioRef.current.analyser = null;
    audioRef.current.source = null;
    audioRef.current.stream = null;
    audioRef.current.timeData = null;
    silenceSinceRef.current = null;
    silencePausedRef.current = false;
    setUi((prev) => ({...prev, isRunning: false}));
  };

  const renderLoop = (now) => {
    const drawStart = performance.now();
    drawWaveform();
    const drawElapsed = performance.now() - drawStart;

    animationRef.current.drawAvg = lerp(
        animationRef.current.drawAvg,
        drawElapsed,
        0.2
    );
    const latestMetrics = metricsRef.current;
    setUi((prev) => ({
      ...prev,
      timings: {
        data: animationRef.current.dataAvg,
        draw: animationRef.current.drawAvg,
      },
      level: latestMetrics.level,
      rawHz: latestMetrics.rawHz,
    }));
    animationRef.current.rafId = requestAnimationFrame(renderLoop);
  };

  const analyzeFrame = () => {
    const dataStart = performance.now();
    const result = analyzeAudioFrame(audioRef.current, MIN_HZ, MAX_HZ);
    const dataElapsed = performance.now() - dataStart;
    if (!result) return;
    const now = performance.now();
    if (result.hasVoice) {
      silencePausedRef.current = false;
      silenceSinceRef.current = null;
    } else {
      if (silenceSinceRef.current === null) {
        silenceSinceRef.current = now;
      } else if (
        now - silenceSinceRef.current >= SILENCE_PAUSE_THRESHOLD_MS
      ) {
        silencePausedRef.current = true;
      }
    }

    if (!silencePausedRef.current) {
      pushSeriesValue(result.hasVoice ? result.cents : Number.NaN);
    }
    animationRef.current.dataAvg = lerp(animationRef.current.dataAvg, dataElapsed, 0.2);
    metricsRef.current = {
      level: {max: result.peak, rms: result.rms},
      rawHz: result.hz,
    };
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const {centerCents} = audioRef.current;
    const {values, writeIndex, count} = seriesRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const {clientWidth, clientHeight} = canvas;
    const cssWidth = Math.max(1, Math.floor(clientWidth));
    const cssHeight = Math.max(1, Math.floor(clientHeight));
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    // Render at device-pixel resolution while drawing in CSS-pixel units.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 1;
    drawGrid(ctx, cssWidth, cssHeight, WAVE_Y_RANGE);
    drawSemitoneLabels(ctx, cssWidth, cssHeight, WAVE_Y_RANGE);
    ctx.imageSmoothingEnabled = true;

    const midY = cssHeight / 2;
    const scaleY = (cssHeight / 2) / WAVE_Y_RANGE;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let hasActivePath = false;
    let lastValue = null;
    let lastY = null;
    const totalSlots = values.length;
    const firstIndex = count === totalSlots ? writeIndex : 0;
    const startSlot = count < totalSlots ? totalSlots - count : 0;
    for (let i = 0; i < count; i += 1) {
      const bufferIndex = (firstIndex + i) % totalSlots;
      const value = values[bufferIndex];
      if (Number.isNaN(value)) {
        lastValue = null;
        lastY = null;
        continue;
      }
      const slot = startSlot + i;
      const x = totalSlots > 1 ? (slot / (totalSlots - 1)) * cssWidth : cssWidth;
      const centered = value - centerCents;
      const y = midY - centered * scaleY;
      if (lastValue === null || Math.abs(value - lastValue) > 300 || lastY === null) {
        if (hasActivePath) {
          ctx.stroke();
        }
        ctx.strokeStyle = "#38bdf8";
        ctx.beginPath();
        ctx.moveTo(x, y);
        hasActivePath = true;
      } else {
        ctx.lineTo(x, y);
      }
      lastValue = value;
      lastY = y;
    }
    if (hasActivePath) {
      ctx.stroke();
    }

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

  const startAnalysisTimer = (samplesPerSecondValue) => {
    if (animationRef.current.analysisTimer) {
      clearInterval(animationRef.current.analysisTimer);
    }
    audioRef.current.analysisFps = samplesPerSecondValue;
    animationRef.current.analysisTimer = window.setInterval(
        analyzeFrame,
        1000 / samplesPerSecondValue
    );
  };

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

  useEffect(() => {
    if (!ui.isRunning) return;
    startAnalysisTimer(samplesPerSecond);
  }, [samplesPerSecond, ui.isRunning]);

  return (
      <div className="h-[100dvh] w-full overflow-hidden bg-slate-900 text-slate-100 md:bg-slate-950">
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-slate-900 md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
            <div className="relative min-h-0 flex-[2] p-2">
              <canvas ref={canvasRef} className="h-full w-full"/>
              {ui.error ? (
                  <div className="absolute inset-x-3 top-14 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-200">
                    {ui.error}
                  </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
              <div>Data: {ui.timings.data.toFixed(2)} ms</div>
              <div>Draw: {ui.timings.draw.toFixed(2)} ms</div>
              {/*<div>Peak: {ui.level.max.toFixed(3)}</div>*/}
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
              samplesPerSecond={samplesPerSecond}
              onSamplesPerSecondChange={setSamplesPerSecond}
          />
        </div>
      </div>
  );
}
