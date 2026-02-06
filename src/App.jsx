import {useEffect, useRef, useState} from "react";
import {
  drawGrid,
  drawSemitoneLabels,
  lerp,
} from "./tools.js";
import {analyzeAudioFrame, createAudioState, setupAudioState} from "./audioSeries.js";
import SettingsPanel from "./SettingsPanel.jsx";

const FFT_SIZE = 2048;
const SAMPLE_RATE = 48000; // Assumed; actual rate set on audio context creation
const DEFAULT_ANALYSIS_FPS = 240;
const PITCH_SECONDS = 5; // x axis range
const WAVE_Y_RANGE = 300; // in cents
const MIN_HZ = 65; // ~C2
const MAX_HZ = 1100; // ~C6
const CENTER_SECONDS = 1; // Window to use for vertical centering
const DETECTORS = [
  {id: "autocorr", label: "Autocorr"},
  {id: "pitchy", label: "Pitchy"},
  {id: "yin", label: "YIN"},
];

export default function App() {
  const canvasRef = useRef(null);
  const audioRef = useRef(createAudioState(DEFAULT_ANALYSIS_FPS));
  const resumeOnFocusRef = useRef(false);
  const pausedAtRef = useRef(null);
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
    detector: "autocorr",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    const stopForBackground = () => {
      if (!keepRunningInBackground && ui.isRunning) {
        resumeOnFocusRef.current = true;
        stopAudio();
      }
    };
    const tryResumeAfterFocusLoss = () => {
      if (!keepRunningInBackground && !ui.isRunning && resumeOnFocusRef.current) {
        resumeOnFocusRef.current = false;
        startAudio();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopForBackground();
      } else if (document.visibilityState === "visible") {
        tryResumeAfterFocusLoss();
      }
    };
    const handleBlur = () => {
      stopForBackground();
    };
    const handleFocus = () => {
      tryResumeAfterFocusLoss();
    };
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [keepRunningInBackground, ui.isRunning]);

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
        analysisFps: DEFAULT_ANALYSIS_FPS,
        fftSize: FFT_SIZE,
        pitchSeconds: PITCH_SECONDS,
        centerSeconds: CENTER_SECONDS,
        sampleRate,
      });
      if (pausedAtRef.current !== null) {
        const pausedDuration = performance.now() - pausedAtRef.current;
        for (const sample of audioRef.current.samples) {
          sample.time += pausedDuration;
        }
        pausedAtRef.current = null;
      }

      setUi((prev) => ({...prev, isRunning: true}));
      animationRef.current.drawAvg = 0;
      animationRef.current.dataAvg = 0;
      animationRef.current.rafId = requestAnimationFrame(renderLoop);
      startAnalysisTimer(DEFAULT_ANALYSIS_FPS);
    } catch (err) {
      setUi((prev) => ({
        ...prev,
        error: err?.message || "Microphone access failed.",
      }));
    }
  };

  const stopAudio = () => {
    if (ui.isRunning && pausedAtRef.current === null) {
      pausedAtRef.current = performance.now();
    }
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
    audioRef.current.pitchy = null;
    audioRef.current.yin = null;
    audioRef.current.timeData = null;
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
    const result = analyzeAudioFrame(audioRef.current, ui.detector, MIN_HZ, MAX_HZ);
    const dataElapsed = performance.now() - dataStart;
    if (!result) return;
    animationRef.current.dataAvg = lerp(animationRef.current.dataAvg, dataElapsed, 0.2);
    metricsRef.current = {
      level: {max: result.peak, rms: result.rms},
      rawHz: result.hz,
    };
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const {centerCents, samples} = audioRef.current;
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

    const now = performance.now();
    const windowMs = PITCH_SECONDS * 1000;
    const windowStart = now - windowMs;
    let dropCount = 0;
    while (dropCount < samples.length && samples[dropCount].time < windowStart) {
      dropCount += 1;
    }
    if (dropCount) {
      samples.splice(0, dropCount);
    }

    const midY = cssHeight / 2;
    const scaleY = (cssHeight / 2) / WAVE_Y_RANGE;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let hasActivePath = false;
    let lastValue = null;
    let lastY = null;
    let lastColor = null;
    for (const sample of samples) {
      const value = sample.cents;
      if (Number.isNaN(value)) {
        lastValue = null;
        lastY = null;
        continue;
      }
      const x = cssWidth - ((now - sample.time) / windowMs) * cssWidth;
      if (x < 0 || x > cssWidth) continue;
      const centered = value - centerCents;
      const y = midY - centered * scaleY;
      const lineColor = sample.filtered ? "#f97316" : "#38bdf8";
      if (lastValue === null || Math.abs(value - lastValue) > 300 || lastY === null || lineColor !== lastColor) {
        if (hasActivePath) {
          ctx.stroke();
        }
        ctx.strokeStyle = lineColor;
        ctx.beginPath();
        ctx.moveTo(x, y);
        hasActivePath = true;
      } else {
        ctx.lineTo(x, y);
      }
      lastValue = value;
      lastY = y;
      lastColor = lineColor;
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

  const startAnalysisTimer = (analysisFps) => {
    if (animationRef.current.analysisTimer) {
      clearInterval(animationRef.current.analysisTimer);
    }
    audioRef.current.analysisFps = analysisFps;
    animationRef.current.analysisTimer = window.setInterval(
        analyzeFrame,
        1000 / analysisFps
    );
  };

  return (
      <div className="h-[100dvh] w-full overflow-hidden bg-slate-900 text-slate-100 md:bg-slate-950">
        <div className="mx-auto flex h-full w-full max-w-none items-stretch px-0 py-0 md:max-w-[450px] md:items-center md:justify-center md:px-2 md:py-2">
          <main className="relative flex min-h-0 flex-1 flex-col bg-slate-900 md:h-full md:w-full md:max-h-[1000px] md:flex-none md:rounded-xl md:border md:border-slate-800 md:shadow-2xl">
            <div className="relative min-h-0 flex-[2] p-2">
              <canvas ref={canvasRef} className="h-full w-full"/>
              <button
                  type="button"
                  onClick={ui.isRunning ? stopAudio : startAudio}
                  className="absolute right-3 top-3 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 shadow"
              >
                {ui.isRunning ? "Stop" : "Start"}
              </button>
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
            <footer className="flex items-center justify-between gap-3 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
              {DETECTORS.map((entry) => (
                  <button
                      key={entry.id}
                      type="button"
                      onClick={() => setUi((prev) => ({...prev, detector: entry.id}))}
                      className={`rounded-full border px-3 py-1 ${
                          ui.detector === entry.id
                              ? "border-slate-200 bg-slate-100 text-slate-900"
                              : "border-slate-700 text-slate-200"
                      }`}
                  >
                    {entry.label}
                  </button>
              ))}
              <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="ml-auto text-2xl text-slate-200 transition hover:text-white"
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
