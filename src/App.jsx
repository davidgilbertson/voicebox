import {useEffect, useMemo, useRef, useState} from "react";
import {PitchDetector} from "pitchy";
import {YIN} from "pitchfinder";
import {
  detectPitchAutocorr,
  drawGrid,
  drawSemitoneLabels,
  lerp,
  median,
} from "./tools.js";

const RENDER_FPS = 30;
const ANALYSIS_FPS = 120;
const PITCH_SECONDS = 5;
const WAVE_Y_RANGE = 200;
const MIN_HZ = 65; // ~C2
const MAX_HZ = 1100; // ~C6
const CENTER_SECONDS = 0.9;
const MIN_RMS = 0.0001;
const DETECTORS = [
  {id: "autocorr", label: "Autocorr"},
  {id: "pitchy", label: "Pitchy"},
  {id: "yin", label: "YIN"},
];

export default function App() {
  const canvasRef = useRef(null);
  const audioRef = useRef({
    context: null,
    analyser: null,
    source: null,
    stream: null,
    pitchBuffer: null,
    pitchIndex: 0,
    hzBuffer: null,
    hzIndex: 0,
    pitchy: null,
    yin: null,
    sampleRate: 48000,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
    lastHz: 0,
    lastCents: 0,
    voiceActive: false,
    levelEma: 0,
    latestCents: Number.NaN,
  });
  const animationRef = useRef({
    rafId: 0,
    lastFrame: 0,
    drawAvg: 0,
    dataAvg: 0,
    analysisTimer: 0,
  });
  const renderRef = useRef({
    offscreen: null,
    buffer: null,
    ctx: null,
    bufferCtx: null,
    width: 0,
    height: 0,
    scrollRemainder: 0,
    lastValue: null,
    lastTime: 0,
    meanCents: 0,
  });
  const [ui, setUi] = useState({
    isRunning: false,
    error: "",
    timings: {data: 0, draw: 0},
    level: {max: 0},
    lastHz: 0,
    detector: "autocorr",
  });

  const detectorLabel = useMemo(() => {
    return DETECTORS.find((entry) => entry.id === ui.detector)?.label ?? "Autocorr";
  }, [ui.detector]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  const startAudio = async () => {
    setUi((prev) => ({...prev, error: ""}));
    if (ui.isRunning) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.1;
      source.connect(analyser);

      const sampleRate = context.sampleRate;
      const pitchLength = Math.floor(PITCH_SECONDS * ANALYSIS_FPS);
      const pitchBuffer = new Float32Array(pitchLength);
      pitchBuffer.fill(Number.NaN);
      const hzLength = Math.floor(CENTER_SECONDS * ANALYSIS_FPS);
      const hzBuffer = new Float32Array(hzLength);
      hzBuffer.fill(Number.NaN);
      const pitchy = PitchDetector.forFloat32Array(analyser.fftSize);
      const yin = YIN({sampleRate, threshold: 0.1});

      audioRef.current = {
        context,
        analyser,
        source,
        stream,
        pitchBuffer,
        pitchIndex: 0,
        hzBuffer,
        hzIndex: 0,
        pitchy,
        yin,
        sampleRate,
        centerHz: 220,
        centerCents: 1200 * Math.log2(220),
        lastHz: 0,
        lastCents: 0,
        voiceActive: false,
        levelEma: 0,
        latestCents: Number.NaN,
      };

      setUi((prev) => ({...prev, isRunning: true}));
      animationRef.current.lastFrame = 0;
      animationRef.current.drawAvg = 0;
      animationRef.current.dataAvg = 0;
      animationRef.current.rafId = requestAnimationFrame(renderLoop);
      animationRef.current.analysisTimer = window.setInterval(
          analyzeFrame,
          1000 / ANALYSIS_FPS
      );
    } catch (err) {
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
    audioRef.current = {
      context: null,
      analyser: null,
      source: null,
      stream: null,
      pitchBuffer: null,
      pitchIndex: 0,
      hzBuffer: null,
      hzIndex: 0,
      pitchy: null,
      yin: null,
      sampleRate: 48000,
      centerHz: 220,
      centerCents: 1200 * Math.log2(220),
      lastHz: 0,
      lastCents: 0,
      voiceActive: false,
      levelEma: 0,
      latestCents: Number.NaN,
    };
    setUi((prev) => ({...prev, isRunning: false}));
  };

  const renderLoop = (now) => {
    const frameInterval = 1000 / RENDER_FPS;
    const {lastFrame} = animationRef.current;
    if (now - lastFrame >= frameInterval) {
      animationRef.current.lastFrame = now;
      const drawStart = performance.now();
      drawWaveform();
      const drawElapsed = performance.now() - drawStart;

      animationRef.current.drawAvg = lerp(
          animationRef.current.drawAvg,
          drawElapsed,
          0.2
      );
      setUi((prev) => ({
        ...prev,
        timings: {
          data: animationRef.current.dataAvg,
          draw: animationRef.current.drawAvg,
        },
      }));
    }
    animationRef.current.rafId = requestAnimationFrame(renderLoop);
  };

  const analyzeFrame = () => {
    const dataStart = performance.now();
    pullAudioData();
    const dataElapsed = performance.now() - dataStart;
    animationRef.current.dataAvg = lerp(
        animationRef.current.dataAvg,
        dataElapsed,
        0.2
    );
  };

  const pullAudioData = () => {
    const {analyser, pitchBuffer, hzBuffer, pitchy, yin} = audioRef.current;
    if (!analyser || !pitchBuffer || !hzBuffer) return;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = data[i];
      const absValue = Math.abs(value);
      if (absValue > peak) peak = absValue;
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    audioRef.current.levelEma = lerp(audioRef.current.levelEma, rms, 0.2);
    let hz = 0;
    if (ui.detector === "pitchy" && pitchy) {
      const [detectedHz, clarity] = pitchy.findPitch(data, audioRef.current.sampleRate);
      hz = clarity > 0.7 ? detectedHz : 0;
    } else if (ui.detector === "yin" && yin) {
      hz = yin(data) || 0;
    } else {
      hz = detectPitchAutocorr(
          data,
          audioRef.current.sampleRate,
          MIN_HZ,
          MAX_HZ
      );
    }
    const hasVoice = audioRef.current.levelEma >= MIN_RMS && hz >= MIN_HZ && hz <= MAX_HZ;
    audioRef.current.voiceActive = Boolean(hasVoice);
    if (hasVoice) {
      audioRef.current.lastHz = hz;
      if (hz > MAX_HZ || hz < MIN_HZ) {
        // eslint-disable-next-line no-console
        console.log("Outlier Hz:", hz);
      }
      hzBuffer[audioRef.current.hzIndex] = hz;
      audioRef.current.hzIndex = (audioRef.current.hzIndex + 1) % hzBuffer.length;
      const centerHz = median(hzBuffer);
      if (centerHz > 0) {
        audioRef.current.centerHz = lerp(audioRef.current.centerHz, centerHz, 0.2);
        audioRef.current.centerCents = 1200 * Math.log2(audioRef.current.centerHz);
      }
    }
    const absCents = hasVoice ? 1200 * Math.log2(hz) : Number.NaN;
    audioRef.current.latestCents = absCents;

    let {pitchIndex} = audioRef.current;
    pitchBuffer[pitchIndex] = absCents;
    pitchIndex = (pitchIndex + 1) % pitchBuffer.length;
    audioRef.current.pitchIndex = pitchIndex;
    if (hasVoice) {
      audioRef.current.lastCents = absCents;
    }

    setUi((prev) => ({
      ...prev,
      level: {max: peak, rms: audioRef.current.levelEma},
      lastHz: audioRef.current.lastHz,
    }));
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const {centerCents, latestCents} = audioRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const {clientWidth, clientHeight} = canvas;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(clientWidth * dpr));
    const height = Math.max(1, Math.floor(clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ensureOffscreen(width, height);
    scrollOffscreen(width, height, dpr, latestCents, centerCents);

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 1 * dpr;
    drawGrid(ctx, width, height, dpr);
    drawSemitoneLabels(ctx, width, height, dpr, WAVE_Y_RANGE);
    ctx.drawImage(renderRef.current.offscreen, 0, 0);
  };

  const ensureOffscreen = (width, height) => {
    const offscreen = renderRef.current.offscreen;
    if (!offscreen || renderRef.current.width !== width || renderRef.current.height !== height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const buffer = document.createElement("canvas");
      buffer.width = width;
      buffer.height = height;
      renderRef.current.offscreen = canvas;
      renderRef.current.buffer = buffer;
      renderRef.current.ctx = canvas.getContext("2d");
      renderRef.current.bufferCtx = buffer.getContext("2d");
      renderRef.current.width = width;
      renderRef.current.height = height;
      renderRef.current.scrollRemainder = 0;
      renderRef.current.lastValue = null;
      renderRef.current.lastDrawnY = null;
      renderRef.current.lastTime = 0;
      renderRef.current.meanCents = 0;
      if (renderRef.current.ctx) {
        renderRef.current.ctx.clearRect(0, 0, width, height);
      }
    }
  };

  const scrollOffscreen = (width, height, dpr, latestCents, centerCents) => {
    const offCtx = renderRef.current.ctx;
    const bufferCtx = renderRef.current.bufferCtx;
    if (!offCtx || !bufferCtx) return;

    const now = performance.now();
    const lastTime = renderRef.current.lastTime || now;
    const delta = now - lastTime;
    renderRef.current.lastTime = now;

    const pixelsPerSecond = width / PITCH_SECONDS;
    renderRef.current.scrollRemainder += (delta / 1000) * pixelsPerSecond;
    const shiftPixels = Math.floor(renderRef.current.scrollRemainder);
    if (shiftPixels > 0) {
      renderRef.current.scrollRemainder -= shiftPixels;
    }

    const midY = height / 2;
    const scaleY = (height / 2) / WAVE_Y_RANGE;
    const mean = Number.isFinite(centerCents) ? centerCents : renderRef.current.meanCents;
    const deltaMean = mean - renderRef.current.meanCents;
    const shiftY = Math.round(-deltaMean * scaleY);
    if (shiftPixels > 0 || shiftY !== 0) {
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(renderRef.current.offscreen, 0, 0);
      offCtx.clearRect(0, 0, width, height);
      offCtx.drawImage(renderRef.current.buffer, -shiftPixels, shiftY);
      // Update stored Y position to account for shift
      if (renderRef.current.lastDrawnY !== null) {
        renderRef.current.lastDrawnY += shiftY;
      }
    }
    renderRef.current.meanCents = mean;
    const value = latestCents;
    if (!Number.isNaN(value)) {
      const centered = value - mean;
      const y = midY - centered * scaleY;
      const lastValue = renderRef.current.lastValue;
      const lastDrawnY = renderRef.current.lastDrawnY;
      const rightX = width - 1;

      offCtx.strokeStyle = "#38bdf8";
      offCtx.lineWidth = 1.6 * dpr;
      offCtx.lineJoin = "round";
      offCtx.lineCap = "round";
      if (shiftPixels > 0) {
        offCtx.beginPath();
        if (lastValue === null || Math.abs(value - lastValue) > 300 || lastDrawnY === null) {
          offCtx.moveTo(rightX, y);
        } else {
          offCtx.moveTo(rightX - shiftPixels, lastDrawnY);
          offCtx.lineTo(rightX, y);
        }
        offCtx.stroke();
        renderRef.current.lastDrawnY = y;
      }
      renderRef.current.lastValue = value;
    } else {
      renderRef.current.lastValue = null;
      renderRef.current.lastDrawnY = null;
    }
  };

  return (
      <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
        <div className="mx-auto flex h-full w-full max-w-[450px] items-stretch px-2 py-2">
          <main className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-800 bg-slate-900">
            <div className="relative min-h-0 flex-1 p-2">
              <canvas ref={canvasRef} className="h-full w-full"/>
              <button
                  type="button"
                  onClick={ui.isRunning ? stopAudio : startAudio}
                  className="absolute left-3 top-3 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 shadow"
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
              <div>Peak: {ui.level.max.toFixed(3)}</div>
              <div>RMS: {ui.level.rms?.toFixed(3) ?? "--"}</div>
              <div>Hz: {ui.lastHz ? ui.lastHz.toFixed(1) : "--"}</div>
              <div>Detector: {detectorLabel}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
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
            </div>
          </main>
        </div>
      </div>
  );
}
