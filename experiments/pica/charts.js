import { PICA_ACCURACY_CENTS, PICA_MAX_HZ, PICA_MIN_HZ } from "./config.js";
import { getCorrelation, getPicaPitchAnalysisFromWaveform } from "./picaPitch.js";
import { getPica2PitchAnalysisFromWaveform } from "./pica2Pitch.js";
import { getPipsPitchHzFromWaveform } from "./pipsPitch.js";
import { getPiscCorrelationSeriesFromWaveform, getPiscPitchHzFromWaveform } from "./piscPitch.js";
import { getPizaPitchAnalysisFromWaveform } from "./pizaPitch.js";
import {
  getCurrentMethodDefinition,
  normalizeSelectedMethods,
  PICA_METHOD_REGISTRY,
} from "./methodRegistry.js";
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
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CORRELATION_HEATMAP_MIN_OCTAVE =
  Math.floor((69 + 12 * Math.log2(PICA_MIN_HZ / 440)) / 12) - 1;
const CORRELATION_HEATMAP_MAX_OCTAVE =
  Math.floor((69 + 12 * Math.log2(PICA_MAX_HZ / 440)) / 12) - 1;
const CORRELATION_HEATMAP_OCTAVES = Array.from(
  { length: CORRELATION_HEATMAP_MAX_OCTAVE - CORRELATION_HEATMAP_MIN_OCTAVE + 1 },
  (_, index) => CORRELATION_HEATMAP_MIN_OCTAVE + index,
);
const SELECTED_METHODS_STORAGE_KEY = "vb.exp.selectedMethods";

export function readStoredSelectedMethods() {
  const stored = localStorage.getItem(SELECTED_METHODS_STORAGE_KEY);
  return stored ? normalizeSelectedMethods(JSON.parse(stored)) : normalizeSelectedMethods();
}

function writeStoredSelectedMethods(selectedMethods) {
  localStorage.setItem(
    SELECTED_METHODS_STORAGE_KEY,
    JSON.stringify(normalizeSelectedMethods(selectedMethods)),
  );
}

function renderSelectedMethodControls(selectedMethods, onChange) {
  const controls = document.getElementById("methodToggleControls");
  if (!controls) return;

  controls.innerHTML = PICA_METHOD_REGISTRY.map(
    (method) => `
      <label class="toolbar-field toolbar-checkbox">
        <input type="checkbox" data-method-key="${method.key}" ${selectedMethods[method.key] ? "checked" : ""} />
        ${method.key}
      </label>
    `,
  ).join("");

  controls.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      const nextSelectedMethods = normalizeSelectedMethods(
        Object.fromEntries(
          PICA_METHOD_REGISTRY.map((method) => [
            method.key,
            controls.querySelector(`[data-method-key="${method.key}"]`)?.checked ?? false,
          ]),
        ),
      );
      writeStoredSelectedMethods(nextSelectedMethods);
      onChange?.(nextSelectedMethods);
    });
  });
}

