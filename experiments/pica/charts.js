import { PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import {
  getCorrelation,
  getPicaPitchAnalysisFromWaveform,
} from "./picaPitch.js";
import {
  PICA_WINDOW_CYCLES,
  PICA_WINDOW_DURATION_SEC,
  PICA_WINDOW_SAMPLES_AT_48K,
} from "./windowing.js";

let detachWindowKeyHandler = null;
const CORRELATION_CHART_TICKS_HZ = [
  40, 50, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000,
].filter((hz) => hz >= PICA_MIN_HZ && hz <= PICA_MAX_HZ);
const METHOD_VISIBILITY_STORAGE_KEY = "voicebox.picaPitch.methodVisibility";
const PITCH_METHODS = [
  { key: "pitchy", label: "Pitchy" },
  { key: "fft", label: "FFT" },
  { key: "pica", label: "Pica" },
  { key: "carryForward", label: "Pica + Carry" },
];

function getDefaultMethodVisibility() {
  return {
    pitchy: true,
    fft: true,
    pica: true,
    carryForward: true,
  };
}

function getMethodVisibility(methodVisibility) {
  return {
    ...getDefaultMethodVisibility(),
    ...methodVisibility,
  };
}

export function readStoredMethodVisibility() {
  try {
    const stored = localStorage.getItem(METHOD_VISIBILITY_STORAGE_KEY);
    return stored ? getMethodVisibility(JSON.parse(stored)) : getDefaultMethodVisibility();
  } catch {
    return getDefaultMethodVisibility();
  }
}

function writeStoredMethodVisibility(methodVisibility) {
  localStorage.setItem(
    METHOD_VISIBILITY_STORAGE_KEY,
    JSON.stringify(getMethodVisibility(methodVisibility)),
  );
}

function renderMethodVisibilityControls(methodVisibility, onChange) {
  const controls = document.getElementById("methodToggleControls");
  if (!controls) return;

  controls.innerHTML = PITCH_METHODS.map(
    (method) => `
      <label class="toolbar-field toolbar-checkbox">
        <input type="checkbox" data-method-key="${method.key}" ${methodVisibility[method.key] ? "checked" : ""} />
        ${method.label}
      </label>
    `,
  ).join("");

  controls.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      const nextMethodVisibility = getMethodVisibility(
        Object.fromEntries(
          PITCH_METHODS.map((method) => [
            method.key,
            controls.querySelector(`[data-method-key="${method.key}"]`)?.checked ?? false,
          ]),
        ),
      );
      writeStoredMethodVisibility(nextMethodVisibility);
      onChange?.(nextMethodVisibility);
    });
  });
}

function getBottomLegend() {
  return {
    orientation: "h",
    x: 0.5,
    xanchor: "center",
    y: -0.16,
    yanchor: "top",
  };
}

function getTraceVisibilityByName(chartId) {
  const chart = document.getElementById(chartId);
  const data = Array.isArray(chart?.data) ? chart.data : [];
  return new Map(
    data
      .filter((trace) => typeof trace?.name === "string")
      .map((trace) => [trace.name, trace.visible ?? true]),
  );
}

function getHeatmapStyle(value, maxValue = 3) {
  const intensity = Math.max(0, Math.min(1, value / maxValue));
  const alpha = 0.15 + intensity * 0.55;
  return `background: rgba(192, 132, 252, ${alpha.toFixed(3)});`;
}

function getNearestCorrelationY(correlationSeries, hz) {
  if (!Number.isFinite(hz)) return [];

  let bestIndex = 0;
  let bestDistance = Math.abs(correlationSeries.hz[0] - hz);
  for (let index = 1; index < correlationSeries.hz.length; index += 1) {
    const distance = Math.abs(correlationSeries.hz[index] - hz);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return [correlationSeries.correlation[bestIndex]];
}

function getPicaCorrelationSeries(samples, sampleRate, settings) {
  const cache = {
    correlationByPeriodSize: new Map(),
  };
  const hz = [];
  const correlation = [];
  const minPeriodSize = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSize = Math.max(minPeriodSize, Math.floor(sampleRate / PICA_MIN_HZ));

  for (let periodSize = maxPeriodSize; periodSize >= minPeriodSize; periodSize -= 1) {
    hz.push(sampleRate / periodSize);
    correlation.push(getCorrelation(samples, periodSize, settings, cache));
  }

  return {
    minHz: PICA_MIN_HZ,
    maxHz: PICA_MAX_HZ,
    hz,
    correlation,
  };
}

function getSelectedPitchLabel(hz) {
  return Number.isFinite(hz) ? `${hz.toFixed(2)} Hz` : "n/a";
}

function getActualPitchLabel(label) {
  if (label === null) return "null";
  if (Number.isFinite(label)) return `${label.toFixed(2)} Hz`;
  return "n/a";
}

function getWaveformTitle(waveformWindow) {
  const durationMs =
    waveformWindow.durationMs > 0 ? waveformWindow.durationMs : PICA_WINDOW_DURATION_SEC * 1000;
  return `Waveform ending at t=${waveformWindow.endTimeSec.toFixed(3)}s, I=${waveformWindow.windowIndex} (${durationMs.toFixed(1)} ms window)`;
}

function getAmplitudeRange(samples) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (sample < min) min = sample;
    if (sample > max) max = sample;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [-1, 1];
  }
  if (min === max) {
    return [min - 0.05, max + 0.05];
  }
  const padding = Math.max(0.02, (max - min) * 0.1);
  return [min - padding, max + padding];
}

