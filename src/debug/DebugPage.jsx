import { useEffect, useRef, useState } from "react";

const LATENCY_OPTIONS = [
  { value: "unset", label: "Browser default" },
  { value: "0", label: "0 s" },
  { value: "0.02", label: "0.02 s" },
  { value: "0.1", label: "0.1 s" },
  { value: "0.25", label: "0.25 s" },
];
const LEVEL_PUBLISH_INTERVAL_MS = 100;

function roundValue(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function stringifyJson(value) {
  return JSON.stringify(value, null, 2);
}

function readLocalStorageSnapshot() {
  return Object.fromEntries(
    Object.keys(localStorage)
      .sort()
      .map((key) => [key, localStorage.getItem(key)]),
  );
}

function listSupportedConstraints(constraints) {
  return Object.entries(constraints)
    .filter(([, supported]) => supported === true)
    .map(([name]) => name);
}

function readAnalyserFrame(analyser, samples) {
  if (typeof analyser.getFloatTimeDomainData === "function") {
    analyser.getFloatTimeDomainData(samples);
    return samples;
  }
  const bytes = new Uint8Array(samples.length);
  analyser.getByteTimeDomainData(bytes);
  for (let i = 0; i < bytes.length; i += 1) {
    samples[i] = (bytes[i] - 128) / 128;
  }
  return samples;
}

export default function DebugPage() {
  const [localStorageSnapshot] = useState(() => readLocalStorageSnapshot());
  const [supportedConstraints, setSupportedConstraints] = useState({});
  const [autoGainControl, setAutoGainControl] = useState(false);
  const [echoCancellation, setEchoCancellation] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(false);
  const [latency, setLatency] = useState("unset");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [levels, setLevels] = useState({
    frameAbsMax: 0,
    frameRms: 0,
    frameMin: 0,
    frameMax: 0,
  });
  const [maxHold, setMaxHold] = useState({
    frameAbsMax: 0,
    frameRms: 0,
  });
  const [requestedConstraints, setRequestedConstraints] = useState({});
  const [actualConstraints, setActualConstraints] = useState({});
  const [actualSettings, setActualSettings] = useState({});
  const resourcesRef = useRef({
    context: null,
    stream: null,
    analyser: null,
    rafId: 0,
    samples: null,
    batchSampleCount: 0,
    batchSumSquares: 0,
    batchAbsMax: 0,
    batchMin: 0,
    batchMax: 0,
    lastPublishedAt: null,
  });
  const supportedConstraintNames = listSupportedConstraints(supportedConstraints);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Debug Voicebox";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    const root = document.getElementById("root");
    const previous = {
      htmlOverflowY: document.documentElement.style.overflowY,
      bodyOverflowY: document.body.style.overflowY,
      rootOverflow: root?.style.overflow ?? "",
      rootHeight: root?.style.height ?? "",
    };

    document.documentElement.style.overflowY = "auto";
    document.body.style.overflowY = "auto";
    if (root) {
      root.style.overflow = "visible";
      root.style.height = "auto";
    }

    return () => {
      document.documentElement.style.overflowY = previous.htmlOverflowY;
      document.body.style.overflowY = previous.bodyOverflowY;
      if (root) {
        root.style.overflow = previous.rootOverflow;
        root.style.height = previous.rootHeight;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof navigator.mediaDevices?.getSupportedConstraints !== "function") {
      setSupportedConstraints({});
      return;
    }
    setSupportedConstraints(navigator.mediaDevices.getSupportedConstraints());
  }, []);

  const stopCapture = () => {
    const { context, stream, rafId } = resourcesRef.current;
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (context && context.state !== "closed") {
      context.close();
    }
    resourcesRef.current = {
      context: null,
      stream: null,
      analyser: null,
      rafId: 0,
      samples: null,
      batchSampleCount: 0,
      batchSumSquares: 0,
      batchAbsMax: 0,
      batchMin: 0,
      batchMax: 0,
      lastPublishedAt: null,
    };
    setIsRunning(false);
  };

  useEffect(() => stopCapture, []);

  const startCapture = async () => {
    stopCapture();
    setError("");
    const audioConstraints = {
      autoGainControl,
      echoCancellation,
      noiseSuppression,
      ...(latency === "unset" ? {} : { latency: Number(latency) }),
    };
    setRequestedConstraints(audioConstraints);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      const track = stream.getAudioTracks()[0];
      const context = new AudioContext();
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      resourcesRef.current = {
        context,
        stream,
        analyser,
        rafId: 0,
        samples,
        batchSampleCount: 0,
        batchSumSquares: 0,
        batchAbsMax: 0,
        batchMin: 0,
        batchMax: 0,
        lastPublishedAt: null,
      };
      setActualConstraints(track?.getConstraints?.() ?? {});
      setActualSettings(track?.getSettings?.() ?? {});
      setLevels({
        frameAbsMax: 0,
        frameRms: 0,
        frameMin: 0,
        frameMax: 0,
      });
      setIsRunning(true);

      const tick = (timestamp) => {
        const current = resourcesRef.current;
        if (!current.analyser || !current.samples) return;
        const frame = readAnalyserFrame(current.analyser, current.samples);
        let frameAbsMax = 0;
        let frameMin = Number.POSITIVE_INFINITY;
        let frameMax = Number.NEGATIVE_INFINITY;
        let sumSquares = 0;
        for (let i = 0; i < frame.length; i += 1) {
          const sample = frame[i];
          if (sample < frameMin) {
            frameMin = sample;
          }
          if (sample > frameMax) {
            frameMax = sample;
          }
          const magnitude = Math.abs(sample);
          if (magnitude > frameAbsMax) {
            frameAbsMax = magnitude;
          }
          sumSquares += sample * sample;
        }
        current.batchSampleCount += frame.length;
        current.batchSumSquares += sumSquares;
        current.batchAbsMax = Math.max(current.batchAbsMax, frameAbsMax);
        current.batchMin =
          current.batchSampleCount === frame.length
            ? frameMin
            : Math.min(current.batchMin, frameMin);
        current.batchMax =
          current.batchSampleCount === frame.length
            ? frameMax
            : Math.max(current.batchMax, frameMax);

        if (current.lastPublishedAt === null) {
          current.lastPublishedAt = timestamp;
        }

        if (timestamp - current.lastPublishedAt >= LEVEL_PUBLISH_INTERVAL_MS) {
          const frameRms = Math.sqrt(current.batchSumSquares / current.batchSampleCount);
          setLevels({
            frameAbsMax: current.batchAbsMax,
            frameRms,
            frameMin: Number.isFinite(current.batchMin) ? current.batchMin : 0,
            frameMax: Number.isFinite(current.batchMax) ? current.batchMax : 0,
          });
          setMaxHold((currentMaxHold) => ({
            frameAbsMax: Math.max(currentMaxHold.frameAbsMax, current.batchAbsMax),
            frameRms: Math.max(currentMaxHold.frameRms, frameRms),
          }));
          current.batchSampleCount = 0;
          current.batchSumSquares = 0;
          current.batchAbsMax = 0;
          current.batchMin = 0;
          current.batchMax = 0;
          current.lastPublishedAt = timestamp;
        }
        current.rafId = requestAnimationFrame(tick);
      };

      resourcesRef.current.rafId = requestAnimationFrame(tick);
    } catch (nextError) {
      stopCapture();
      setError(nextError?.message || "Microphone access failed.");
    }
  };

  return (
    <main className="h-[var(--app-height)] [touch-action:pan-y] overflow-y-auto bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="space-y-2">
          <p className="text-xs font-semibold tracking-[0.22em] text-sky-400 uppercase">Debug</p>
          <h1 className="text-3xl font-semibold text-white">Microphone Scratch Page</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            This page is isolated from the main app so you can inspect live mic capture and try
            constraint changes without touching the recorder UI.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
            Local Storage
          </div>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
            {stringifyJson(localStorageSnapshot)}
          </pre>
        </section>

        <section className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>autoGainControl</span>
            <input
              type="checkbox"
              checked={autoGainControl}
              onChange={(event) => setAutoGainControl(event.target.checked)}
              className="h-5 w-5 accent-sky-400"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>echoCancellation</span>
            <input
              type="checkbox"
              checked={echoCancellation}
              onChange={(event) => setEchoCancellation(event.target.checked)}
              className="h-5 w-5 accent-sky-400"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>noiseSuppression</span>
            <input
              type="checkbox"
              checked={noiseSuppression}
              onChange={(event) => setNoiseSuppression(event.target.checked)}
              className="h-5 w-5 accent-sky-400"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span>latency</span>
            <select
              value={latency}
              onChange={(event) => setLatency(event.target.value)}
              className="h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-slate-100"
            >
              {LATENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={startCapture}
              className="rounded-xl bg-sky-400 px-4 py-3 text-sm font-semibold text-slate-950"
            >
              {isRunning ? "Restart capture" : "Start capture"}
            </button>
            <button
              type="button"
              onClick={stopCapture}
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200"
            >
              Stop
            </button>
          </div>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
              Raw Frame Levels
            </div>
            <div className="mt-4 grid gap-4">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span>Frame abs max</span>
                  <span data-testid="peak-value">{roundValue(levels.frameAbsMax)}</span>
                </div>
                <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-sky-400"
                    style={{ width: `${Math.max(0, Math.min(100, levels.frameAbsMax * 100))}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                    style={{
                      left: `${Math.max(0, Math.min(100, maxHold.frameAbsMax * 100))}%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span>Frame RMS</span>
                  <span data-testid="rms-value">{roundValue(levels.frameRms)}</span>
                </div>
                <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-emerald-400"
                    style={{ width: `${Math.max(0, Math.min(100, levels.frameRms * 100))}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                    style={{
                      left: `${Math.max(0, Math.min(100, maxHold.frameRms * 100))}%`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 gap-y-2 text-sm text-slate-300">
                <div />
                <div className="text-slate-400">Min</div>
                <div className="text-slate-400">Current</div>
                <div className="text-slate-400">Max</div>
                <div className="text-slate-400">Raw abs</div>
                <div>-</div>
                <div data-testid="raw-current-value">{roundValue(levels.frameAbsMax)}</div>
                <div>{roundValue(maxHold.frameAbsMax)}</div>
                <div className="text-slate-400">RMS</div>
                <div>{roundValue(0)}</div>
                <div data-testid="rms-current-value">{roundValue(levels.frameRms)}</div>
                <div>{roundValue(maxHold.frameRms)}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
              Supported Constraints
            </div>
            <div className="mt-4 rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
              {supportedConstraintNames.length > 0 ? (
                <ul className="space-y-1">
                  {supportedConstraintNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <div>none reported</div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
              Requested Constraints
            </div>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
              {stringifyJson(requestedConstraints)}
            </pre>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
              Track Constraints
            </div>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
              {stringifyJson(actualConstraints)}
            </pre>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="text-xs font-semibold tracking-[0.2em] text-slate-400 uppercase">
            Track Settings
          </div>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-200">
            {stringifyJson(actualSettings)}
          </pre>
        </section>
      </div>
    </main>
  );
}