function getBottomLegend(y = -0.01) {
  return {
    orientation: "h",
    x: 0.5,
    xanchor: "center",
    y,
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

function formatPitchChartTime(timeSec) {
  const minutes = Math.floor(timeSec / 60);
  const seconds = timeSec - minutes * 60;
  return `${minutes}m${seconds.toFixed(3)}s`;
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

function getPicaCorrelationSeries(samples, sampleRate, settings, picaAnalysis) {
  const cache = {
    correlationByPeriodSize: new Map(),
  };
  const hz = [];
  const correlation = [];
  const periodSizes = [];
  const minPeriodSize = Math.max(1, Math.ceil(sampleRate / PICA_MAX_HZ));
  const maxPeriodSize = Math.max(minPeriodSize, Math.floor(sampleRate / PICA_MIN_HZ));

  for (let periodSize = maxPeriodSize; periodSize >= minPeriodSize; periodSize -= 1) {
    periodSizes.push(periodSize);
    hz.push(sampleRate / periodSize);
    correlation.push(getCorrelation(samples, periodSize, settings, cache));
  }

  return {
    minHz: PICA_MIN_HZ,
    maxHz: PICA_MAX_HZ,
    periodSizes,
    hz,
    correlation,
    checkedHz: (picaAnalysis?.candidates ?? []).map((candidate) => candidate.hz),
    checkedCorrelation: (picaAnalysis?.candidates ?? []).map((candidate) => candidate.correlation),
    checkedPeriodSizes: (picaAnalysis?.candidates ?? []).map((candidate) => candidate.periodSize),
    markerHz: picaAnalysis?.winningCandidate?.hz ?? Number.NaN,
    chartLabel: "PICA",
    chartTitle: "Correlation",
    checkedLabel: "Candidates",
  };
}

function getPitchGridPoint(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return {
    noteName: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
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
  return "Waveform";
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

function getPeriodMarkers(waveformWindow, actualPitchHz, analysis) {
  const currentMethod = getCurrentMethodDefinition();
  const currentMethodPitchHz =
    currentMethod && Number.isFinite(waveformWindow[currentMethod.resultKey])
      ? waveformWindow[currentMethod.resultKey]
      : Number.NaN;
  const selectedPeriodSize =
    (actualPitchHz > 0 ? Math.round(waveformWindow.sampleRate / actualPitchHz) : null) ??
    analysis?.winningCandidate?.periodSize ??
    (currentMethodPitchHz > 0
      ? Math.round(waveformWindow.sampleRate / currentMethodPitchHz)
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

function getPizaPeriodBox() {
  const selectedRange = window.pizaDebug.foldAnalyses[window.windowIndex]?.selectedRange;
  if (!(selectedRange?.endIndex > selectedRange?.startIndex)) return [];
  return [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: selectedRange.startIndex,
      x1: selectedRange.endIndex,
      y0: 0,
      y1: 1,
      fillcolor: "rgba(255, 255, 255, 0.2)",
      line: { width: 0 },
      layer: "below",
    },
  ];
}

function getPica2PeriodBox(analysis) {
  const selectedRange = analysis?.selectedRange;
  if (!(selectedRange?.endIndex > selectedRange?.startIndex)) return [];
  return [
    {
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: selectedRange.startIndex,
      x1: selectedRange.endIndex,
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

function getPica3PointMarkers(waveformWindow) {
  const { points, selectedPoint, windowIndex } = window.piraDebug;
  if (!points || windowIndex !== waveformWindow.windowIndex) {
    return {
      x: [],
      y: [],
      text: [],
      color: [],
      symbol: [],
      size: [],
      customdata: [],
      lineColor: [],
      lineWidth: [],
    };
  }

  const x = [];
  const y = [];
  const text = [];
  const color = [];
  const symbol = [];
  const size = [];
  const customdata = [];
  const lineColor = [];
  const lineWidth = [];
  const selectedMatches =
    selectedPoint === null
      ? new Set()
      : new Set(
          [...selectedPoint.leftMatches, ...selectedPoint.rightMatches].map((point) => point.index),
        );

  for (const point of points) {
    x.push(point.index);
    y.push(point.rawAmp);
    text.push(point.name);
    color.push(point.rawAmp >= 0 ? "#f59e0b" : "#60a5fa");
    symbol.push("diamond");
    size.push(
      point.index === selectedPoint?.index ? 16 : selectedMatches.has(point.index) ? 13 : 10,
    );
    customdata.push([point.name, point.leftMatches.length + point.rightMatches.length]);
    lineColor.push(
      point.index === selectedPoint?.index || selectedMatches.has(point.index)
        ? "rgba(255, 255, 255, 0.95)"
        : "rgba(0, 0, 0, 0.25)",
    );
    lineWidth.push(
      point.index === selectedPoint?.index || selectedMatches.has(point.index) ? 3 : 1,
    );
  }

  return { x, y, text, color, symbol, size, customdata, lineColor, lineWidth };
}

function getPiraPointAnnotations(piraPointMarkers) {
  return piraPointMarkers.x.map((x, index) => ({
    x,
    y: piraPointMarkers.y[index],
    text: piraPointMarkers.text[index],
    xref: "x",
    yref: "y",
    showarrow: false,
    yshift: piraPointMarkers.y[index] >= 0 ? 18 : -18,
    font: {
      color: "#ffffff",
      size: 11,
    },
    bgcolor: "rgba(0, 0, 0, 0.8)",
    bordercolor: "#000000",
    borderwidth: 1,
    borderpad: 2,
  }));
}

function getPica3SpanTraces(points, predictionSpans, predictionReason) {
  if (predictionSpans.length === 0) return [];

  const predictedX = [];
  const predictedY = [];
  for (const span of predictionSpans) {
    predictedX.push(span.leftPoint.index, span.rightPoint.index, null);
    predictedY.push(span.leftPoint.rawAmp, span.rightPoint.rawAmp, null);
  }

  return [
    {
      x: predictedX,
      y: predictedY,
      mode: "lines",
      line: {
        width: 2,
        color:
          predictionReason === "isolatedSet:peaks" || predictionReason === "isolatedSet:troughs"
            ? "rgba(14, 165, 233, 0.95)"
            : "rgba(168, 85, 247, 0.95)",
      },
      hoverinfo: "skip",
      name:
        predictionReason === "isolatedSet:peaks" || predictionReason === "isolatedSet:troughs"
          ? "Pira isolated set"
          : "Pira isolated lane",
      showlegend: true,
    },
  ];
}

function getPipsRunTraces(spanMetrics, options = {}) {
  if (!spanMetrics) return [];

  const {
    color = "rgba(239, 68, 68, 0.9)",
    dash = "solid",
    markerSymbol = "circle",
    name = "PIPS runs",
  } = options;

  const traces = [];
  for (let runIndex = 0; runIndex < spanMetrics.runs.length; runIndex += 1) {
    const run = spanMetrics.runs[runIndex];
    if (run.points.length < 2) continue;

    traces.push({
      x: run.points.map((point) => point.index),
      y: run.points.map((point) => point.rawAmp),
      mode: "lines+markers",
      line: {
        width: 2,
        color,
        dash,
      },
      marker: {
        size: 7,
        color,
        symbol: markerSymbol,
        line: { color: "rgba(255, 255, 255, 0.35)", width: 1 },
      },
      hovertemplate: `PIPS run ${runIndex + 1}<br>Span=${spanMetrics.span}<br>Index=%{x}<br>Amp=%{y:.4f}<extra></extra>`,
      name,
      showlegend: runIndex === 0,
    });
  }

  return traces;
}

function getPica3ConeShapes(waveformWindow) {
  const { selectedPoint, windowIndex } = window.piraDebug;
  if (selectedPoint === null || windowIndex !== waveformWindow.windowIndex) {
    return [];
  }

  const drawAmpPerMilli = (window.piraDebug.ampPerMilli * window.piraDebug.maxAbsSample) / 1000;
  const leftDelta = selectedPoint.index;
  const rightDelta = waveformWindow.samples.length - selectedPoint.index;

  return [
    {
      type: "line",
      xref: "x",
      yref: "y",
      x0: selectedPoint.index,
      y0: selectedPoint.rawAmp,
      x1: 0,
      y1: selectedPoint.rawAmp - drawAmpPerMilli * leftDelta,
      line: { color: "rgba(255, 255, 255, 0.65)", width: 2, dash: "dot" },
    },
    {
      type: "line",
      xref: "x",
      yref: "y",
      x0: selectedPoint.index,
      y0: selectedPoint.rawAmp,
      x1: 0,
      y1: selectedPoint.rawAmp + drawAmpPerMilli * leftDelta,
      line: { color: "rgba(255, 255, 255, 0.65)", width: 2, dash: "dot" },
    },
    {
      type: "line",
      xref: "x",
      yref: "y",
      x0: selectedPoint.index,
      y0: selectedPoint.rawAmp,
      x1: waveformWindow.samples.length,
      y1: selectedPoint.rawAmp - drawAmpPerMilli * rightDelta,
      line: { color: "rgba(255, 255, 255, 0.65)", width: 2, dash: "dot" },
    },
    {
      type: "line",
      xref: "x",
      yref: "y",
      x0: selectedPoint.index,
      y0: selectedPoint.rawAmp,
      x1: waveformWindow.samples.length,
      y1: selectedPoint.rawAmp + drawAmpPerMilli * rightDelta,
      line: { color: "rgba(255, 255, 255, 0.65)", width: 2, dash: "dot" },
    },
  ];
}

function getPifsPeriodShapes(waveformWindow) {
  const { selectedRange } = window.pifsDebug;
  const { windowIndex } = window.pifsDebug.global;
  if (windowIndex !== waveformWindow.windowIndex || !selectedRange) {
    return [];
  }

  return [
    {
      type: "line",
      xref: "x",
      yref: "paper",
      x0: selectedRange.startIndex,
      x1: selectedRange.startIndex,
      y0: 0,
      y1: 1,
      line: { color: "rgba(239, 68, 68, 0.5)", width: 2 },
    },
    {
      type: "line",
      xref: "x",
      yref: "paper",
      x0: selectedRange.endIndex,
      x1: selectedRange.endIndex,
      y0: 0,
      y1: 1,
      line: { color: "rgba(239, 68, 68, 0.5)", width: 2 },
    },
  ];
}

function getPifsFoldMarkers(waveformWindow) {
  const { folds } = window.pifsDebug;
  const { windowIndex } = window.pifsDebug.global;
  if (windowIndex !== waveformWindow.windowIndex || !folds) {
    return { x: [], y: [] };
  }

  return {
    x: folds.map((fold) => fold.extremaIndex),
    y: folds.map((fold) => waveformWindow.samples[fold.extremaIndex]),
  };
}

function getPica2FeatureLineTraces(waveformWindow, analysis) {
  const matchedX = [];
  const matchedY = [];
  const unmatchedX = [];
  const unmatchedY = [];

  for (const feature of analysis?.features ?? []) {
    const x = feature.matchedExistingLane ? matchedX : unmatchedX;
    const y = feature.matchedExistingLane ? matchedY : unmatchedY;
    x.push(feature.leftIndex, feature.rightIndex, null);
    y.push(
      waveformWindow.samples[feature.leftIndex],
      waveformWindow.samples[feature.rightIndex],
      null,
    );
  }

  const traces = [];
  if (matchedX.length > 0) {
    traces.push({
      x: matchedX,
      y: matchedY,
      mode: "lines",
      line: { width: 1, color: "rgba(56, 189, 248, 0.75)" },
      hoverinfo: "skip",
      showlegend: false,
    });
  }
  if (unmatchedX.length > 0) {
    traces.push({
      x: unmatchedX,
      y: unmatchedY,
      mode: "lines",
      line: { width: 1, color: "rgba(239, 68, 68, 0.75)" },
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  return traces;
}

function getPica2LaneTraces(waveformWindow, analysis) {
  const traces = [];

  for (let laneIndex = 0; laneIndex < (analysis?.lanes?.length ?? 0); laneIndex += 1) {
    const lane = analysis.lanes[laneIndex];
    if (lane.features.length < 2) continue;
    const leftX = [];
    const leftY = [];
    const rightX = [];
    const rightY = [];

    for (let featureIndex = 1; featureIndex < lane.features.length; featureIndex += 1) {
      const previousFeature = lane.features[featureIndex - 1];
      const feature = lane.features[featureIndex];
      leftX.push(previousFeature.leftIndex, feature.leftIndex, null);
      leftY.push(
        waveformWindow.samples[previousFeature.leftIndex],
        waveformWindow.samples[feature.leftIndex],
        null,
      );
      rightX.push(previousFeature.rightIndex, feature.rightIndex, null);
      rightY.push(
        waveformWindow.samples[previousFeature.rightIndex],
        waveformWindow.samples[feature.rightIndex],
        null,
      );
    }

    traces.push({
      x: leftX,
      y: leftY,
      mode: "lines",
      line: { width: 1, color: "rgba(255, 255, 255, 0.2)" },
      hoverinfo: "skip",
      showlegend: false,
    });
    traces.push({
      x: rightX,
      y: rightY,
      mode: "lines",
      line: { width: 1, color: "rgba(255, 255, 255, 0.2)" },
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  return traces;
}

async function renderFoldChart(plotly) {
  const foldAnalysis = window.pizaDebug.foldAnalyses[window.windowIndex] ?? {};
  const fullFolds = foldAnalysis.fullFolds ?? [];
  const clusterBoxes = foldAnalysis.clusterBoxes ?? [];
  const visitedFoldIndices = new Set(foldAnalysis.visitedFoldIndices ?? []);
  const clusterIndexByFoldIndex = foldAnalysis.clusterIndexByFoldIndex ?? [];
  const selectedClusterIndex = foldAnalysis.selectedClusterIndex ?? -1;
  const foldAlphaByIndex = fullFolds.map((fold, foldIndex) =>
    fullFolds.length <= 1 ? 0.8 : 0.2 + (foldIndex / (fullFolds.length - 1)) * 0.6,
  );

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
        customdata: fullFolds.map((fold, foldIndex) => [
          fullFolds.length - 1 - foldIndex,
          fold.extremaPosition,
          fold.type,
          foldIndex,
          fold.extremaIndex,
        ]),
        type: "scatter",
        mode: "markers",
        marker: {
          color: fullFolds.map((fold, foldIndex) =>
            visitedFoldIndices.has(foldIndex)
              ? `rgba(96, 165, 250, ${foldAlphaByIndex[foldIndex]})`
              : `rgba(255, 255, 255, ${foldAlphaByIndex[foldIndex]})`,
          ),
          size: 16,
          line: {
            color: fullFolds.map((fold, foldIndex) =>
              clusterIndexByFoldIndex[foldIndex] === selectedClusterIndex
                ? `rgba(251, 146, 60, ${foldAlphaByIndex[foldIndex]})`
                : "rgba(0, 0, 0, 0)",
            ),
            width: fullFolds.map((fold, foldIndex) =>
              clusterIndexByFoldIndex[foldIndex] === selectedClusterIndex ? 2 : 0,
            ),
          },
        },
        hovertemplate:
          "Fold=%{customdata[0]}<br>Width=%{x}<br>Extremum=%{y:.4f}<br>Offset=%{customdata[1]}<br>Type=%{customdata[2]}<br>Index=%{customdata[4]}<extra></extra>",
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
      shapes: clusterBoxes.map((clusterBox) => ({
        type: "rect",
        xref: "x",
        yref: "y",
        x0: clusterBox.minWidth,
        x1: clusterBox.maxWidth,
        y0: clusterBox.minExtremaAmplitude,
        y1: clusterBox.maxExtremaAmplitude,
        line: { color: "rgba(255, 255, 255, 0.65)", width: 1, dash: "dot" },
        fillcolor: "rgba(0, 0, 0, 0)",
        layer: "below",
      })),
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

async function renderLaneChart(plotly, analysis) {
  const x = [];
  const y = [];
  const color = [];
  const customdata = [];
  const bestLaneIndex = analysis?.bestLaneIndex ?? -1;
  const laneLabels = [];
  const laneTickVals = [];

  for (let laneRowIndex = 0; laneRowIndex < (analysis?.lanes?.length ?? 0); laneRowIndex += 1) {
    const lane = analysis.lanes[laneRowIndex];
    const laneLabel = `Lane ${lane.laneIndex} (n=${lane.features.length})`;
    laneLabels.push(laneLabel);
    laneTickVals.push(laneRowIndex);
    for (let spacingIndex = 0; spacingIndex < lane.spacings.length; spacingIndex += 1) {
      x.push(
        lane.features[spacingIndex + 1].leftFoldIndex - lane.features[spacingIndex].leftFoldIndex,
      );
      y.push(laneRowIndex + (((spacingIndex * 73 + lane.laneIndex * 31) % 7) - 3) * 0.02);
      color.push(
        lane.laneIndex === bestLaneIndex ? "rgba(251, 146, 60, 0.7)" : "rgba(96, 165, 250, 0.7)",
      );
      customdata.push([
        laneLabel,
        lane.laneIndex,
        lane.features.length,
        spacingIndex,
        lane.meanSpacing,
        lane.spacingVariance,
      ]);
    }
  }

  await plotly.newPlot(
    "laneChart",
    [
      {
        x,
        y,
        customdata,
        type: "scatter",
        mode: "markers",
        marker: {
          size: 36,
          color,
        },
        hovertemplate:
          "Fold count=%{x}<br>%{customdata[0]}<br>Lane=%{customdata[1]}<br>Lane size=%{customdata[2]}<br>Spacing index=%{customdata[3]}<br>Mean=%{customdata[4]:.2f}<br>Variance=%{customdata[5]:.2f}<extra></extra>",
        showlegend: false,
      },
    ],
    {
      title: "Pica2 lane fold counts",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 52, r: 24, t: 54, b: 76 },
      xaxis: {
        title: "Fold count",
        gridcolor: "#1f2937",
        rangemode: "tozero",
        tick0: 0,
        dtick: 2,
      },
      yaxis: {
        title: "Lane",
        tickmode: "array",
        tickvals: laneTickVals,
        ticktext: laneLabels,
        range: [-0.5, Math.max(0.5, laneLabels.length - 0.5)],
        gridcolor: "#1f2937",
      },
      annotations:
        x.length === 0
          ? [
              {
                x: 0.5,
                y: 0.5,
                xref: "paper",
                yref: "paper",
                text: "No Pica2 lane fold-count data for this window.",
                showarrow: false,
                font: { color: "#94a3b8", size: 14 },
              },
            ]
          : [],
    },
    { responsive: true },
  );
}

async function renderDisabledLaneChart(plotly) {
  await plotly.newPlot(
    "laneChart",
    [],
    {
      title: "Pica2 lanes disabled",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 52, r: 24, t: 54, b: 76 },
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          x: 0.5,
          y: 0.5,
          xref: "paper",
          yref: "paper",
          text: "Enable Pica2 to inspect feature endpoints.",
          showarrow: false,
          font: { color: "#94a3b8", size: 14 },
        },
      ],
    },
    { responsive: true },
  );
}

async function renderHistogram(plotly, correlationSeries, actualPitchHz, onActualPitchSelect) {
  const harmonicChartElement = document.getElementById("harmonicChart");
  if (!harmonicChartElement) return;

  harmonicChartElement.removeAllListeners?.("plotly_click");

  const markerHz = correlationSeries.markerHz;
  const markerX = Number.isFinite(markerHz) ? [markerHz] : [];
  const markerY = getNearestCorrelationY(correlationSeries, markerHz);
  const actualPitchShape = Number.isFinite(actualPitchHz)
    ? [
        {
          type: "line",
          xref: "x",
          yref: "paper",
          x0: actualPitchHz,
          x1: actualPitchHz,
          y0: 0,
          y1: 1,
          line: { color: "rgba(74, 222, 128, 0.95)", width: 2, dash: "dash" },
          layer: "below",
        },
      ]
    : [];

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
        hovertemplate: "Hz=%{x}<br>score=%{y:.3f}<extra></extra>",
        name: correlationSeries.chartLabel,
      },
      {
        x: correlationSeries.checkedHz,
        y: correlationSeries.checkedCorrelation,
        mode: "markers",
        marker: { color: "rgba(96, 165, 250, 0.95)", size: 8, symbol: "diamond" },
        hovertemplate: "Checked=%{x:.2f} Hz<br>score=%{y:.3f}<extra></extra>",
        name: correlationSeries.checkedLabel,
      },
      {
        x: markerX,
        y: markerY,
        mode: "markers",
        marker: { color: "rgba(239, 68, 68, 0.95)", size: 10, symbol: "circle" },
        hovertemplate: `${correlationSeries.chartLabel}=%{x:.2f} Hz<br>score=%{y:.3f}<extra></extra>`,
        showlegend: false,
      },
    ],
    {
      title: correlationSeries.chartTitle,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 52, r: 52, t: 54, b: 76 },
      xaxis: {
        showgrid: false,
        type: "log",
        range: [Math.log10(correlationSeries.minHz), Math.log10(correlationSeries.maxHz)],
        tickmode: "array",
        tickvals: CORRELATION_CHART_TICKS_HZ,
        ticktext: CORRELATION_CHART_TICKS_HZ.map(String),
      },
      yaxis: {
        title: "score",
        gridcolor: "#1f2937",
      },
      annotations: [],
      shapes: actualPitchShape,
    },
    { responsive: true },
  );

  harmonicChartElement.on("plotly_click", (event) => {
    const point = event.points?.[0];
    if (!point) return;
    onActualPitchSelect?.(point.x);
  });
}

async function renderCorrelationHeatmap(plotly, correlationSeries, actualPitchHz) {
  const heatmapElement = document.getElementById("correlationHeatmapChart");
  if (!heatmapElement) return;

  const z = CORRELATION_HEATMAP_OCTAVES.map(() => NOTE_NAMES.map(() => null));
  const customdata = CORRELATION_HEATMAP_OCTAVES.map(() => NOTE_NAMES.map(() => null));

  for (let index = 0; index < correlationSeries.hz.length; index += 1) {
    const hz = correlationSeries.hz[index];
    const score = correlationSeries.correlation[index];
    if (!Number.isFinite(hz) || !Number.isFinite(score)) continue;

    const { noteName, octave } = getPitchGridPoint(hz);
    const yIndex = CORRELATION_HEATMAP_OCTAVES.indexOf(octave);
    const xIndex = NOTE_NAMES.indexOf(noteName);
    if (yIndex < 0 || xIndex < 0) continue;
    if (z[yIndex][xIndex] !== null && score <= z[yIndex][xIndex]) continue;

    z[yIndex][xIndex] = score;
    customdata[yIndex][xIndex] = [hz, correlationSeries.periodSizes[index]];
  }

  const candidatePoints = correlationSeries.checkedHz
    .filter((hz) => Number.isFinite(hz))
    .map((hz) => ({
      ...getPitchGridPoint(hz),
      hz,
    }));
  const actualPoint = Number.isFinite(actualPitchHz)
    ? {
        ...getPitchGridPoint(actualPitchHz),
        hz: actualPitchHz,
      }
    : null;

  await plotly.newPlot(
    "correlationHeatmapChart",
    [
      {
        x: NOTE_NAMES,
        y: CORRELATION_HEATMAP_OCTAVES,
        z,
        customdata,
        type: "heatmap",
        colorscale: "Viridis",
        zmin: 0,
        zmax: 1,
        colorbar: {
          title: "score",
          tickfont: { color: "#e2e8f0" },
        },
        hovertemplate:
          "%{x}%{y}<br>Hz=%{customdata[0]:.2f}<br>period=%{customdata[1]}<br>score=%{z:.3f}<extra></extra>",
        name: "Correlation",
      },
      {
        x: candidatePoints.map((point) => point.noteName),
        y: candidatePoints.map((point) => point.octave),
        customdata: candidatePoints.map((point) => [point.hz]),
        type: "scatter",
        mode: "markers",
        marker: {
          color: "rgba(255, 255, 255, 0.95)",
          size: 7,
          line: { color: "rgba(15, 23, 42, 0.8)", width: 1 },
        },
        hovertemplate: "Candidate %{customdata[0]:.2f} Hz<extra></extra>",
        name: correlationSeries.checkedLabel ?? "Candidates",
      },
      {
        x: actualPoint ? [actualPoint.noteName] : [],
        y: actualPoint ? [actualPoint.octave] : [],
        customdata: actualPoint ? [[actualPoint.hz]] : [],
        type: "scatter",
        mode: "markers",
        marker: {
          color: "rgba(74, 222, 128, 0.98)",
          size: 11,
          line: { color: "rgba(15, 23, 42, 0.95)", width: 1.5 },
        },
        hovertemplate: "Actual %{customdata[0]:.2f} Hz<extra></extra>",
        name: "Actual",
      },
    ],
    {
      title: "Correlation Heatmap",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 52, r: 52, t: 54, b: 76 },
      xaxis: {
        title: "note",
        fixedrange: true,
        showgrid: false,
      },
      yaxis: {
        title: "octave",
        fixedrange: true,
        dtick: 1,
        gridcolor: "#1f2937",
      },
      legend: getBottomLegend(),
    },
    { responsive: true },
  );
}

async function renderSlopePeakChart(plotly, correlationSeries) {
  if (!document.getElementById("slopePeakChart")) return;

  const checkedPeriodSizeSet = new Set(correlationSeries.checkedPeriodSizes);
  const baseStartAmplitudes = [];
  const baseDistances = [];
  const baseCustomdata = [];
  const checkedStartAmplitudes = [];
  const checkedDistances = [];
  const checkedCustomdata = [];

  for (let index = 0; index < correlationSeries.periodSizes.length; index += 1) {
    const periodSize = correlationSeries.periodSizes[index];
    const pointData = [
      periodSize,
      correlationSeries.hz[index],
      correlationSeries.correlation[index],
      correlationSeries.walkedPeakPeriodSizes[index],
    ];
    if (checkedPeriodSizeSet.has(periodSize)) {
      checkedStartAmplitudes.push(correlationSeries.correlation[index]);
      checkedDistances.push(correlationSeries.walkedPeakDistances[index]);
      checkedCustomdata.push(pointData);
      continue;
    }

    baseStartAmplitudes.push(correlationSeries.correlation[index]);
    baseDistances.push(correlationSeries.walkedPeakDistances[index]);
    baseCustomdata.push(pointData);
  }

  await plotly.newPlot(
    "slopePeakChart",
    [
      {
        x: baseStartAmplitudes,
        y: baseDistances,
        customdata: baseCustomdata,
        type: "scatter",
        mode: "markers",
        marker: {
          color: "rgba(255, 255, 255, 0.82)",
          size: 6,
        },
        hovertemplate:
          "Period=%{customdata[0]}<br>Hz=%{customdata[1]:.2f}<br>Score=%{customdata[2]:.3f}<br>Peak=%{customdata[3]}<br>Start amplitude=%{x:.3f}<br>Distance=%{y}<extra></extra>",
        name: "All periods",
      },
      {
        x: checkedStartAmplitudes,
        y: checkedDistances,
        customdata: checkedCustomdata,
        type: "scatter",
        mode: "markers",
        marker: {
          color: "rgba(96, 165, 250, 0.95)",
          size: 9,
          symbol: "diamond",
        },
        hovertemplate:
          "Checked period=%{customdata[0]}<br>Hz=%{customdata[1]:.2f}<br>Score=%{customdata[2]:.3f}<br>Peak=%{customdata[3]}<br>Start amplitude=%{x:.3f}<br>Distance=%{y}<extra></extra>",
        name: "Checked",
      },
    ],
    {
      title: "PISC start amplitude vs walked peak distance",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 60, r: 24, t: 54, b: 76 },
      xaxis: {
        title: "Start amplitude",
        gridcolor: "#1f2937",
        zerolinecolor: "#475569",
        range: [0, 1],
      },
      yaxis: {
        title: "Distance to peak (samples)",
        gridcolor: "#1f2937",
        range: [0, 50],
      },
      legend: {
        orientation: "h",
      },
    },
    { responsive: true },
  );
}

async function renderDisabledHistogram(plotly) {
  if (!document.getElementById("harmonicChart")) return;

  await plotly.newPlot(
    "harmonicChart",
    [],
    {
      title: "Correlation",
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
          text: "Enable PICA or PISC to inspect correlation details.",
          showarrow: false,
          font: { color: "#94a3b8", size: 14 },
        },
      ],
    },
    { responsive: true },
  );
}

async function renderDisabledCorrelationHeatmap(plotly) {
  if (!document.getElementById("correlationHeatmapChart")) return;

  await plotly.newPlot(
    "correlationHeatmapChart",
    [],
    {
      title: "Correlation Heatmap",
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
          text: "Enable PICA or PISC to inspect pitch-class correlation.",
          showarrow: false,
          font: { color: "#94a3b8", size: 14 },
        },
      ],
    },
    { responsive: true },
  );
}

async function renderDisabledSlopePeakChart(plotly) {
  if (!document.getElementById("slopePeakChart")) return;

  await plotly.newPlot(
    "slopePeakChart",
    [],
    {
      title: "PISC slope chart disabled",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      margin: { l: 60, r: 24, t: 54, b: 76 },
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          x: 0.5,
          y: 0.5,
          xref: "paper",
          yref: "paper",
          text: "Enable PISC to inspect slope vs peak distance.",
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
  selectedMethods,
  currentMethod,
) {
  return Number.isInteger(activeWindowIndex)
    ? `Pitch Timelines (i=${activeWindowIndex})`
    : "Pitch Timelines";
}

export async function renderPicaPitchCharts(result, options = {}) {
  const plotly = globalThis.Plotly;
  const {
    selectedWindowIndex = 0,
    settings,
    getWaveformWindow,
    currentMethod = getCurrentMethodDefinition(),
    actualLabelEditor,
    onLabelChange,
    onSelectWindow,
    onWindowSelect,
    onSelectedMethodsChange,
  } = options;
  const selectedMethods = readStoredSelectedMethods();
  const normalizedSelectedMethods = normalizeSelectedMethods(selectedMethods);
  const priorPitchChartVisibilityByName = getTraceVisibilityByName("pitchChart");
  const actualPitchHz = [];
  const hasActuals = Array.isArray(result.actualPitchHz);

  renderSelectedMethodControls(normalizedSelectedMethods, onSelectedMethodsChange);

  function getResolvedActualPitchHz(windowIndex) {
    if (!hasActuals) return undefined;
    return result.actualPitchHz?.[windowIndex];
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
  const getPitchChartCustomData = (pitchHz) =>
    result.timeSec.map((timeSec, index) => [
      formatPitchChartTime(timeSec),
      Number.isFinite(pitchHz[index]) && pitchHz[index] > 0
        ? result.sampleRate / pitchHz[index]
        : Number.NaN,
    ]);
  const actualTraceIndex = 0;

  pitchChartSeries.push({
    x: pitchChartWindowIndex,
    y: actualPitchHz,
    mode: "lines+markers",
    customdata: getPitchChartCustomData(actualPitchHz),
    line: { width: 1.5, color: "rgba(255, 255, 255, 0.55)" },
    marker: { size: 6, color: "rgba(255, 255, 255, 0.35)" },
    hovertemplate:
      "I=%{x}<br>t=%{customdata[0]}<br>Actual=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
    name: "Actual",
  });

  if (normalizedSelectedMethods.PITCHY) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pitchyPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.pitchyPitchHz),
      line: { width: 1.5, color: "rgba(255, 255, 255, 0.95)" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PITCHY=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PITCHY",
    });
  }
  if (normalizedSelectedMethods.FFT) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.pitchHz),
      line: { width: 3, color: "rgba(74, 222, 128, 0.6)", dash: "dash" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>FFT=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "FFT",
    });
  }
  if (normalizedSelectedMethods.PICACF) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.picaCfPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.picaCfPitchHz),
      line: { width: 1.25, color: "rgba(251, 146, 60, 0.95)" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PICACF=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PICACF",
    });
  }
  if (normalizedSelectedMethods.PICA) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.picaPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.picaPitchHz),
      line: { width: 1, color: "rgba(96, 165, 250, 0.95)", dash: "dot" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PICA=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PICA",
    });
  }
  if (normalizedSelectedMethods.PIZA) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pizaPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.pizaPitchHz),
      line: { width: 1, color: "rgba(248, 113, 113, 0.95)", dash: "dot" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PIZA=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PIZA",
    });
  }
  if (normalizedSelectedMethods.PICA2) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pica2PitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.pica2PitchHz),
      line: { width: 1.5, color: "rgba(244, 114, 182, 0.95)", dash: "dot" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PICA2=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PICA2",
    });
  }
  if (normalizedSelectedMethods.PIRA) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.piraPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.piraPitchHz),
      line: { width: 1.5, color: "rgba(45, 212, 191, 0.95)", dash: "dot" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PIRA=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PIRA",
    });
  }
  if (normalizedSelectedMethods.PIFS) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pifsPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.pifsPitchHz),
      line: { width: 1.75, color: "rgba(239, 68, 68, 0.95)" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PIFS=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PIFS",
    });
  }
  if (normalizedSelectedMethods.PIPS) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pipsPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.pipsPitchHz),
      line: { width: 1.75, color: "rgba(239, 68, 68, 0.95)" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PIPS=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PIPS",
    });
  }
  if (normalizedSelectedMethods.PISC) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.piscPitchHz,
      mode: "lines",
      customdata: getPitchChartCustomData(result.piscPitchHz),
      line: { width: 1.5, color: "rgba(239, 68, 68, 0.95)" },
      connectgaps: false,
      hovertemplate:
        "I=%{x}<br>t=%{customdata[0]}<br>PISC=%{y:.2f} Hz<br>Period=%{customdata[1]:.2f}<extra></extra>",
      name: "PISC",
    });
  }
  if (normalizedSelectedMethods.PIFS) {
    pitchChartSeries.push({
      x: pitchChartWindowIndex,
      y: result.pifsFoldScenario,
      mode: "lines",
      customdata: pitchChartTimeData,
      line: { width: 1.25, color: "rgba(239, 68, 68, 0.45)" },
      connectgaps: false,
      hovertemplate: "I=%{x}<br>t=%{customdata[0]}<br>PIFS scenario=%{y}<extra></extra>",
      name: "PIFS fold scenario",
      yaxis: "y2",
    });
  }

  const foldCountMax = Math.max(
    2,
    ...(result.pifsFoldScenario ?? [])
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
        title: "PIFS scenario",
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
  let currentWaveformWindow = null;
  let currentPicaAnalysis = null;
  let currentPica2Analysis = null;

  async function renderWaveformDetail() {
    if (!currentWaveformWindow) return;

    const waveformWindow = currentWaveformWindow;
    const actualPitchHz = getResolvedActualPitchHz(activeWindowIndex);
    const picaAnalysis = currentPicaAnalysis;
    const pica2Analysis = currentPica2Analysis;
    const pipsPoints = normalizedSelectedMethods.PIPS ? window.pipsDebug.points : [];
    const selectedPipsSpan =
      normalizedSelectedMethods.PIPS && Number.isFinite(window.pipsDebug.selectedSpan)
        ? (window.pipsDebug.combinedSpans.find(
            (spanMetrics) => spanMetrics.span === window.pipsDebug.selectedSpan,
          ) ?? null)
        : null;
    const pipsRunTraces = normalizedSelectedMethods.PIPS
      ? [
          ...(window.pipsDebug.bestSpan
            ? getPipsRunTraces(window.pipsDebug.bestSpan, {
                color: "rgba(239, 68, 68, 0.9)",
                name: "PIPS winning runs",
              })
            : []),
          ...(selectedPipsSpan
            ? getPipsRunTraces(selectedPipsSpan, {
                color: "rgba(59, 130, 246, 0.95)",
                dash: "dot",
                markerSymbol: "diamond",
                name: "PIPS selected runs",
              })
            : []),
        ]
      : [];
    const pifsFoldMarkers = normalizedSelectedMethods.PIFS
      ? getPifsFoldMarkers(waveformWindow)
      : { x: [], y: [] };
    const piraPointMarkers = normalizedSelectedMethods.PIRA
      ? getPica3PointMarkers(waveformWindow)
      : {
          x: [],
          y: [],
          text: [],
          color: [],
          symbol: [],
          size: [],
          customdata: [],
          lineColor: [],
          lineWidth: [],
        };

    await plotly.newPlot(
      "waveformChart",
      [
        ...getPica2LaneTraces(waveformWindow, pica2Analysis),
        ...getPica2FeatureLineTraces(waveformWindow, pica2Analysis),
        ...(normalizedSelectedMethods.PIRA
          ? getPica3SpanTraces(
              window.piraDebug.points,
              window.piraDebug.predictionSpans,
              window.piraDebug.predictionReason,
            )
          : []),
        ...pipsRunTraces,
        {
          x: Array.from({ length: waveformWindow.samples.length }, (_, index) => index),
          y: Array.from(waveformWindow.samples),
          mode: "lines",
          line: { width: 1.5, color: "rgba(255, 255, 255, 0.6)" },
          hovertemplate: "Index=%{x}<br>Amp=%{y:.4f}<extra></extra>",
          name: "Samples",
        },
        {
          x: pipsPoints.map((point) => point.index),
          y: pipsPoints.map((point) => point.rawAmp),
          customdata: pipsPoints.map((point) => [point.type]),
          mode: "markers",
          marker: {
            size: 8,
            color: "rgba(74, 222, 128, 0.9)",
            symbol: "diamond",
            line: { color: "rgba(255, 255, 255, 0.35)", width: 1 },
          },
          hovertemplate: "PIPS %{customdata[0]}<br>Index=%{x}<br>Amp=%{y:.4f}<extra></extra>",
          name: "PIPS extrema",
        },
        {
          x: pifsFoldMarkers.x,
          y: pifsFoldMarkers.y,
          mode: "markers",
          marker: {
            size: 7,
            color: "rgba(96, 165, 250, 0.95)",
            symbol: "circle",
            line: { color: "rgba(255, 255, 255, 0.35)", width: 1 },
          },
          hovertemplate: "Fold extremum<br>Index=%{x}<br>Amp=%{y:.4f}<extra></extra>",
          name: "PIFS folds",
        },
        {
          x: piraPointMarkers.x,
          y: piraPointMarkers.y,
          customdata: piraPointMarkers.customdata,
          mode: "markers",
          marker: {
            size: piraPointMarkers.size,
            color: piraPointMarkers.color,
            symbol: piraPointMarkers.symbol,
            line: {
              color: piraPointMarkers.lineColor,
              width: piraPointMarkers.lineWidth,
            },
          },
          hovertemplate:
            "Pica3 point %{customdata[0]}<br>Index=%{x}<br>Amp=%{y:.4f}<br>Matches=%{customdata[1]}<extra></extra>",
          name: "Pica3 points",
        },
      ],
      {
        title: getWaveformTitle(waveformWindow),
        paper_bgcolor: "#050505",
        plot_bgcolor: "#050505",
        font: { color: "#e2e8f0" },
        legend: {
          orientation: "h",
        },
        xaxis: {
          showgrid: false,
          range: [0, waveformWindow.samples.length],
        },
        yaxis: {
          title: "Amplitude",
          showgrid: false,
          range: getAmplitudeRange(waveformWindow.samples),
        },
        shapes: [
          ...(normalizedSelectedMethods.PIFS ? getPifsPeriodShapes(waveformWindow) : []),
          ...(normalizedSelectedMethods.PIRA ? getPica3ConeShapes(waveformWindow) : []),
          ...getPeriodMarkers(waveformWindow, actualPitchHz, picaAnalysis ?? {}),
        ],
        annotations: normalizedSelectedMethods.PIRA
          ? getPiraPointAnnotations(piraPointMarkers)
          : [],
      },
      { responsive: true },
    );

    const waveformChartElement = document.getElementById("waveformChart");
    waveformChartElement.removeAllListeners?.("plotly_click");
    waveformChartElement.on("plotly_click", async (event) => {
      const point = event.points?.[0];
      const clickedX = point?.x;
      const clickedY = point?.y;
      if (!Number.isFinite(clickedX) || !Number.isFinite(clickedY)) return;
      const amplitudeRange = getAmplitudeRange(waveformWindow.samples);
      const amplitudeSpan = Math.max(0.0001, amplitudeRange[1] - amplitudeRange[0]);
      let clickedPointIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;

      if (!normalizedSelectedMethods.PIRA) return;
      for (const candidate of window.piraDebug.points) {
        const xDistance = (candidate.index - clickedX) / waveformWindow.samples.length;
        const yDistance = (candidate.rawAmp - clickedY) / amplitudeSpan;
        const distance = xDistance * xDistance + yDistance * yDistance;
        if (distance < bestDistance) {
          bestDistance = distance;
          clickedPointIndex = candidate.index;
        }
      }

      if (!Number.isInteger(clickedPointIndex)) return;
      window.piraDebug.selectedPoint =
        window.piraDebug.points.find((point) => point.index === clickedPointIndex) ?? null;
      await selectWindow(activeWindowIndex);
    });
  }

  async function selectWindow(windowIndex) {
    activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
    window.windowIndex = activeWindowIndex;
    const waveformWindow = getWaveformWindow(activeWindowIndex);
    onSelectWindow?.(activeWindowIndex, waveformWindow, normalizedSelectedMethods);
    const needsPicaAnalysis = normalizedSelectedMethods.PICA || normalizedSelectedMethods.PICACF;
    const picaAnalysis = needsPicaAnalysis
      ? getPicaPitchAnalysisFromWaveform(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        )
      : null;
    const pica2Analysis = normalizedSelectedMethods.PICA2
      ? getPica2PitchAnalysisFromWaveform(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        )
      : null;
    if (normalizedSelectedMethods.PIZA) {
      getPizaPitchAnalysisFromWaveform(
        waveformWindow.samples,
        waveformWindow.sampleRate,
        result.settings,
      );
    }
    if (normalizedSelectedMethods.PIPS) {
      getPipsPitchHzFromWaveform(
        waveformWindow.samples,
        waveformWindow.sampleRate,
        result.settings,
      );
      if (
        Number.isFinite(window.pipsDebug.selectedSpan) &&
        !window.pipsDebug.combinedSpans.some(
          (spanMetrics) => spanMetrics.span === window.pipsDebug.selectedSpan,
        )
      ) {
        window.pipsDebug.selectedSpan = Number.NaN;
      }
    } else {
      window.pipsDebug.points = [];
      window.pipsDebug.minRawAmp = Number.NaN;
      window.pipsDebug.maxRawAmp = Number.NaN;
      window.pipsDebug.peakSpans = [];
      window.pipsDebug.troughSpans = [];
      window.pipsDebug.combinedSpans = [];
      window.pipsDebug.bestSpan = null;
      window.pipsDebug.selectedSpan = Number.NaN;
    }
    let correlationSeries = null;
    if (normalizedSelectedMethods.PICA) {
      correlationSeries = getPicaCorrelationSeries(
        waveformWindow.samples,
        waveformWindow.sampleRate,
        result.settings,
        picaAnalysis,
      );
    }
    if (normalizedSelectedMethods.PISC) {
      getPiscPitchHzFromWaveform(
        waveformWindow.samples,
        waveformWindow.sampleRate,
        result.settings,
      );
      if (!correlationSeries) {
        correlationSeries = getPiscCorrelationSeriesFromWaveform(
          waveformWindow.samples,
          waveformWindow.sampleRate,
          result.settings,
        );
      }
    }
    currentWaveformWindow = waveformWindow;
    currentPicaAnalysis = picaAnalysis;
    currentPica2Analysis = pica2Analysis;

    await plotly.relayout("pitchChart", {
      title: getPitchTimelineTitle(
        waveformWindow,
        result,
        activeWindowIndex,
        getResolvedActualPitchHz(activeWindowIndex),
        normalizedSelectedMethods,
        currentMethod,
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

    await renderWaveformDetail();

    if (correlationSeries) {
      await renderHistogram(
        plotly,
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
                  x: [pitchChartWindowIndex],
                },
                [actualTraceIndex],
              );
              void selectWindow(activeWindowIndex);
            }
          : undefined,
      );
      await renderCorrelationHeatmap(
        plotly,
        correlationSeries,
        getResolvedActualPitchHz(activeWindowIndex),
      );
      await renderSlopePeakChart(plotly, correlationSeries);
    } else {
      await renderDisabledHistogram(plotly);
      await renderDisabledCorrelationHeatmap(plotly);
      await renderDisabledSlopePeakChart(plotly);
    }
    if (typeof onWindowSelect === "function") {
      onWindowSelect(activeWindowIndex);
    }
  }

  await selectWindow(activeWindowIndex);

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

  function findNextErrorWindowIndex(startWindowIndex, direction) {
    for (
      let windowIndex = startWindowIndex + direction;
      windowIndex >= 0 && windowIndex <= maxWindowIndex;
      windowIndex += direction
    ) {
      const actualHz = getResolvedActualPitchHz(windowIndex);
      if (!Number.isFinite(actualHz)) continue;

      const currentMethodTrack = result[currentMethod.resultKey];
      const hasCurrentMethodError =
        Array.isArray(currentMethodTrack) &&
        getCentsDifference(currentMethodTrack[windowIndex], actualHz) > PICA_ACCURACY_CENTS;
      if (hasCurrentMethodError) {
        return windowIndex;
      }
    }
    return startWindowIndex;
  }

  const keydownHandler = (event) => {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (
      key === "escape" &&
      (window.piraDebug.selectedPoint || Number.isFinite(window.pipsDebug.selectedSpan))
    ) {
      event.preventDefault();
      window.piraDebug.selectedPoint = null;
      window.pipsDebug.selectedSpan = Number.NaN;
      void selectWindow(activeWindowIndex);
      return;
    }
    const isMoveKey = key === "a" || key === "d";
    const isLabelKey = key === "q" || key === "w" || key === "e" || key === "s";
    const isErrorJumpKey = key === "z" || key === "c";
    const canJumpToErrors =
      hasActuals && Array.isArray(result[currentMethod.resultKey]) && currentMethod.key !== "FFT";
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
        ? findNextErrorWindowIndex(activeWindowIndex, key === "z" ? -1 : 1)
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
