import { PICA_ACCURACY_CENTS, PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { getCorrelation, getPicaPitchAnalysisFromWaveform } from "./picaPitch.js";
import { getCentsDifference } from "./utils.js";

let detachWindowKeyHandler = null;
const CORRELATION_CHART_TICKS_HZ = [
  40, 50, 60, 80, 100, 150, 200, 300, 400, 600, 800, 1000, 1500, 2000,
].filter((hz) => hz >= PICA_MIN_HZ && hz <= PICA_MAX_HZ);
const PITCH_OCTAVE_TICKS = [
  { hz: 65.406, label: "C2" },
  { hz: 130.813, label: "C3" },
  { hz: 261.626, label: "C4" },
  { hz: 523.251, label: "C5" },
  { hz: 1046.502, label: "C6" },
].filter((tick) => tick.hz >= PICA_MIN_HZ && tick.hz <= PICA_MAX_HZ);
const METHOD_VISIBILITY_STORAGE_KEY = "voicebox.picaPitch.methodVisibility";
const PITCH_METHODS = [
  { key: "pitchy", label: "Pitchy" },
  { key: "fft", label: "FFT" },
  { key: "pica", label: "Pica" },
  { key: "carryForward", label: "Pica + Carry" },
];
const DEFAULT_FOLD_PERIOD = 100;
const TERRAIN_STOPS = [
  [0.2, 0.2, 0.6],
  [0.0, 0.6, 1.0],
  [0.2, 0.8, 0.4],
  [0.8, 0.8, 0.3],
  [0.6, 0.45, 0.3],
  [0.95, 0.95, 0.95],
];

function getDefaultMethodVisibility() {
  return {
    pitchy: true,
    fft: true,
    pica: true,
    carryForward: true,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTerrainColorAt(fraction) {
  const clampedFraction = clamp(fraction, 0, 1);
  const scaled = clampedFraction * (TERRAIN_STOPS.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(TERRAIN_STOPS.length - 1, leftIndex + 1);
  const mix = scaled - leftIndex;
  const left = TERRAIN_STOPS[leftIndex];
  const right = TERRAIN_STOPS[rightIndex];
  const red = Math.round((left[0] + (right[0] - left[0]) * mix) * 255);
  const green = Math.round((left[1] + (right[1] - left[1]) * mix) * 255);
  const blue = Math.round((left[2] + (right[2] - left[2]) * mix) * 255);
  return `rgb(${red}, ${green}, ${blue})`;
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

function getPitchOctaveAnnotations() {
  const minLogHz = Math.log10(PICA_MIN_HZ);
  const maxLogHz = Math.log10(PICA_MAX_HZ);
  return PITCH_OCTAVE_TICKS.map((tick) => ({
    xref: "paper",
    yref: "paper",
    x: 1.02,
    y: 0.24 + (0.76 * (Math.log10(tick.hz) - minLogHz)) / (maxLogHz - minLogHz),
    text: tick.label,
    showarrow: false,
    xanchor: "left",
    yanchor: "middle",
    font: { color: "#94a3b8", size: 11 },
  }));
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
  return `Waveform ending at sample=${waveformWindow.endSample}, I=${waveformWindow.windowIndex} (${waveformWindow.durationMs.toFixed(1)} ms window)`;
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

function getPeriodMarkers(waveformWindow, analysis) {
  const selectedPeriodSize =
    analysis?.winningCandidate?.periodSize ??
    (waveformWindow.carryForwardPitchHz > 0
      ? Math.round(waveformWindow.sampleRate / waveformWindow.carryForwardPitchHz)
      : waveformWindow.picaPitchHz > 0
        ? Math.round(waveformWindow.sampleRate / waveformWindow.picaPitchHz)
        : 0);
  if (!(selectedPeriodSize > 0)) return [];
  const markers = [];
  for (
    let sampleIndex = waveformWindow.samples.length;
    sampleIndex >= 0;
    sampleIndex -= selectedPeriodSize
  ) {
    markers.push({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: sampleIndex,
      x1: sampleIndex,
      y0: 0,
      y1: 1,
      line: { color: "rgba(255, 255, 255, 0.225)", width: 1, dash: "dot" },
    });
  }
  return markers;
}

function getWinningPeriodBox(waveformWindow, analysis) {
  if (!(analysis.winningCandidate?.periodSize > 0)) return [];
  return [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: waveformWindow.samples.length - analysis.winningCandidate.periodSize,
      x1: waveformWindow.samples.length,
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
      x.push(extremum.index);
      y.push(waveformWindow.samples[extremum.index]);
      color.push(winningPointPair.includes(extremum.index) ? "#f87171" : "#f59e0b");
      symbol.push(extremum.type === "trough" ? "triangle-down" : "circle");
    }
  }
  return { x, y, color, symbol };
}

function getDefaultFoldColorPeriod(sampleRate, actualPitchHz) {
  if (!Number.isFinite(actualPitchHz) || !(actualPitchHz > 0)) {
    return DEFAULT_FOLD_PERIOD;
  }
  return Math.max(1, Math.round(sampleRate / actualPitchHz));
}

function getTerrainColorForPeriodPosition(position, periodSize) {
  if (!(periodSize > 0)) {
    return "rgba(74, 222, 128, 0.5)";
  }
  return getTerrainColorAt(position / periodSize);
}

function getFoldMarkerColors(fullFolds, colorPeriod) {
  return fullFolds.map((fold) =>
    getTerrainColorForPeriodPosition(fold.extremaIndex % colorPeriod, colorPeriod),
  );
}

async function renderFoldChart(plotly, analysis, colorPeriod) {
  const fullFolds = window.picaDebug.foldAnalyses[window.windowIndex]?.fullFolds ?? [];

  await plotly.newPlot(
    "foldChart",
    [
      {
        x: fullFolds.map((fold) => fold.width),
        y: fullFolds.map((fold) => fold.extremaAmplitude),
        type: "scatter",
        mode: "lines",
        line: { color: "rgba(255, 255, 255, 0.28)", width: 1.5 },
        hoverinfo: "skip",
        showlegend: false,
      },
      {
        x: fullFolds.map((fold) => fold.width),
        y: fullFolds.map((fold) => fold.extremaAmplitude),
        customdata: fullFolds.map((fold) => [
          fold.extremaPosition,
          fold.type,
          fold.foldIndex,
          fold.extremaIndex,
          fold.extremaIndex % colorPeriod,
        ]),
        type: "scatter",
        mode: "markers",
        marker: { color: getFoldMarkerColors(fullFolds, colorPeriod), size: 16, opacity: 0.8 },
        hovertemplate:
          "Width=%{x}<br>Extremum=%{y:.4f}<br>Offset=%{customdata[0]}<br>Type=%{customdata[1]}<br>Index=%{customdata[3]}<br>mod=%{customdata[4]}<extra></extra>",
        showlegend: false,
      },
    ],
    {
      title: "Fold width vs extremum",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 52, r: 24, t: 54, b: 76 },
      xaxis: {
        title: "Fold width (samples)",
        gridcolor: "#1f2937",
        rangemode: "tozero",
        range: [0, null],
      },
      yaxis: {
        title: "Extremum value",
        gridcolor: "#1f2937",
      },
      annotations:
        fullFolds.length === 0
          ? [
              {
                x: 0.5,
                y: 0.5,
                xref: "paper",
                yref: "paper",
                text: "No fold extrema for this window.",
                showarrow: false,
                font: { color: "#94a3b8", size: 14 },
              },
            ]
          : [],
    },
    { responsive: true },
  );
}

async function renderHistogram(
  plotly,
  waveformWindow,
  correlationSeries,
  analysis,
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
  const candidateShapes = (analysis?.candidates ?? [])
    .filter((candidate) => Number.isFinite(candidate?.hz))
    .map((candidate) => ({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: candidate.hz,
      x1: candidate.hz,
      y0: 0,
      y1: 1,
      line: {
        color: "rgba(255, 255, 255, 0.5)",
        width: 1,
        dash: "dot",
      },
      layer: "below",
    }));

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
        showgrid: false,
        type: "log",
        range: [Math.log10(correlationSeries.minHz), Math.log10(correlationSeries.maxHz)],
        tickmode: "array",
        tickvals: CORRELATION_CHART_TICKS_HZ,
        ticktext: CORRELATION_CHART_TICKS_HZ.map(String),
      },
      yaxis: { title: "corr", gridcolor: "#1f2937", range: [-1, 1.05] },
      annotations: [],
      shapes: candidateShapes,
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
  const pitchChartTimeData = result.timeSec.map((timeSec) => [timeSec]);
  const actualTraceIndex = 0;

  pitchChartSeries.push({
    x: pitchChartWindowIndex,
    y: actualPitchHz,
    mode: "lines+markers",
    customdata: pitchChartTimeData,
    line: { width: 1.5, color: "rgba(74, 222, 128, 0.8)" },
    marker: { size: 6, color: "rgba(74, 222, 128, 0.5)" },
    hovertemplate: "I=%{x}<br>t=%{customdata[0]:.3f}s<br>Actual=%{y:.2f} Hz<extra></extra>",
    name: "Actual",
  });

  if (methodVisibility.pitchy) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pitchyPitchHz,
      mode: "lines",
      customdata: pitchChartTimeData,
      line: { width: 1.5, color: "rgba(255, 255, 255, 0.95)" },
      connectgaps: false,
      hovertemplate: "I=%{x}<br>t=%{customdata[0]:.3f}s<br>Pitchy=%{y:.2f} Hz<extra></extra>",
      name: "Pitchy",
    });
  }
  if (methodVisibility.fft) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pitchHz,
      mode: "lines",
      customdata: pitchChartTimeData,
      line: { width: 3, color: "rgba(74, 222, 128, 0.6)", dash: "dash" },
      connectgaps: false,
      hovertemplate: "I=%{x}<br>t=%{customdata[0]:.3f}s<br>FFT=%{y:.2f} Hz<extra></extra>",
      name: "Voicebox FFT",
    });
  }
  if (methodVisibility.carryForward) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.carryForwardPitchHz,
      mode: "lines",
      customdata: pitchChartTimeData,
      line: { width: 1.25, color: "rgba(251, 146, 60, 0.95)" },
      connectgaps: false,
      hovertemplate: "I=%{x}<br>t=%{customdata[0]:.3f}s<br>Carry=%{y:.2f} Hz<extra></extra>",
      name: "Carry",
    });
  }
  if (methodVisibility.pica) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.picaPitchHz,
      mode: "lines",
      customdata: pitchChartTimeData,
      line: { width: 1, color: "rgba(96, 165, 250, 0.95)", dash: "dot" },
      connectgaps: false,
      hovertemplate: "I=%{x}<br>t=%{customdata[0]:.3f}s<br>Pica=%{y:.2f} Hz<extra></extra>",
      name: "PICA",
    });
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.picaFoldCount,
      mode: "lines",
      customdata: pitchChartTimeData,
      line: { width: 1.25, color: "rgba(96, 165, 250, 0.45)" },
      connectgaps: false,
      hovertemplate: "I=%{x}<br>t=%{customdata[0]:.3f}s<br>Pica fold count=%{y}<extra></extra>",
      name: "Pica fold count",
      yaxis: "y2",
    });
  }

  const foldCountMax = Math.max(
    2,
    ...(result.picaFoldCount ?? [])
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.ceil(value)),
  );

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
      margin: { l: 52, r: 80, t: 48, b: 76 },
      xaxis: {
        title: "Window index",
        showgrid: false,
        range: [0, Math.max(1, result.timeSec.length - 1)],
      },
      yaxis: {
        title: "Pitch (Hz)",
        gridcolor: "#1f2937",
        type: "log",
        domain: [0.24, 1],
        range: [Math.log10(PICA_MIN_HZ), Math.log10(PICA_MAX_HZ)],
        tickmode: "array",
        tickvals: PITCH_OCTAVE_TICKS.map((tick) => tick.hz),
        ticktext: PITCH_OCTAVE_TICKS.map((tick) => String(Math.round(tick.hz))),
      },
      yaxis2: {
        title: "Fold count",
        gridcolor: "#1f2937",
        domain: [0, 0.16],
        range: [0, foldCountMax],
      },
      annotations: getPitchOctaveAnnotations(),
    },
    { responsive: true },
  );

  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  let activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex));
  const foldPeriodInput = document.getElementById("foldPeriodInput");

  function getResolvedFoldColorPeriod(waveformWindow) {
    const defaultPeriod = getDefaultFoldColorPeriod(
      waveformWindow.sampleRate,
      getResolvedActualPitchHz(activeWindowIndex),
    );
    if (foldPeriodInput) {
      foldPeriodInput.value = String(defaultPeriod);
    }
    return defaultPeriod;
  }

  function getFoldColorPeriodFromInput() {
    const value = Number(foldPeriodInput?.value);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_FOLD_PERIOD;
  }

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
      ? getPicaCorrelationSeries(waveformWindow.samples, waveformWindow.sampleRate, result.settings)
      : null;
    const extremaMarkers = analysis
      ? getExtremaMarkers(waveformWindow, analysis)
      : { x: [], y: [], color: [], symbol: [] };
    const defaultFoldColorPeriod = getResolvedFoldColorPeriod(waveformWindow);

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
          x0: activeWindowIndex,
          x1: activeWindowIndex,
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
          x: Array.from({ length: waveformWindow.samples.length }, (_, index) => index),
          y: Array.from(waveformWindow.samples),
          mode: "lines",
          line: { width: 1.75, color: "rgba(74, 222, 128, 0.95)" },
          hovertemplate: "Index=%{x}<br>Amp=%{y:.4f}<extra></extra>",
          name: "Samples",
        },
        {
          x: extremaMarkers.x,
          y: extremaMarkers.y,
          mode: "markers",
          marker: { size: 9, color: extremaMarkers.color, symbol: extremaMarkers.symbol },
          hovertemplate: "Extremum<br>Index=%{x}<br>Amp=%{y:.4f}<extra></extra>",
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
          title: "Local sample index",
          showgrid: false,
          range: [0, waveformWindow.samples.length],
        },
        yaxis: {
          title: "Amplitude",
          showgrid: false,
          range: getAmplitudeRange(waveformWindow.samples),
        },
        shapes: [
          ...getWinningPeriodBox(waveformWindow, analysis ?? {}),
          ...(needsPicaAnalysis ? getPeriodMarkers(waveformWindow, analysis) : []),
        ],
      },
      { responsive: true },
    );

    await renderFoldChart(plotly, analysis, defaultFoldColorPeriod);

    if (correlationSeries) {
      await renderHistogram(
        plotly,
        waveformWindow,
        correlationSeries,
        analysis,
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
                  x: [pitchChartWindowIndex],
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

  if (foldPeriodInput) {
    foldPeriodInput.oninput = () => {
      const waveformWindow = getWaveformWindow(activeWindowIndex);
      const needsPicaAnalysis = methodVisibility.pica || methodVisibility.carryForward;
      const analysis = needsPicaAnalysis
        ? getPicaPitchAnalysisFromWaveform(
            waveformWindow.samples,
            waveformWindow.sampleRate,
            result.settings,
          )
        : null;
      void renderFoldChart(plotly, analysis, getFoldColorPeriodFromInput());
    };
  }

  const pitchChartElement = document.getElementById("pitchChart");
  function getWindowIndexFromPoint(point) {
    return Number.isFinite(point?.x) ? Math.round(point.x) : null;
  }

  pitchChartElement.removeAllListeners?.("plotly_click");

  pitchChartElement.on("plotly_click", async (event) => {
    const point = event.points?.[0];
    const windowIndex = getWindowIndexFromPoint(point);
    if (!Number.isInteger(windowIndex)) return;
    await selectWindow(windowIndex);
  });

  if (detachWindowKeyHandler) {
    detachWindowKeyHandler();
    detachWindowKeyHandler = null;
  }

  function findNextPicaErrorWindowIndex(startWindowIndex, direction) {
    for (
      let windowIndex = startWindowIndex + direction;
      windowIndex >= 0 && windowIndex <= maxWindowIndex;
      windowIndex += direction
    ) {
      const actualHz = getResolvedActualPitchHz(windowIndex);
      if (!Number.isFinite(actualHz)) continue;

      const picaHz = result.picaPitchHz[windowIndex];
      if (getCentsDifference(picaHz, actualHz) > PICA_ACCURACY_CENTS) {
        return windowIndex;
      }
    }
    return startWindowIndex;
  }

  const keydownHandler = (event) => {
    if (event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    const isMoveKey = key === "a" || key === "d";
    const isLabelKey = key === "q" || key === "w" || key === "e" || key === "s";
    const isErrorJumpKey = key === "z" || key === "c";
    const canJumpToErrors = hasActuals && methodVisibility.pica;
    if (!isMoveKey && !(hasActuals && isLabelKey) && !(canJumpToErrors && isErrorJumpKey)) {
      return;
    }
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
      : isErrorJumpKey
        ? findNextPicaErrorWindowIndex(activeWindowIndex, key === "z" ? -1 : 1)
        : actualLabelEditor.handleKey(event.key, activeWindowIndex, maxWindowIndex);
    if (hasActuals && isLabelKey) {
      refreshActualSeries();
      onLabelChange?.();
      void plotly.restyle(
        "pitchChart",
        {
          y: [actualPitchHz],
          x: [pitchChartWindowIndex],
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
