import {
  RAW_SAMPLE_WINDOW_CYCLES,
  RAW_SAMPLE_WINDOW_DURATION_SEC,
  RAW_SAMPLE_WINDOW_SAMPLES_AT_48K,
} from "./windowing.js";
import { buildRawCorrelationHistogram } from "./analysis.js";

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
  const extrema = waveformWindow.rawDebug?.extrema ?? waveformWindow.rawDebug?.peaks ?? [];
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
  const originalPeriodSamples = waveformWindow.rawDebug?.winningOriginalPeriodSamples;
  const winningPeriodSamples = waveformWindow.rawDebug?.winningPeriodSamples;
  const variant = waveformWindow.rawDebug?.winningVariant ?? "original";
  if (!(winningPeriodSamples > 0) || !(waveformWindow.endTimeSec > waveformWindow.timeSec[0])) {
    return [];
  }
  const originalWidthSec =
    originalPeriodSamples > 0 ? originalPeriodSamples / waveformWindow.sampleRate : Number.NaN;
  const winningWidthSec = winningPeriodSamples / waveformWindow.sampleRate;
  const periodEndSec = waveformWindow.endTimeSec;

  if (variant === "half") {
    const periodStartSec = periodEndSec - 2 * winningWidthSec;
    const midpointSec = periodEndSec - winningWidthSec;
    return [
      {
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: periodStartSec,
        x1: midpointSec,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(255, 255, 255, 0.2)",
        line: { width: 0 },
        layer: "below",
      },
      {
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: midpointSec,
        x1: periodEndSec,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(248, 113, 113, 0.2)",
        line: { width: 0 },
        layer: "below",
      },
    ];
  }

  if (variant === "double") {
    const periodStartSec = periodEndSec - winningWidthSec;
    const splitSec = Number.isFinite(originalWidthSec)
      ? periodEndSec - originalWidthSec
      : periodStartSec + winningWidthSec / 2;
    return [
      {
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: periodStartSec,
        x1: splitSec,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(96, 165, 250, 0.2)",
        line: { width: 0 },
        layer: "below",
      },
      {
        type: "rect",
        xref: "x",
        yref: "paper",
        x0: splitSec,
        x1: periodEndSec,
        y0: 0,
        y1: 1,
        fillcolor: "rgba(255, 255, 255, 0.2)",
        line: { width: 0 },
        layer: "below",
      },
    ];
  }

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

function formatCandidateValue(correlation, periodSamples, sampleRate) {
  if (!Number.isFinite(correlation) || !Number.isFinite(periodSamples) || !(sampleRate > 0)) {
    return "n/a";
  }
  return `${(sampleRate / periodSamples).toFixed(1)} Hz | ${toLogCorrelation(correlation).toFixed(3)}`;
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
    (a, b) =>
      waveformWindow.sampleRate / a.originalPeriodSamples -
      waveformWindow.sampleRate / b.originalPeriodSamples,
  );
  return sortedFamilies.map((family, index) => ({
    column: index + 1,
    type: family.type,
    pointPair: family.pointPair,
    sourcePeriodSamples: family.sourcePeriodSamples,
    originalPeriodSamples: family.originalPeriodSamples,
    half: {
      enabled: Number.isFinite(family.half?.correlation),
      hz:
        Number.isFinite(family.half?.periodSamples) && waveformWindow.sampleRate > 0
          ? waveformWindow.sampleRate / family.half.periodSamples
          : Number.NaN,
      logCorr: toLogCorrelation(family.half?.correlation),
      periodSamples: family.half?.periodSamples,
    },
    original: {
      enabled: Number.isFinite(family.original?.correlation),
      hz:
        Number.isFinite(family.original?.periodSamples) && waveformWindow.sampleRate > 0
          ? waveformWindow.sampleRate / family.original.periodSamples
          : Number.NaN,
      logCorr: toLogCorrelation(family.original?.correlation),
      periodSamples: family.original?.periodSamples,
    },
    double: {
      enabled: family.allowDouble && Number.isFinite(family.double?.correlation),
      hz:
        Number.isFinite(family.double?.periodSamples) && waveformWindow.sampleRate > 0
          ? waveformWindow.sampleRate / family.double.periodSamples
          : Number.NaN,
      logCorr: toLogCorrelation(family.double?.correlation),
      periodSamples: family.double?.periodSamples,
    },
  }));
}

