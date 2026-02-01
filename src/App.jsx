import {useEffect, useRef, useState} from "react";
import {PitchDetector} from "pitchy";
import {YIN} from "pitchfinder";
import {
  detectPitchAutocorr,
  drawGrid,
  drawSemitoneLabels,
  lerp,
} from "./tools.js";

const FFT_SIZE = 2048;
const SAMPLE_RATE = 48000; // Assumed; actual rate set on audio context creation
const DEFAULT_ANALYSIS_FPS = 480;
const ANALYSIS_RATE_OPTIONS = [30, 60, 120, 240, 480];
const PITCH_SECONDS = 5;
const WAVE_Y_RANGE = 300;
const MIN_HZ = 65; // ~C2
const MAX_HZ = 1100; // ~C6
const CENTER_SECONDS = 0.6;
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
    timeData: null,
    sampleRate: 48000,
    analysisFps: DEFAULT_ANALYSIS_FPS,
    centerHz: 220,
    centerCents: 1200 * Math.log2(220),
    lastHz: 0,
    lastCents: 0,
    voiceActive: false,
    levelEma: 0,
    latestCents: Number.NaN,
    latestFiltered: false,
    pendingSamples: [],
  });
  const animationRef = useRef({
    rafId: 0,
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
    pendingPoint: null,
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
    analysisFps: DEFAULT_ANALYSIS_FPS,
  });

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

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
      const analysisFps = ui.analysisFps;
      const pitchLength = Math.floor(PITCH_SECONDS * analysisFps);
      const hzLength = Math.floor(CENTER_SECONDS * analysisFps);
      const pitchy = PitchDetector.forFloat32Array(FFT_SIZE);
      const yin = YIN({sampleRate, threshold: 0.1});
      const timeData = audioRef.current.timeData?.length === FFT_SIZE
          ? audioRef.current.timeData
          : new Float32Array(FFT_SIZE);

      // Preserve existing buffers and state if available, otherwise create new
      const existingPitchBuffer = audioRef.current.pitchBuffer;
      const existingHzBuffer = audioRef.current.hzBuffer;
      const pitchBuffer = existingPitchBuffer && existingPitchBuffer.length === pitchLength
          ? existingPitchBuffer
          : (() => {
            const buf = new Float32Array(pitchLength);
            buf.fill(Number.NaN);
            return buf;
          })();
      const hzBuffer = existingHzBuffer && existingHzBuffer.length === hzLength
          ? existingHzBuffer
          : (() => {
            const buf = new Float32Array(hzLength);
            buf.fill(Number.NaN);
            return buf;
          })();

      // Preserve existing pitch state for chart continuity
      audioRef.current = {
        context,
        analyser,
        source,
        stream,
        pitchBuffer,
        pitchIndex: audioRef.current.pitchIndex || 0,
        hzBuffer,
        hzIndex: audioRef.current.hzIndex || 0,
        pitchy,
        yin,
        timeData,
        sampleRate,
        analysisFps,
        centerHz: audioRef.current.centerHz || 220,
        centerCents: audioRef.current.centerCents || 1200 * Math.log2(220),
        lastHz: audioRef.current.lastHz || 0,
        lastCents: audioRef.current.lastCents || 0,
        voiceActive: false,
        levelEma: audioRef.current.levelEma || 0,
        latestCents: Number.NaN,
        latestFiltered: false,
        pendingSamples: [],
      };

      setUi((prev) => ({...prev, isRunning: true}));
      animationRef.current.drawAvg = 0;
      animationRef.current.dataAvg = 0;
      animationRef.current.rafId = requestAnimationFrame(renderLoop);
      startAnalysisTimer(analysisFps);
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
    // Only clear audio resources, preserve pitch state for chart continuity
    audioRef.current.context = null;
    audioRef.current.analyser = null;
    audioRef.current.source = null;
    audioRef.current.stream = null;
    audioRef.current.pitchy = null;
    audioRef.current.yin = null;
    audioRef.current.timeData = null;
    audioRef.current.pendingSamples = [];
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
    const result = pullAudioData();
    const dataElapsed = performance.now() - dataStart;
    if (!result) return;
    animationRef.current.dataAvg = lerp(animationRef.current.dataAvg, dataElapsed, 0.2);
    metricsRef.current = {
      level: {max: result.peak, rms: result.rms},
      rawHz: result.hz,
    };
  };

  const pullAudioData = () => {
    const {analyser, pitchBuffer, hzBuffer, pitchy, yin, timeData} = audioRef.current;
    if (!analyser || !pitchBuffer || !hzBuffer || !timeData) return null;
    analyser.getFloatTimeDomainData(timeData);
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i += 1) {
      const value = timeData[i];
      const absValue = Math.abs(value);
      if (absValue > peak) peak = absValue;
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / timeData.length);
    audioRef.current.levelEma = lerp(audioRef.current.levelEma, rms, 0.2);
    let hz = 0;
    if (ui.detector === "pitchy" && pitchy) {
      const [detectedHz, clarity] = pitchy.findPitch(timeData, audioRef.current.sampleRate);
      hz = clarity > 0.7 ? detectedHz : 0;
    } else if (ui.detector === "yin" && yin) {
      hz = yin(timeData) || 0;
    } else {
      hz = detectPitchAutocorr(
          timeData,
          audioRef.current.sampleRate,
          MIN_HZ,
          MAX_HZ
      );
    }
    const inHzRange = hz >= MIN_HZ && hz <= MAX_HZ;
    const hasVoice = inHzRange;
    audioRef.current.voiceActive = Boolean(hasVoice);

    // Always calculate cents if we have a valid Hz reading
    const absCents = inHzRange ? 1200 * Math.log2(hz) : Number.NaN;
    // Track whether this point was filtered (valid pitch but below RMS threshold)
    audioRef.current.latestFiltered = false;
    audioRef.current.latestCents = absCents;
    audioRef.current.pendingSamples.push({
      time: performance.now(),
      cents: absCents,
      filtered: audioRef.current.latestFiltered,
      centerCents: audioRef.current.centerCents,
    });

    if (hasVoice) {
      audioRef.current.lastHz = hz;
      hzBuffer[audioRef.current.hzIndex] = hz;
      audioRef.current.hzIndex = (audioRef.current.hzIndex + 1) % hzBuffer.length;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < hzBuffer.length; i += 1) {
        const value = hzBuffer[i];
        if (Number.isFinite(value) && value > 0) {
          sum += value;
          count += 1;
        }
      }
      const centerHz = count ? sum / count : 0;
      if (centerHz > 0) {
        audioRef.current.centerHz = lerp(audioRef.current.centerHz, centerHz, 0.2);
        audioRef.current.centerCents = 1200 * Math.log2(audioRef.current.centerHz);
      }
    }

    let {pitchIndex} = audioRef.current;
    pitchBuffer[pitchIndex] = absCents;
    pitchIndex = (pitchIndex + 1) % pitchBuffer.length;
    audioRef.current.pitchIndex = pitchIndex;
    if (hasVoice) {
      audioRef.current.lastCents = absCents;
    }

    return {
      peak,
      rms: audioRef.current.levelEma,
      hz,
    };
  };

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const {centerCents} = audioRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;

    const {clientWidth, clientHeight} = canvas;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(clientWidth * dpr));
    const height = Math.max(1, Math.floor(clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ensureOffscreen(width, height);
    const now = performance.now();
    const samples = audioRef.current.pendingSamples || [];
    audioRef.current.pendingSamples = [];
    scrollOffscreen(width, height, dpr, centerCents, samples, now);

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    ctx.lineWidth = 1 * dpr;
    drawGrid(ctx, width, height, dpr, WAVE_Y_RANGE);
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
      renderRef.current.pendingPoint = null;
      if (renderRef.current.ctx) {
        renderRef.current.ctx.imageSmoothingEnabled = false;
        renderRef.current.ctx.clearRect(0, 0, width, height);
      }
      if (renderRef.current.bufferCtx) {
        renderRef.current.bufferCtx.imageSmoothingEnabled = false;
      }
    }
  };

  const scrollOffscreen = (width, height, dpr, centerCents, samples = [], now) => {
    const offCtx = renderRef.current.ctx;
    const bufferCtx = renderRef.current.bufferCtx;
    if (!offCtx || !bufferCtx) return;

    const pixelsPerSecond = width / PITCH_SECONDS;
    const midY = height / 2;
    const scaleY = (height / 2) / WAVE_Y_RANGE;

    const applyScroll = (deltaMs, targetMean) => {
      if (!deltaMs) return;
      const mean = Number.isFinite(targetMean) ? targetMean : renderRef.current.meanCents;
      const deltaMean = mean - renderRef.current.meanCents;
      const shiftY = Math.round(deltaMean * scaleY);
      const pixelsToShift = (deltaMs / 1000) * pixelsPerSecond + renderRef.current.scrollRemainder;
      const shiftPixels = Math.floor(pixelsToShift);
      renderRef.current.scrollRemainder = pixelsToShift - shiftPixels;
      if (shiftPixels === 0 && shiftY === 0) return;
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(renderRef.current.offscreen, 0, 0);
      offCtx.clearRect(0, 0, width, height);
      offCtx.drawImage(renderRef.current.buffer, -shiftPixels, shiftY);
      if (renderRef.current.lastDrawnY !== null) {
        renderRef.current.lastDrawnY += shiftY;
      }
      renderRef.current.meanCents = mean;
      return shiftPixels;
    };

    const lastTime = renderRef.current.lastTime || now;
    if (samples.length === 0) {
      applyScroll(now - lastTime, centerCents);
      renderRef.current.lastTime = now;
      return;
    }

    let pendingPoint = renderRef.current.pendingPoint;
    for (const sample of samples) {
      const sampleTime = sample.time || now;
      const deltaMs = sampleTime - (renderRef.current.lastTime || sampleTime);
      renderRef.current.lastTime = sampleTime;
      const shiftPixels = applyScroll(deltaMs, sample.centerCents ?? centerCents);
      if (!shiftPixels) {
        pendingPoint = sample;
        continue;
      }
      const point = pendingPoint || sample;
      pendingPoint = null;
      const value = point.cents;
      if (Number.isNaN(value)) {
        renderRef.current.lastValue = null;
        renderRef.current.lastDrawnY = null;
        continue;
      }
      const centered = value - renderRef.current.meanCents;
      const y = midY - centered * scaleY;
      const lastValue = renderRef.current.lastValue;
      const lastDrawnY = renderRef.current.lastDrawnY;
      const rightX = width - 1;

      const lineColor = point.filtered ? "#f97316" : "#38bdf8";
      offCtx.strokeStyle = lineColor;
      offCtx.lineWidth = 1.6 * dpr;
      offCtx.lineJoin = "round";
      offCtx.lineCap = "round";
      offCtx.beginPath();
      if (lastValue === null || Math.abs(value - lastValue) > 300 || lastDrawnY === null) {
        offCtx.moveTo(rightX, y);
      } else {
        const back = Math.max(1, shiftPixels || 1);
        offCtx.moveTo(rightX - back, lastDrawnY);
        offCtx.lineTo(rightX, y);
      }
      offCtx.stroke();

      renderRef.current.lastDrawnY = y;
      renderRef.current.lastValue = value;
    }

    renderRef.current.pendingPoint = pendingPoint;

    const finalDelta = now - renderRef.current.lastTime;
    if (finalDelta > 0) {
      applyScroll(finalDelta, centerCents);
      renderRef.current.lastTime = now;
    }
  };

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

  const applyAnalysisRate = (analysisFps) => {
    const {sampleRate, pitchBuffer, hzBuffer} = audioRef.current;
    const pitchLength = Math.floor(PITCH_SECONDS * analysisFps);
    const hzLength = Math.floor(CENTER_SECONDS * analysisFps);
    audioRef.current.pitchBuffer = pitchBuffer?.length === pitchLength
        ? pitchBuffer
        : (() => {
          const buf = new Float32Array(pitchLength);
          buf.fill(Number.NaN);
          return buf;
        })();
    audioRef.current.hzBuffer = hzBuffer?.length === hzLength
        ? hzBuffer
        : (() => {
          const buf = new Float32Array(hzLength);
          buf.fill(Number.NaN);
          return buf;
        })();
    audioRef.current.pitchIndex = 0;
    audioRef.current.hzIndex = 0;
    audioRef.current.sampleRate = sampleRate || audioRef.current.sampleRate;
    audioRef.current.pendingSamples = [];
    renderRef.current.lastTime = 0;
    renderRef.current.scrollRemainder = 0;
    renderRef.current.pendingPoint = null;
    if (ui.isRunning) {
      startAnalysisTimer(analysisFps);
    }
  };

  const handleAnalysisRateChange = (analysisFps) => {
    const safeFps = Math.max(5, Math.min(480, Number(analysisFps) || DEFAULT_ANALYSIS_FPS));
    setUi((prev) => ({...prev, analysisFps: safeFps}));
    applyAnalysisRate(safeFps);
  };

  return (
      <div className="h-[100dvh] w-full overflow-hidden bg-slate-950 text-slate-100">
        <div className="mx-auto flex h-full w-full max-w-[450px] items-stretch px-2 py-2">
          <main className="relative flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-800 bg-slate-900">
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
              <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1 rounded-full bg-slate-900/70 px-2 py-1 text-[10px] text-slate-200">
                <span className="uppercase tracking-wide text-slate-400">Analysis</span>
                {ANALYSIS_RATE_OPTIONS.map((fps) => (
                    <button
                        key={fps}
                        type="button"
                        onClick={() => handleAnalysisRateChange(fps)}
                        className={`rounded-full border px-2 py-0.5 ${
                            ui.analysisFps === fps
                                ? "border-slate-200 bg-slate-100 text-slate-900"
                                : "border-slate-700 text-slate-200"
                        }`}
                    >
                      {fps}
                    </button>
                ))}
                <input
                    type="number"
                    min="5"
                    max="480"
                    step="1"
                    value={ui.analysisFps}
                    onChange={(event) => handleAnalysisRateChange(event.target.value)}
                    className="w-14 rounded-md border border-slate-700 bg-slate-950/80 px-1 py-0.5 text-[10px] text-slate-100"
                    aria-label="Analysis FPS"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-4 py-2 text-xs text-slate-300">
              <div>Data: {ui.timings.data.toFixed(2)} ms</div>
              <div>Draw: {ui.timings.draw.toFixed(2)} ms</div>
              {/*<div>Peak: {ui.level.max.toFixed(3)}</div>*/}
              <div>RMS: {ui.level.rms?.toFixed(3) ?? "--"}</div>
              <div>Hz: {ui.rawHz ? ui.rawHz.toFixed(1) : "0"}</div>
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