function getPeriodMarkers(waveformWindow) {
  const selectedPitchHz =
    waveformWindow.carryForwardPitchHz > 0
      ? waveformWindow.carryForwardPitchHz
      : waveformWindow.picaPitchHz;
  if (!(selectedPitchHz > 0)) return [];
  const periodSec = 1 / selectedPitchHz;
  const markers = [];
  for (
    let timeSec = waveformWindow.endTimeSec;
    timeSec >= waveformWindow.timeSec[0];
    timeSec -= periodSec
  ) {
    markers.push({
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
  return markers;
}

function getWinningPeriodBox(waveformWindow, analysis) {
  if (!(analysis.winningCandidate?.periodSize > 0)) return [];
  const widthSec = analysis.winningCandidate.periodSize / waveformWindow.sampleRate;
  return [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: waveformWindow.endTimeSec - widthSec,
      x1: waveformWindow.endTimeSec,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(255, 255, 255, 0.2)",
      line: { width: 0 },
      layer: "below",
    },
  ];
}

function getExtremaMarkers(waveformWindow, analysis) {
  const x = [];
  const y = [];
  const color = [];
  const symbol = [];
  const winningPointPair = analysis.winningCandidate?.pointPair ?? [];
  for (const extrema of [analysis.foldExtrema.peaks, analysis.foldExtrema.troughs]) {
    for (const extremum of extrema) {
      x.push((waveformWindow.startSample + extremum.index) / waveformWindow.sampleRate);
      y.push(waveformWindow.samples[extremum.index]);
      color.push(winningPointPair.includes(extremum.index) ? "#f87171" : "#f59e0b");
      symbol.push(extremum.type === "trough" ? "triangle-down" : "circle");
    }
  }
  return { x, y, color, symbol };
}

function renderCandidateTable(panel, analysis, fftPitchHz) {
  const candidates = analysis.candidates;
  if (candidates.length === 0) {
    if (analysis.winningCandidate?.type === "carryForward") {
      panel.innerHTML = `<div class="candidate-summary">Carry-forward path won at ${analysis.winningCandidate.hz.toFixed(2)} Hz.</div>`;
      return;
    }
    panel.innerHTML = `<div class="candidate-summary">No candidates. ${analysis.rejectionReason ?? ""}</div>`;
    return;
  }

  let closestKey = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, candidateIndex) => {
    const distance = Math.abs(1200 * Math.log2(candidate.hz / fftPitchHz));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestKey = candidateIndex;
    }
  });

  const renderTypeTable = (type) => {
    const typedCandidates = candidates
      .filter((candidate) => candidate.type === type)
      .sort((left, right) => left.hz - right.hz);
    if (typedCandidates.length === 0) return "";
    const closestCandidate = closestKey === null ? null : candidates[closestKey];

    const header = typedCandidates.map((_, index) => `<th>${index + 1}</th>`).join("");
    const rows = [
      {
        label: "Pre-walk",
        render: (candidate) => `${(48000 / candidate.sourcePeriodSize).toFixed(1)} Hz`,
      },
      {
        label: "Candidate",
        render: (candidate) => `${candidate.hz.toFixed(1)} Hz`,
      },
      {
        label: "Source gap",
        render: (candidate) => `${candidate.sourcePeriodSize} smp`,
      },
      {
        label: "corr",
        render: (candidate) => candidate.correlation.toFixed(3),
      },
      {
        label: "score",
        render: (candidate) => candidate.weightedScore.toFixed(3),
      },
    ]
      .map((row) => {
        const cells = typedCandidates
          .map((candidate) => {
            const selected = analysis.winningCandidate === candidate;
            const bold = closestCandidate === candidate ? " font-weight: 700;" : "";
            const heatmap =
              row.label === "corr"
                ? getHeatmapStyle(candidate.correlation)
                : row.label === "score"
                  ? getHeatmapStyle(candidate.weightedScore)
                  : "";
            return `<td class="candidate-value${selected ? " candidate-selected" : ""}" style="${heatmap}${bold}">${row.render(
              candidate,
            )}</td>`;
          })
          .join("");
        return `<tr><th>${row.label}</th>${cells}</tr>`;
      })
      .join("");

    return `
      <table class="candidate-table">
        <thead>
          <tr>
            <th>${type}</th>
            ${header}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  };

  const winningText = analysis.winningCandidate
    ? `Winner ${analysis.winningCandidate.hz.toFixed(2)} Hz, corr ${analysis.winningCandidate.correlation.toFixed(3)}`
    : `Rejected: ${analysis.rejectionReason}`;

  panel.innerHTML = `
    <div class="candidate-summary">
      zeroCrossings=${analysis.zeroCrossingCount} | maxAmplitude=${analysis.maxAmplitude.toFixed(3)} | ${winningText}
    </div>
    ${renderTypeTable("peak")}
    ${renderTypeTable("trough")}
  `;
}

async function renderHistogram(
  plotly,
  waveformWindow,
  correlationSeries,
  actualPitchHz,
  onActualPitchSelect,
  methodVisibility,
) {
  const fftPitchHz = waveformWindow.fftPitchHz;
  const picaPitchHz = waveformWindow.picaPitchHz;
  const carryForwardPitchHz = waveformWindow.carryForwardPitchHz;
  const fftMarkerX = methodVisibility.fft && Number.isFinite(fftPitchHz) ? [fftPitchHz] : [];
  const fftMarkerY = getNearestCorrelationY(correlationSeries, fftPitchHz);
  const picaMarkerX = methodVisibility.pica && Number.isFinite(picaPitchHz) ? [picaPitchHz] : [];
  const picaMarkerY = getNearestCorrelationY(correlationSeries, picaPitchHz);
  const carryForwardMarkerX =
    methodVisibility.carryForward && Number.isFinite(carryForwardPitchHz)
      ? [carryForwardPitchHz]
      : [];
  const carryForwardMarkerY = getNearestCorrelationY(correlationSeries, carryForwardPitchHz);
  const actualMarkerX = Number.isFinite(actualPitchHz) ? [actualPitchHz] : [];
  const actualMarkerY = getNearestCorrelationY(correlationSeries, actualPitchHz);

  await plotly.newPlot(
    "harmonicChart",
    [
      {
        x: correlationSeries.hz,
        y: correlationSeries.correlation,
        type: "scatter",
        mode: "lines+markers",
        line: { color: "rgba(255, 255, 255, 0.95)", width: 1.5 },
        marker: { color: "rgba(255, 255, 255, 0.95)", size: 4 },
        hovertemplate: "Hz=%{x}<br>corr=%{y:.3f}<extra></extra>",
        name: "Correlation",
      },
      {
        x: fftMarkerX,
        y: fftMarkerY,
        mode: "markers",
        marker: { color: "rgba(74, 222, 128, 0.95)", size: 12, symbol: "x" },
        hovertemplate: "FFT=%{x:.2f} Hz<br>corr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
      {
        x: picaMarkerX,
        y: picaMarkerY,
        mode: "markers",
        marker: { color: "rgba(96, 165, 250, 0.95)", size: 12, symbol: "cross" },
        hovertemplate: "Pica=%{x:.2f} Hz<br>corr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
      {
        x: carryForwardMarkerX,
        y: carryForwardMarkerY,
        mode: "markers",
        marker: { color: "rgba(251, 146, 60, 0.95)", size: 12, symbol: "x" },
        hovertemplate: "Carry=%{x:.2f} Hz<br>corr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
      {
        x: actualMarkerX,
        y: actualMarkerY,
        mode: "markers",
        marker: { color: "rgba(74, 222, 128, 0.8)", size: 9 },
        hovertemplate: "Actual=%{x:.2f} Hz<br>corr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
    ],
    {
      title: `Correlation by period size (${correlationSeries.minHz}-${correlationSeries.maxHz} Hz)`,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      showlegend: true,
      legend: getBottomLegend(),
      margin: { l: 52, r: 52, t: 54, b: 76 },
      xaxis: {
        title: "Hz",
        gridcolor: "#1f2937",
        type: "log",
        range: [Math.log10(correlationSeries.minHz), Math.log10(correlationSeries.maxHz)],
        tickmode: "array",
        tickvals: CORRELATION_CHART_TICKS_HZ,
        ticktext: CORRELATION_CHART_TICKS_HZ.map(String),
      },
      yaxis: { title: "corr", gridcolor: "#1f2937", range: [-1, 1] },
      annotations: [],
    },
    { responsive: true },
  );

  document.getElementById("harmonicChart").on("plotly_click", (event) => {
    const point = event.points?.[0];
    if (!point) return;
    onActualPitchSelect?.(point.x);
  });
}

async function renderDisabledHistogram(plotly) {
  await plotly.newPlot(
    "harmonicChart",
    [],
    {
      title: "Correlation chart disabled",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 52, r: 52, t: 54, b: 76 },
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          x: 0.5,
          y: 0.5,
          xref: "paper",
          yref: "paper",
          text: "Enable Pica or Pica + Carry to inspect correlation details.",
          showarrow: false,
          font: { color: "#94a3b8", size: 14 },
        },
      ],
    },
    { responsive: true },
  );
}

function getPitchTimelineTitle(
  waveformWindow,
  result,
  activeWindowIndex,
  actualPitchHz,
  methodVisibility,
) {
  const parts = [];
  if (methodVisibility.pica) {
    parts.push(`pica: ${getSelectedPitchLabel(waveformWindow.picaPitchHz)}`);
  }
  if (methodVisibility.pitchy) {
    parts.push(`pitchy: ${getSelectedPitchLabel(result.pitchyPitchHz?.[activeWindowIndex])}`);
  }
  if (methodVisibility.carryForward) {
    parts.push(`carry: ${getSelectedPitchLabel(waveformWindow.carryForwardPitchHz)}`);
  }
  parts.push(`actual: ${getActualPitchLabel(actualPitchHz)}`);
  return `Pitch Timeline (${parts.join(", ")})`;
}

export async function renderPicaPitchCharts(result, options = {}) {
  const plotly = globalThis.Plotly;
  const {
    selectedWindowIndex = 0,
    getWaveformWindow,
    actualLabelEditor,
    onLabelChange,
    onWindowSelect,
    onMethodVisibilityChange,
  } = options;
  const candidatePanel = document.getElementById("candidatePanel");
  const candidatePanelDetails = document.getElementById("candidatePanelDetails");
  const methodVisibility = readStoredMethodVisibility();
  const priorPitchChartVisibilityByName = getTraceVisibilityByName("pitchChart");
  const actualPitchHz = [];
  const hasActuals = Array.isArray(result.actualPitchHz);

  renderMethodVisibilityControls(methodVisibility, onMethodVisibilityChange);

  function getResolvedActualPitchHz(windowIndex) {
    if (!hasActuals) return undefined;
    const label = actualLabelEditor.getLabel(windowIndex);
    return label === undefined ? result.actualPitchHz?.[windowIndex] : label;
  }

  function refreshActualSeries() {
    actualPitchHz.splice(0, actualPitchHz.length);
    for (let index = 0; index < result.timeSec.length; index += 1) {
      const actualHz = getResolvedActualPitchHz(index);
      actualPitchHz.push(actualHz === null ? Number.NaN : actualHz);
    }
  }

  refreshActualSeries();

  const pitchChartSeries = [];
  const pitchChartWindowIndex = result.timeSec.map((_, index) => index);
  const actualTraceIndex = 0;

  pitchChartSeries.push({
    x: result.timeSec,
    y: actualPitchHz,
    mode: "lines+markers",
    customdata: pitchChartWindowIndex,
    line: { width: 1.5, color: "rgba(74, 222, 128, 0.8)" },
    marker: { size: 6, color: "rgba(74, 222, 128, 0.5)" },
    hovertemplate: "t=%{x:.3f}s<br>Actual=%{y:.2f} Hz<extra></extra>",
    name: "Actual",
  });

  if (methodVisibility.pitchy) {
    pitchChartSeries.push({
      x: result.timeSec,
      y: result.pitchyPitchHz,
      mode: "lines",
      customdata: pitchChartWindowIndex,
      line: { width: 1.5, color: "rgba(255, 255, 255, 0.95)" },
      connectgaps: false,
      hovertemplate: "t=%{x:.3f}s<br>Pitchy=%{y:.2f} Hz<extra></extra>",
      name: "Pitchy",
    });
  }
  if (methodVisibility.fft) {
    pitchChartSeries.push({
      x: result.timeSec,
      y: result.pitchHz,
      mode: "lines",
      customdata: pitchChartWindowIndex,
      line: { width: 3, color: "rgba(74, 222, 128, 0.6)", dash: "dash" },
      connectgaps: false,
      hovertemplate: "t=%{x:.3f}s<br>FFT=%{y:.2f} Hz<extra></extra>",
      name: "Voicebox FFT",
    });
  }
  if (methodVisibility.carryForward) {
    pitchChartSeries.push({
      x: result.timeSec,
      y: result.carryForwardPitchHz,
      mode: "lines",
      customdata: pitchChartWindowIndex,
      line: { width: 1.25, color: "rgba(251, 146, 60, 0.95)" },
      connectgaps: false,
      hovertemplate: "t=%{x:.3f}s<br>Carry=%{y:.2f} Hz<extra></extra>",
      name: "Carry",
    });
    pitchChartSeries.push({
      x: result.timeSec,
      y: result.carryForwardCorrelation,
      mode: "lines",
      customdata: pitchChartWindowIndex,
      line: { width: 1.25, color: "rgba(251, 146, 60, 0.5)" },
      connectgaps: false,
      hovertemplate: "t=%{x:.3f}s<br>Carry corr=%{y:.3f}<extra></extra>",
      name: "Carry corr",
      yaxis: "y2",
    });
  }
  if (methodVisibility.pica) {
    pitchChartSeries.push({
      x: result.timeSec,
      y: result.picaPitchHz,
      mode: "lines",
      customdata: pitchChartWindowIndex,
      line: { width: 1, color: "rgba(96, 165, 250, 0.95)", dash: "dot" },
      connectgaps: false,
      hovertemplate: "t=%{x:.3f}s<br>Pica=%{y:.2f} Hz<extra></extra>",
      name: "PICA",
    });
    pitchChartSeries.push({
      x: result.timeSec,
      y: result.picaCorrelation,
      mode: "lines",
      customdata: pitchChartWindowIndex,
      line: { width: 1.25, color: "rgba(96, 165, 250, 0.45)" },
      connectgaps: false,
      hovertemplate: "t=%{x:.3f}s<br>Pica corr=%{y:.3f}<extra></extra>",
      name: "Pica corr",
      yaxis: "y2",
    });
  }

  for (const trace of pitchChartSeries) {
    const priorVisibility = priorPitchChartVisibilityByName.get(trace.name);
    if (priorVisibility !== undefined) {
      trace.visible = priorVisibility;
    }
  }

  await plotly.newPlot(
    "pitchChart",
    pitchChartSeries,
    {
      title: "Pitch Timeline",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      showlegend: true,
      legend: getBottomLegend(),
      uirevision: "pitchChart",
      margin: { l: 52, r: 24, t: 48, b: 76 },
      xaxis: {
        title: "Time (s)",
        gridcolor: "#1f2937",
        range: [result.timeSec[0] ?? 0, result.timeSec[result.timeSec.length - 1] ?? 1],
      },
      yaxis: {
        title: "Pitch (Hz)",
        gridcolor: "#1f2937",
        type: "log",
        domain: [0.24, 1],
        range: [Math.log10(PICA_MIN_HZ), Math.log10(PICA_MAX_HZ)],
      },
      yaxis2: {
        title: "Corr",
        gridcolor: "#1f2937",
        domain: [0, 0.16],
        range: [0, 1],
      },
    },
    { responsive: true },
  );

  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  let activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex));

  async function selectWindow(windowIndex) {
    activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
    window.windowIndex = activeWindowIndex;
    const waveformWindow = getWaveformWindow(activeWindowIndex);
    const needsPicaAnalysis = methodVisibility.pica || methodVisibility.carryForward;
    const analysis = needsPicaAnalysis
      ? getPicaPitchAnalysisFromWaveform(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        )
      : null;
    const correlationSeries = needsPicaAnalysis
      ? getPicaCorrelationSeries(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        )
      : null;
    const extremaMarkers = analysis
      ? getExtremaMarkers(waveformWindow, analysis)
      : { x: [], y: [], color: [], symbol: [] };

    await plotly.relayout("pitchChart", {
      title: getPitchTimelineTitle(
        waveformWindow,
        result,
        activeWindowIndex,
        getResolvedActualPitchHz(activeWindowIndex),
        methodVisibility,
      ),
      shapes: [
        {
          type: "line",
          xref: "x",
          yref: "paper",
          x0: result.timeSec[activeWindowIndex],
          x1: result.timeSec[activeWindowIndex],
          y0: 0,
          y1: 1,
          line: { color: "rgba(255, 255, 255, 0.44)", width: 2 },
          layer: "below",
        },
      ],
    });

    await plotly.newPlot(
      "waveformChart",
      [
        {
          x: waveformWindow.timeSec,
          y: Array.from(waveformWindow.samples),
          mode: "lines",
          line: { width: 1.75, color: "rgba(74, 222, 128, 0.95)" },
          hovertemplate: "t=%{x:.5f}s<br>Amp=%{y:.4f}<extra></extra>",
          name: "Samples",
        },
        {
          x: extremaMarkers.x,
          y: extremaMarkers.y,
          mode: "markers",
          marker: { size: 9, color: extremaMarkers.color, symbol: extremaMarkers.symbol },
          hovertemplate: "Extremum<br>t=%{x:.5f}s<br>Amp=%{y:.4f}<extra></extra>",
          name: "Top extrema",
        },
      ],
      {
        title: getWaveformTitle(waveformWindow),
        paper_bgcolor: "#050505",
        plot_bgcolor: "#050505",
        font: { color: "#e2e8f0" },
        showlegend: true,
        legend: getBottomLegend(),
        margin: { l: 52, r: 24, t: 54, b: 76 },
        xaxis: {
          title: "Time (s)",
          showgrid: false,
          range: [waveformWindow.timeSec[0], waveformWindow.endTimeSec],
        },
        yaxis: {
          title: "Amplitude",
          showgrid: false,
          range: [-1, 1],
        },
        shapes: [
          ...getWinningPeriodBox(waveformWindow, analysis ?? {}),
          ...(needsPicaAnalysis ? getPeriodMarkers(waveformWindow) : []),
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

    candidatePanelDetails.hidden = !methodVisibility.pica;
    if (methodVisibility.pica && analysis) {
      renderCandidateTable(candidatePanel, analysis, waveformWindow.fftPitchHz);
    } else {
      candidatePanel.innerHTML = "";
    }
    if (correlationSeries) {
      await renderHistogram(
        plotly,
        waveformWindow,
        correlationSeries,
        getResolvedActualPitchHz(activeWindowIndex),
        hasActuals
          ? (pitchHz) => {
              actualLabelEditor.setLabel(activeWindowIndex, pitchHz);
              refreshActualSeries();
              onLabelChange?.();
              void plotly.restyle(
                "pitchChart",
                {
                  y: [actualPitchHz],
                  x: [result.timeSec],
                },
                [actualTraceIndex],
              );
              void selectWindow(activeWindowIndex);
            }
          : undefined,
        methodVisibility,
      );
    } else {
      await renderDisabledHistogram(plotly);
    }
    if (typeof onWindowSelect === "function") {
      onWindowSelect(activeWindowIndex);
    }
  }

  await selectWindow(activeWindowIndex);

  document.getElementById("pitchChart").on("plotly_click", async (event) => {
    const point = event.points?.[0];
    const windowIndex = point?.customdata;
    if (!Number.isInteger(windowIndex)) return;
    await selectWindow(windowIndex);
  });

  if (detachWindowKeyHandler) {
    detachWindowKeyHandler();
    detachWindowKeyHandler = null;
  }

  const keydownHandler = (event) => {
    if (event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    const isMoveKey = key === "a" || key === "d";
    const isLabelKey = key === "q" || key === "w" || key === "e" || key === "s";
    if (!isMoveKey && !(hasActuals && isLabelKey)) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return;
    }
    event.preventDefault();
    const nextWindowIndex = isMoveKey
      ? key === "a"
        ? Math.max(0, activeWindowIndex - 1)
        : Math.min(maxWindowIndex, activeWindowIndex + 1)
      : actualLabelEditor.handleKey(event.key, activeWindowIndex, maxWindowIndex);
    if (hasActuals && isLabelKey) {
      refreshActualSeries();
      onLabelChange?.();
      void plotly.restyle(
        "pitchChart",
        {
          y: [actualPitchHz],
          x: [result.timeSec],
        },
        [actualTraceIndex],
      );
    }
    void selectWindow(nextWindowIndex);
  };

  window.addEventListener("keydown", keydownHandler);
  detachWindowKeyHandler = () => {
    window.removeEventListener("keydown", keydownHandler);
  };
}