function logSelectedWindowDebug(waveformWindow) {
  console.log("rawSamplePitch:selectedWindow", {
    windowIndex: waveformWindow.windowIndex,
    endTimeSec: waveformWindow.endTimeSec,
    fftPitchHz: waveformWindow.fftPitchHz,
    displayedPitchHz: waveformWindow.pitchHz,
    rawMaxLogCorrelation: waveformWindow.result?.rawMaxLogCorrelation?.[waveformWindow.windowIndex],
    winningVariant: waveformWindow.rawDebug?.winningVariant,
    winningPeriodSamples: waveformWindow.rawDebug?.winningPeriodSamples,
    winningOriginalPeriodSamples: waveformWindow.rawDebug?.winningOriginalPeriodSamples,
    winningPointPair: waveformWindow.rawDebug?.winningPointPair,
    candidatePeriods: waveformWindow.rawDebug?.candidatePeriods,
    table: buildCandidateTableDebugRows(waveformWindow),
  });
}

function renderCandidateTable(waveformWindow) {
  const panel = document.getElementById("candidatePanel");
  if (!panel) return;
  const families = waveformWindow.rawDebug?.candidateFamilies ?? [];
  const peakCount = Math.max(2, Math.floor(waveformWindow.rawDebug?.peakCount ?? 2));
  const familyColumnCount = Math.max(0, (peakCount - 1) * 2);
  if (familyColumnCount === 0) {
    panel.innerHTML = "";
    return;
  }
  const fftPitchHz = waveformWindow.fftPitchHz;
  let closestCandidateKey = null;
  let closestCandidateDistance = Number.POSITIVE_INFINITY;
  families.forEach((family, familyIndex) => {
    for (const key of ["half", "original", "double"]) {
      const candidate = family[key];
      const isEnabled = key !== "double" || family.allowDouble;
      const candidateHz =
        isEnabled && Number.isFinite(candidate?.periodSamples) && waveformWindow.sampleRate > 0
          ? waveformWindow.sampleRate / candidate.periodSamples
          : Number.NaN;
      const distance = centsDifference(candidateHz, fftPitchHz);
      if (distance < closestCandidateDistance) {
        closestCandidateDistance = distance;
        closestCandidateKey = `${familyIndex}:${key}`;
      }
    }
  });
  const sortedFamilies = [...families].sort(
    (a, b) =>
      waveformWindow.sampleRate / a.originalPeriodSamples -
      waveformWindow.sampleRate / b.originalPeriodSamples,
  );
  const paddedFamilies = Array.from(
    { length: familyColumnCount },
    (_, index) => sortedFamilies[index] ?? null,
  );
  const headerCells = paddedFamilies
    .map((family, index) => {
      if (!family) return `<th>${index + 1}</th>`;
      return `<th>${index + 1}. ${family.type}</th>`;
    })
    .join("");
  const rows = [
    {
      label: "Candidate",
      render: (family) =>
        family
          ? `${(waveformWindow.sampleRate / family.originalPeriodSamples).toFixed(1)} Hz | ${family.originalPeriodSamples} smp`
          : "",
    },
    { label: "Half", key: "half" },
    { label: "Base", key: "original" },
    { label: "Double", key: "double" },
  ]
    .map((row) => {
      const cells = paddedFamilies
        .map((family) => {
          if (!family) return `<td class="candidate-value candidate-empty"></td>`;
          if (!row.key) return `<td class="candidate-meta">${row.render(family)}</td>`;

          const selectedVariant =
            waveformWindow.rawDebug?.winningPointPair?.[0] === family.pointPair?.[0] &&
            waveformWindow.rawDebug?.winningPointPair?.[1] === family.pointPair?.[1]
              ? waveformWindow.rawDebug?.winningVariant
              : null;
          const candidate = family[row.key];
          const isEnabled = row.key !== "double" || family.allowDouble;
          const className =
            !isEnabled || !Number.isFinite(candidate?.correlation)
              ? "candidate-value candidate-empty"
              : `candidate-value${selectedVariant === row.key ? " candidate-selected" : ""}`;
          const style =
            !isEnabled || !Number.isFinite(candidate?.correlation)
              ? ""
              : getHeatmapStyle(candidate.correlation);
          const originalFamilyIndex = families.indexOf(family);
          const closestClass =
            closestCandidateKey === `${originalFamilyIndex}:${row.key}` ? " font-weight: 700;" : "";
          return `<td class="${className}" style="${style}${closestClass}">${formatCandidateValue(
            isEnabled ? candidate?.correlation : Number.NaN,
            candidate?.periodSamples,
            waveformWindow.sampleRate,
          )}</td>`;
        })
        .join("");
      return `<tr><th>${row.label}</th>${cells}</tr>`;
    })
    .join("");
  panel.innerHTML = `
    <table class="candidate-table">
      <thead>
        <tr>
          <th>Row</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderCorrelationHistogram(plotly, waveformWindow) {
  const histogram = buildRawCorrelationHistogram(
    waveformWindow.samples,
    waveformWindow.sampleRate,
    waveformWindow.rawDebug?.maxComparisonPatches,
  );
  const logCorrelation = histogram.correlation.map(toLogCorrelation);
  const fftPitchHz = waveformWindow.fftPitchHz;
  const fftPitchRoundedHz = Number.isFinite(fftPitchHz) ? Math.round(fftPitchHz) : null;
  const fftPitchIndex =
    Number.isInteger(fftPitchRoundedHz) &&
    fftPitchRoundedHz >= histogram.minHz &&
    fftPitchRoundedHz <= histogram.maxHz
      ? fftPitchRoundedHz - histogram.minHz
      : -1;
  await plotly.newPlot(
    "harmonicChart",
    [
      Number.isFinite(fftPitchHz)
        ? {
            x: [fftPitchHz, fftPitchHz],
            y: [0, Math.max(...logCorrelation, 0)],
            mode: "lines",
            line: { color: "rgba(255, 255, 255, 0.95)", width: 1.5, dash: "dot" },
            hoverinfo: "skip",
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
        y: result.autocorrelationPitchHz,
        mode: "lines",
        line: { width: 2, color: "rgba(74, 222, 128, 0.7)", dash: "dot" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Auto=%{y:.2f} Hz<extra></extra>",
        name: "Autocorrelation",
      },
      {
        x: result.timeSec,
        y: result.rawMaxLogCorrelation,
        mode: "lines",
        line: { width: 2, color: "rgba(250, 204, 21, 0.7)", dash: "dot" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Max logCorr=%{y:.3f}<extra></extra>",
        name: "Raw Max logCorr",
        yaxis: "y2",
      },
      {
        x: result.timeSec,
        y: result.pitchHz,
        mode: "lines",
        line: { width: 3, color: "rgba(56, 189, 248, 0.7)", dash: "dash" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Pitch=%{y:.2f} Hz<extra></extra>",
        name: "Voicebox FFT",
      },
      {
        x: result.timeSec,
        y: result.rawPitchHz,
        mode: "lines",
        line: { width: 2.5, color: "rgba(248, 113, 113, 0.7)", dash: "dot" },
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
      yaxis2: {
        title: "Max logCorr",
        overlaying: "y",
        side: "right",
        rangemode: "tozero",
        showgrid: false,
      },
    },
    { responsive: true },
  );

  async function renderWaveformChart(windowIndex) {
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
    logSelectedWindowDebug({ ...waveformWindow, result });
    await renderCorrelationHistogram(plotly, waveformWindow);
  }

  function updateSelectedWindowMarker(windowIndex) {
    const hz = getSelectedPitch(result, windowIndex);
    const x = Number.isFinite(hz) ? [[result.timeSec[windowIndex]]] : [[]];
    const y = Number.isFinite(hz) ? [[hz]] : [[]];
    plotly.restyle("pitchChart", { x, y }, [4]);
  }

  function updateSelectedHzTitle(windowIndex) {
    plotly.relayout("pitchChart", {
      title: `Pitch Timeline (selected: ${formatSelectedPitch(getSelectedPitch(result, windowIndex))})`,
    });
  }

  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  let activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex));

  async function selectWindow(windowIndex) {
    activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
    updateSelectedWindowMarker(activeWindowIndex);
    updateSelectedHzTitle(activeWindowIndex);
    await renderWaveformChart(activeWindowIndex);
    if (typeof onWindowSelect === "function") {
      onWindowSelect(activeWindowIndex);
    }
  }

  await selectWindow(activeWindowIndex);

  const pitchChartElement = document.getElementById("pitchChart");
  pitchChartElement.on("plotly_click", async (event) => {
    const pointIndex = event.points?.[0]?.pointIndex;
    if (!Number.isInteger(pointIndex)) return;
    await selectWindow(pointIndex);
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
      void selectWindow(activeWindowIndex - 1);
      return;
    }
    void selectWindow(activeWindowIndex + 1);
  };
  window.addEventListener("keydown", keydownHandler);
  detachWindowKeyHandler = () => {
    window.removeEventListener("keydown", keydownHandler);
  };
}
