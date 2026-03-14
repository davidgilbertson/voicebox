import {
  RAW_SAMPLE_WINDOW_CYCLES,
  RAW_SAMPLE_WINDOW_DURATION_SEC,
  RAW_SAMPLE_WINDOW_SAMPLES_AT_48K,
} from "./windowing.js";
import { buildRawCorrelationHistogram, evaluateRawWindow } from "./analysis.js";

let detachWindowKeyHandler = null;
const MAX_LOG_CORRELATION = 0.999999;

function formatSelectedPitch(hz) {
  return Number.isFinite(hz) ? `${hz.toFixed(2)} Hz` : "n/a";
}

function getSelectedPitch(result, windowIndex) {
  return result.rawPitchHz?.[windowIndex] > 0
    ? result.rawPitchHz[windowIndex]
    : result.pitchHz[windowIndex];
}

function formatWaveformTitle(waveformWindow) {
  const durationMs =
    waveformWindow.durationMs > 0
      ? waveformWindow.durationMs
      : RAW_SAMPLE_WINDOW_DURATION_SEC * 1000;
  return `Raw waveform ending at t=${waveformWindow.endTimeSec.toFixed(3)}s, I=${waveformWindow.windowIndex} (${durationMs.toFixed(1)} ms window, ${RAW_SAMPLE_WINDOW_SAMPLES_AT_48K} samples @ 48k, ${RAW_SAMPLE_WINDOW_CYCLES} cycles at E1)`;
}

function getWaveformAmplitudeRange(samples) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of samples) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [-1, 1];
  }
  if (min === max) {
    const padding = Math.max(0.05, Math.abs(min) * 0.1 || 0.05);
    return [min - padding, max + padding];
  }
  const padding = Math.max(0.02, (max - min) * 0.1);
  return [min - padding, max + padding];
}

function buildPitchPeriodMarkers(waveformWindow) {
  if (!Number.isFinite(waveformWindow.pitchHz) || waveformWindow.pitchHz <= 0) {
    return [];
  }
  const periodSec = 1 / waveformWindow.pitchHz;
  const shapes = [];
  for (
    let timeSec = waveformWindow.endTimeSec;
    timeSec >= waveformWindow.timeSec[0];
    timeSec -= periodSec
  ) {
    shapes.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: timeSec,
      x1: timeSec,
      y0: 0,
      y1: 1,
      line: { color: "rgba(255, 255, 255, 0.225)", width: 1, dash: "dot" },
    });
  }
  return shapes;
}

function buildPeakMarkers(waveformWindow) {
  const extrema = waveformWindow.rawDebug?.foldExtrema ?? [];
  const x = [];
  const y = [];
  const color = [];
  const symbol = [];
  const winningPointPair = waveformWindow.rawDebug?.winningPointPair ?? [];
  for (const point of extrema) {
    if (!Number.isFinite(point?.index)) continue;
    x.push((waveformWindow.startSample + point.index) / waveformWindow.sampleRate);
    y.push(waveformWindow.samples[point.index]);
    color.push(winningPointPair.includes(point.index) ? "#f87171" : "#f59e0b");
    symbol.push(point.type === "trough" ? "triangle-down" : "circle");
  }
  return { x, y, color, symbol };
}

function buildWinningPeriodBox(waveformWindow) {
  const winningPeriodSamples = waveformWindow.rawDebug?.winningPeriodSamples;
  if (!(winningPeriodSamples > 0) || !(waveformWindow.endTimeSec > waveformWindow.timeSec[0])) {
    return [];
  }
  const winningWidthSec = winningPeriodSamples / waveformWindow.sampleRate;
  const periodEndSec = waveformWindow.endTimeSec;
  return [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: periodEndSec - winningWidthSec,
      x1: periodEndSec,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(255, 255, 255, 0.2)",
      line: { width: 0 },
      layer: "below",
    },
  ];
}

function toLogCorrelation(correlation) {
  if (!Number.isFinite(correlation) || correlation <= 0) return 0;
  return -Math.log10(1 - Math.min(correlation, MAX_LOG_CORRELATION));
}

function centsDifference(aHz, bHz) {
  if (!(aHz > 0) || !(bHz > 0)) return Number.POSITIVE_INFINITY;
  return Math.abs(1200 * Math.log2(aHz / bHz));
}

function getHeatmapStyle(correlation) {
  if (!Number.isFinite(correlation) || correlation <= 0) {
    return "background: rgba(15, 23, 42, 0.4);";
  }
  const intensity = Math.min(1, Math.max(0, toLogCorrelation(correlation) / 3));
  const alpha = 0.18 + intensity * 0.6;
  return `background: rgba(192, 132, 252, ${alpha.toFixed(3)});`;
}

function buildCandidateTableDebugRows(waveformWindow) {
  const families = waveformWindow.rawDebug?.candidateFamilies ?? [];
  const sortedFamilies = [...families].sort(
    (a, b) => waveformWindow.sampleRate / a.periodSamples - waveformWindow.sampleRate / b.periodSamples,
  );
  return sortedFamilies.map((family, index) => ({
    column: index + 1,
    type: family.type,
    pointPair: family.pointPair,
    sourcePeriodSamples: family.sourcePeriodSamples,
    periodSamples: family.periodSamples,
    hz:
      Number.isFinite(family.periodSamples) && waveformWindow.sampleRate > 0
        ? waveformWindow.sampleRate / family.periodSamples
        : Number.NaN,
    logCorr: toLogCorrelation(family.correlation),
    weightedScore:
      Number.isFinite(family.periodSamples) &&
      waveformWindow.sampleRate > 0 &&
      Number.isFinite(family.correlation)
        ? toLogCorrelation(family.correlation) +
          (waveformWindow.rawDebug?.octaveBias ?? 0) *
            Math.log2(waveformWindow.sampleRate / family.periodSamples / 40)
        : Number.NaN,
  }));
}

function logSelectedWindowDebug(waveformWindow, freshRawDebug = null) {
  console.log("TEST rawSamplePitch:selectedWindow", {
    windowIndex: waveformWindow.windowIndex,
    endTimeSec: waveformWindow.endTimeSec,
    fftPitchHz: waveformWindow.fftPitchHz,
    displayedPitchHz: waveformWindow.pitchHz,
    rawMaxLogCorrelation: waveformWindow.result?.rawMaxLogCorrelation?.[waveformWindow.windowIndex],
    winningPeriodSamples: waveformWindow.rawDebug?.winningPeriodSamples,
    winningPointPair: waveformWindow.rawDebug?.winningPointPair,
    candidatePeriods: waveformWindow.rawDebug?.candidatePeriods,
    zeroCrossingCount: waveformWindow.rawDebug?.zeroCrossingCount,
    rejectionReason: waveformWindow.rawDebug?.rejectionReason,
    winningWeightedScore: waveformWindow.rawDebug?.winningWeightedScore,
    table: buildCandidateTableDebugRows(waveformWindow),
    freshRawDebug,
  });
}

function renderCandidateTable(waveformWindow) {
  const panel = document.getElementById("candidatePanel");
  if (!panel) return;
  const families = waveformWindow.rawDebug?.candidateFamilies ?? [];
  if (families.length === 0) {
    panel.innerHTML = "";
    return;
  }

  const fftPitchHz = waveformWindow.fftPitchHz;
  let closestCandidateKey = null;
  let closestCandidateDistance = Number.POSITIVE_INFINITY;
  families.forEach((family, familyIndex) => {
    const candidateHz =
      Number.isFinite(family?.periodSamples) && waveformWindow.sampleRate > 0
        ? waveformWindow.sampleRate / family.periodSamples
        : Number.NaN;
    const distance = centsDifference(candidateHz, fftPitchHz);
    if (distance < closestCandidateDistance) {
      closestCandidateDistance = distance;
      closestCandidateKey = `${familyIndex}`;
    }
  });

  const renderFamilyTable = (type) => {
    const sortedFamilies = families
      .filter((family) => family.type === type)
      .sort(
        (a, b) =>
          waveformWindow.sampleRate / a.periodSamples - waveformWindow.sampleRate / b.periodSamples,
      );
    if (sortedFamilies.length === 0) return "";

    const headerCells = sortedFamilies.map((_, index) => `<th>${index + 1}</th>`).join("");
    const rows = [
      {
        label: "Candidate",
        render: (family) =>
          `<td class="candidate-meta">${(waveformWindow.sampleRate / family.periodSamples).toFixed(1)} Hz | ${family.periodSamples} smp</td>`,
      },
      {
        label: "Source gap",
        render: (family) => `<td class="candidate-meta">${family.sourcePeriodSamples} smp</td>`,
      },
      {
        label: "logCorr",
        render: (family, originalFamilyIndex) => {
          const selected =
            waveformWindow.rawDebug?.winningPointPair?.[0] === family.pointPair?.[0] &&
            waveformWindow.rawDebug?.winningPointPair?.[1] === family.pointPair?.[1];
          const className = `candidate-value${selected ? " candidate-selected" : ""}`;
          const style = `${getHeatmapStyle(family.correlation)}${
            closestCandidateKey === `${originalFamilyIndex}` ? " font-weight: 700;" : ""
          }`;
          return `<td class="${className}" style="${style}">${toLogCorrelation(family.correlation).toFixed(3)}</td>`;
        },
      },
      {
        label: "weighted",
        render: (family) => {
          const candidateHz = waveformWindow.sampleRate / family.periodSamples;
          const weightedScore =
            toLogCorrelation(family.correlation) +
            (waveformWindow.rawDebug?.octaveBias ?? 0) * Math.log2(candidateHz / 40);
          return `<td class="candidate-meta">${weightedScore.toFixed(3)}</td>`;
        },
      },
    ]
      .map((row) => {
        const cells = sortedFamilies
          .map((family) => row.render(family, families.indexOf(family)))
          .join("");
        return `<tr><th>${row.label}</th>${cells}</tr>`;
      })
      .join("");

    return `
      <table class="candidate-table">
        <thead>
          <tr>
            <th>${type}</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  };

  panel.innerHTML = `${renderFamilyTable("peak")}${renderFamilyTable("trough")}`;
}

async function renderCorrelationHistogram(plotly, waveformWindow) {
  const histogram = buildRawCorrelationHistogram(
    waveformWindow.samples,
    waveformWindow.sampleRate,
    waveformWindow.rawDebug?.maxComparisonPatches,
  );
  const logCorrelation = histogram.correlation.map(toLogCorrelation);
  const fftPitchHz = waveformWindow.fftPitchHz;
  await plotly.newPlot(
    "harmonicChart",
    [
      Number.isFinite(fftPitchHz)
        ? {
            x: [fftPitchHz],
            y: [Math.max(...logCorrelation, 0)],
            mode: "markers",
            marker: { color: "rgba(248, 113, 113, 0.95)", size: 3 },
            hovertemplate: "FFT=%{x:.2f} Hz<extra></extra>",
            showlegend: false,
          }
        : null,
      {
        x: histogram.hz,
        y: logCorrelation,
        type: "bar",
        marker: { color: "rgba(192, 132, 252, 0.85)" },
        hovertemplate: "Hz=%{x}<br>logCorr=%{y:.3f}<extra></extra>",
        name: "Log correlation",
      },
    ].filter(Boolean),
    {
      title: `Correlation histogram (${histogram.minHz}-${histogram.maxHz} Hz)`,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      showlegend: true,
      margin: { l: 52, r: 24, t: 54, b: 44 },
      xaxis: { title: "Hz", gridcolor: "#1f2937", range: [histogram.minHz, histogram.maxHz] },
      yaxis: { title: "-log10(1 - corr)", gridcolor: "#1f2937" },
      annotations: [],
    },
    { responsive: true },
  );
}

export async function renderRawSamplePitchCharts(result, options = {}) {
  const { selectedWindowIndex = 0, getWaveformWindow, onWindowSelect = null } = options;
  const plotly = globalThis.Plotly;
  if (!plotly) {
    throw new Error("Plotly is not loaded");
  }

  await plotly.newPlot(
    "pitchChart",
    [
      {
        x: result.timeSec,
        y: result.pitchHz,
        mode: "lines",
        line: { width: 3, color: "rgba(56, 189, 248, 0.35)", dash: "dash" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Pitch=%{y:.2f} Hz<extra></extra>",
        name: "Voicebox FFT",
      },
      {
        x: result.timeSec,
        y: result.rawPitchHz,
        mode: "lines",
        line: { width: 1, color: "rgba(248, 113, 113, 0.95)" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Raw=%{y:.2f} Hz<extra></extra>",
        name: "Voicebox Raw",
      },
      {
        x: [],
        y: [],
        mode: "markers",
        marker: { size: 10, color: "#f59e0b" },
        hovertemplate: "Selected<br>t=%{x:.3f}s<br>Pitch=%{y:.2f} Hz<extra></extra>",
        showlegend: false,
        name: "Selected",
      },
    ],
    {
      title: "Pitch Timeline",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      showlegend: true,
      margin: { l: 52, r: 24, t: 48, b: 44 },
      xaxis: { title: "Time (s)", gridcolor: "#1f2937" },
      yaxis: {
        title: "Pitch (Hz)",
        gridcolor: "#1f2937",
        type: "log",
        range: [Math.log10(40), Math.log10(1000)],
      },
    },
    { responsive: true },
  );

  async function renderWaveformChart(windowIndex, shouldLogDebug = false) {
    const waveformWindow = getWaveformWindow(windowIndex);
    const peakMarkers = buildPeakMarkers(waveformWindow);
    const periodMarkers = buildPitchPeriodMarkers(waveformWindow);
    const winningPeriodBox = buildWinningPeriodBox(waveformWindow);
    const yRange = getWaveformAmplitudeRange(waveformWindow.samples);
    await plotly.newPlot(
      "waveformChart",
      [
        {
          x: waveformWindow.timeSec,
          y: Array.from(waveformWindow.samples),
          mode: "lines",
          line: { width: 1.75, color: "rgba(74, 222, 128, 0.95)" },
          hovertemplate: "t=%{x:.5f}s<br>Amp=%{y:.4f}<extra></extra>",
          name: "Raw samples",
        },
        {
          x: peakMarkers.x,
          y: peakMarkers.y,
          mode: "markers",
          marker: { size: 9, color: peakMarkers.color, symbol: peakMarkers.symbol },
          hovertemplate: "Extremum<br>t=%{x:.5f}s<br>Amp=%{y:.4f}<extra></extra>",
          name: "Top extrema",
        },
      ],
      {
        title: formatWaveformTitle(waveformWindow),
        paper_bgcolor: "#050505",
        plot_bgcolor: "#050505",
        font: { color: "#e2e8f0" },
        showlegend: true,
        margin: { l: 52, r: 24, t: 54, b: 44 },
        xaxis: {
          title: "Time (s)",
          showgrid: false,
          range: [waveformWindow.timeSec[0], waveformWindow.endTimeSec],
        },
        yaxis: { title: "Amplitude", showgrid: false, range: yRange },
        shapes: [
          ...winningPeriodBox,
          ...periodMarkers,
          {
            type: "line",
            xref: "x",
            yref: "paper",
            x0: waveformWindow.endTimeSec,
            x1: waveformWindow.endTimeSec,
            y0: 0,
            y1: 1,
            line: { color: "#f59e0b", width: 1.5, dash: "dot" },
          },
        ],
      },
      { responsive: true },
    );
    renderCandidateTable(waveformWindow);
    if (shouldLogDebug) {
      const freshEvaluation = evaluateRawWindow(
        waveformWindow.samples,
        waveformWindow.sampleRate,
        Number.isFinite(waveformWindow.fftPitchHz),
        result.rawSettings,
      );
      logSelectedWindowDebug(
        { ...waveformWindow, result },
        {
          rejectionReason: freshEvaluation.rawResult.debug?.rejectionReason,
          zeroCrossingCount: freshEvaluation.rawResult.debug?.zeroCrossingCount,
          winningLogCorrelation: freshEvaluation.rawResult.debug?.winningLogCorrelation,
          winningWeightedScore: freshEvaluation.rawResult.debug?.winningWeightedScore,
          winningPeriodSamples: freshEvaluation.rawResult.debug?.winningPeriodSamples,
          candidatePeriods: freshEvaluation.rawResult.debug?.candidatePeriods,
          rawPitchHz: freshEvaluation.rawPitchHz,
          autocorrelationPitchHz: freshEvaluation.autocorrelationPitchHz,
          maxAmplitude: freshEvaluation.maxAmplitude,
          histogramLogCorrelation: freshEvaluation.histogramPeak.logCorrelation,
        },
      );
    }
    await renderCorrelationHistogram(plotly, waveformWindow);
  }

  function updateSelectedWindowMarker(windowIndex) {
    const hz = getSelectedPitch(result, windowIndex);
    const x = Number.isFinite(hz) ? [[result.timeSec[windowIndex]]] : [[]];
    const y = Number.isFinite(hz) ? [[hz]] : [[]];
    plotly.restyle("pitchChart", { x, y }, [2]);
  }

  function updateSelectedHzTitle(windowIndex) {
    plotly.relayout("pitchChart", {
      title: `Pitch Timeline (selected: ${formatSelectedPitch(getSelectedPitch(result, windowIndex))})`,
    });
  }

  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  let activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex));

  async function selectWindow(windowIndex, shouldLogDebug = false) {
    activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
    updateSelectedWindowMarker(activeWindowIndex);
    updateSelectedHzTitle(activeWindowIndex);
    await renderWaveformChart(activeWindowIndex, shouldLogDebug);
    if (typeof onWindowSelect === "function") {
      onWindowSelect(activeWindowIndex);
    }
  }

  await selectWindow(activeWindowIndex, false);

  const pitchChartElement = document.getElementById("pitchChart");
  pitchChartElement.on("plotly_click", async (event) => {
    const pointIndex = event.points?.[0]?.pointIndex;
    if (!Number.isInteger(pointIndex)) return;
    await selectWindow(pointIndex, true);
  });

  if (detachWindowKeyHandler) {
    detachWindowKeyHandler();
    detachWindowKeyHandler = null;
  }
  const keydownHandler = (event) => {
    if (event.defaultPrevented) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return;
    }
    event.preventDefault();
    if (event.key === "ArrowLeft") {
      void selectWindow(activeWindowIndex - 1, true);
      return;
    }
    void selectWindow(activeWindowIndex + 1, true);
  };
  window.addEventListener("keydown", keydownHandler);
  detachWindowKeyHandler = () => {
    window.removeEventListener("keydown", keydownHandler);
  };
}
