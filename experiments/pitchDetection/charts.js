let detachWindowKeyHandler = null;
const POINT_CHART_X_MAX_HZ = 2000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function refinePeakBinWeighted(magnitudes, binIndex) {
  const nyquistBin = magnitudes.length - 1;
  const centerBin = clamp(Math.round(binIndex), 1, nyquistBin - 1);
  const leftBin = centerBin - 1;
  const rightBin = centerBin + 1;
  const leftWeight = Math.max(0, magnitudes[leftBin]);
  const centerWeight = Math.max(0, magnitudes[centerBin]);
  const rightWeight = Math.max(0, magnitudes[rightBin]);
  const totalWeight = leftWeight + centerWeight + rightWeight;
  if (!(totalWeight > 0)) return centerBin;
  return ((leftBin * leftWeight) + (centerBin * centerWeight) + (rightBin * rightWeight)) / totalWeight;
}

function resolveVisiblePartialCount(f0Bin, binSizeHz, nyquistBin, maxPositions, xMaxHz) {
  if (!Number.isFinite(f0Bin) || !(f0Bin > 0)) return 0;
  const nyquistLimit = Math.floor(nyquistBin / f0Bin);
  const xAxisLimit = Math.floor((xMaxHz / binSizeHz) / f0Bin);
  return Math.max(0, Math.min(maxPositions, nyquistLimit, xAxisLimit));
}

function resolveOverrideHypothesis(sourcePeakBin, whiteHypothesisP) {
  if (!Number.isFinite(sourcePeakBin) || sourcePeakBin <= 0) return null;
  if (!Number.isFinite(whiteHypothesisP)) return null;
  const p = Math.max(1, Math.floor(whiteHypothesisP));
  return {
    sourcePeakBin,
    p,
    f0Bin: sourcePeakBin / p,
  };
}

function buildPointOverlays(debug, magnitudes, binSizeHz, sourcePeakBin, whiteHypothesisP = null) {
  const allCandidates = Array.isArray(debug?.individualHypotheses)
      ? debug.individualHypotheses
          .filter((item) => item?.sourcePeakBin === sourcePeakBin)
          .sort((a, b) => b.hypothesisScore - a.hypothesisScore)
      : [];
  if (!allCandidates.length) {
    return {
      shapes: [],
      legendTraces: [],
      selectedPeakBin: null,
      selectedPeakWeightedBin: null,
    };
  }

  const winner = allCandidates[0];
  const override = resolveOverrideHypothesis(sourcePeakBin, whiteHypothesisP);
  const whiteCandidate = override ?? allCandidates[1] ?? null;
  const candidates = [winner, whiteCandidate].filter(Boolean);

  const nyquistBin = magnitudes.length - 1;
  const pCount = Number.isFinite(debug?.tuning?.pCount)
      ? Math.max(1, Math.floor(debug.tuning.pCount))
      : 12;
  const styles = [
    {fill: "rgba(34, 197, 94, 0.20)", lineColor: "rgba(0, 0, 0, 0)", lineWidth: 0, lineDash: "solid"},
    {fill: "rgba(0, 0, 0, 0)", lineColor: "#ffffff", lineWidth: 1, lineDash: "dot"},
  ];

  const shapes = [];
  const legendTraces = [];
  for (let hypothesisIndex = 0; hypothesisIndex < candidates.length; hypothesisIndex += 1) {
    const candidate = candidates[hypothesisIndex];
    const f0Bin = candidate.f0Bin;
    if (!Number.isFinite(f0Bin)) continue;
    const style = styles[hypothesisIndex];
    legendTraces.push({
      x: [null],
      y: [null],
      mode: "lines",
      line: {color: style.lineColor, width: 3, dash: style.lineDash},
      name: `${hypothesisIndex + 1}: ${(f0Bin * binSizeHz).toFixed(2)} Hz`,
      hoverinfo: "skip",
      showlegend: true,
      legendrank: 2 + hypothesisIndex,
    });

    const visiblePartialCount = resolveVisiblePartialCount(
        f0Bin,
        binSizeHz,
        nyquistBin,
        pCount,
        POINT_CHART_X_MAX_HZ
    );
    for (let p = 1; p <= visiblePartialCount; p += 1) {
      const targetBin = f0Bin * p;
      if (targetBin < 1 || targetBin > nyquistBin) continue;
      const centerBin = clamp(Math.round(targetBin), 1, nyquistBin);
      const searchStart = clamp(centerBin - 1, 1, nyquistBin);
      const searchEnd = clamp(centerBin + 1, 1, nyquistBin);
      const x0 = (searchStart - 0.5) * binSizeHz;
      const x1 = (searchEnd + 0.5) * binSizeHz;
      shapes.push({
        type: "rect",
        xref: "x",
        yref: "paper",
        x0,
        x1,
        y0: 0,
        y1: 1,
        fillcolor: style.fill,
        line: {color: style.lineColor, width: style.lineWidth, dash: style.lineDash},
      });
    }

  }

  const selectedPeakBin = Number.isFinite(sourcePeakBin) ? Math.round(sourcePeakBin) : null;
  const selectedPeakWeightedBin = Number.isFinite(sourcePeakBin)
      ? refinePeakBinWeighted(magnitudes, sourcePeakBin)
      : null;
  return {shapes, legendTraces, selectedPeakBin, selectedPeakWeightedBin};
}

async function renderPointChart({
                                  plotly,
                                  chartId,
                                  chartTitle,
                                  magnitudes,
                                  xHz,
                                  markerX,
                                  markerY,
                                  hypothesisShapes,
                                  hypothesisLegendTraces,
                                }) {
  await plotly.newPlot(chartId, [{
    x: xHz,
    y: magnitudes,
    type: "bar",
    marker: {color: "rgba(96, 165, 250, 0.55)"},
    hovertemplate: "Hz=%{x:.1f}<br>Mag=%{y:.5f}<extra></extra>",
    name: "Spectrum",
    legendrank: 1,
  }, {
    x: markerX,
    y: markerY,
    mode: "markers",
    marker: {size: 8, color: "#f97316"},
    hovertemplate: "Selected peak<br>Hz=%{x:.1f}<br>Mag=%{y:.5f}<extra></extra>",
    name: "Selected peaks",
    legendrank: 4,
  }, ...hypothesisLegendTraces], {
    title: chartTitle,
    paper_bgcolor: "#050505",
    plot_bgcolor: "#050505",
    font: {color: "#e2e8f0"},
    showlegend: true,
    margin: {l: 52, r: 24, t: 48, b: 44},
    xaxis: {title: "Frequency (Hz)", gridcolor: "#1f2937", range: [0, POINT_CHART_X_MAX_HZ]},
    yaxis: {title: "Magnitude", gridcolor: "#1f2937"},
    shapes: hypothesisShapes,
  }, {responsive: true});
}

export async function renderPitchCharts(result, options = {}) {
  const {
    selectedWindowIndex = 0,
    onWindowSelect = null,
    onWindowDebug = null,
    whiteHypothesisP = null,
    peakinessCutoff = 0.8,
  } = options;
  const plotly = globalThis.Plotly;
  if (!plotly) {
    throw new Error("Plotly is not loaded");
  }
  const pitchyHz = Array.isArray(result.pitchyHz) ? result.pitchyHz : [];

  await plotly.newPlot("pitchChart", [{
    x: result.timeSec,
    y: result.pitchHz,
    mode: "lines",
    line: {width: 3, color: "rgba(56, 189, 248, 0.7)", dash: "dash"},
    connectgaps: false,
    hovertemplate: "t=%{x:.3f}s<br>Pitch=%{y:.2f} Hz<extra></extra>",
    name: "Voicebox",
  }, {
    x: result.timeSec,
    y: pitchyHz,
    mode: "lines",
    line: {width: 2.5, color: "rgba(248, 113, 113, 0.7)", dash: "dot"},
    connectgaps: false,
    hovertemplate: "t=%{x:.3f}s<br>Pitchy=%{y:.2f} Hz<extra></extra>",
    name: "Pitchy",
  }, {
    x: [],
    y: [],
    mode: "markers",
    marker: {size: 10, color: "#f59e0b"},
    hovertemplate: "Selected<br>t=%{x:.3f}s<br>Pitch=%{y:.2f} Hz<extra></extra>",
    showlegend: false,
    name: "Selected",
  }], {
    title: "Pitch Timeline",
    paper_bgcolor: "#050505",
    plot_bgcolor: "#050505",
    font: {color: "#e2e8f0"},
    showlegend: true,
    margin: {l: 52, r: 24, t: 48, b: 44},
    xaxis: {title: "Time (s)", gridcolor: "#1f2937"},
    yaxis: {title: "Pitch (Hz)", gridcolor: "#1f2937", type: "log", range: [Math.log10(40), Math.log10(1000)]},
  }, {responsive: true});

  await plotly.newPlot("flatnessChart", [{
    x: result.timeSec,
    y: result.spectralFlatness,
    mode: "lines",
    line: {width: 2.5, color: "rgba(167, 139, 250, 0.75)", dash: "dash"},
    connectgaps: false,
    hovertemplate: "t=%{x:.3f}s<br>Flatness=%{y:.4f}<extra></extra>",
    name: "Spectral flatness",
  }, {
    x: result.timeSec,
    y: result.timeSec.map(() => 1 - peakinessCutoff),
    mode: "lines",
    line: {width: 1.5, color: "rgba(250, 204, 21, 0.9)", dash: "dot"},
    hovertemplate: "Flatness cutoff=%{y:.4f}<extra></extra>",
    name: "Flatness cutoff",
  }, {
    x: [],
    y: [],
    mode: "markers",
    marker: {size: 9, color: "#f59e0b"},
    hovertemplate: "Selected<br>t=%{x:.3f}s<br>Flatness=%{y:.4f}<extra></extra>",
    showlegend: false,
    name: "Selected",
  }], {
    title: "Spectral Flatness",
    paper_bgcolor: "#050505",
    plot_bgcolor: "#050505",
    font: {color: "#e2e8f0"},
    showlegend: true,
    margin: {l: 52, r: 24, t: 44, b: 40},
    xaxis: {title: "Time (s)", gridcolor: "#1f2937"},
    yaxis: {title: "Flatness", gridcolor: "#1f2937", range: [0, 1]},
  }, {responsive: true});

  async function renderPointCharts(windowIndex) {
    const magnitudes = result.windowSpectra[windowIndex];
    const debug = result.windowDebug[windowIndex] ?? {};
    const xHz = Array.from({length: magnitudes.length}, (_, bin) => bin * result.binSizeHz);
    const sourcePeakBin = Array.isArray(debug.seedPeakBins) && Number.isFinite(debug.seedPeakBins[0])
        ? debug.seedPeakBins[0]
        : (Number.isFinite(debug.strongestPeakBin) ? debug.strongestPeakBin : 0);
    const {shapes, legendTraces, selectedPeakBin, selectedPeakWeightedBin} = buildPointOverlays(
        debug,
        magnitudes,
        result.binSizeHz,
        sourcePeakBin,
        whiteHypothesisP
    );
    const markerX = Number.isFinite(selectedPeakWeightedBin) ? [selectedPeakWeightedBin * result.binSizeHz] : [];
    const markerY = Number.isFinite(selectedPeakBin) ? [magnitudes[selectedPeakBin]] : [];
    const chartTitle = `Point 1 at t=${result.timeSec[windowIndex].toFixed(3)}s`;
    await renderPointChart({
      plotly,
      chartId: "point1Chart",
      chartTitle,
      magnitudes,
      xHz,
      markerX,
      markerY,
      hypothesisShapes: shapes,
      hypothesisLegendTraces: legendTraces,
    });
  }

  function updateSelectedWindowMarker(windowIndex) {
    const hz = result.pitchHz[windowIndex];
    const x = Number.isFinite(hz) ? [[result.timeSec[windowIndex]]] : [[]];
    const y = Number.isFinite(hz) ? [[hz]] : [[]];
    plotly.restyle("pitchChart", {x, y}, [2]);

    const flatness = result.spectralFlatness?.[windowIndex];
    const flatnessX = Number.isFinite(flatness) ? [[result.timeSec[windowIndex]]] : [[]];
    const flatnessY = Number.isFinite(flatness) ? [[flatness]] : [[]];
    plotly.restyle("flatnessChart", {x: flatnessX, y: flatnessY}, [2]);
  }

  function updateSelectedHzTitle(windowIndex) {
    const hz = result.pitchHz[windowIndex];
    const selectedText = Number.isFinite(hz)
        ? `${hz.toFixed(2)} Hz`
        : "n/a";
    plotly.relayout("pitchChart", {
      title: `Pitch Timeline (selected: ${selectedText})`,
    });
  }

  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  let activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex));

  async function selectWindow(windowIndex, shouldLogDebug = false) {
    activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
    updateSelectedWindowMarker(activeWindowIndex);
    updateSelectedHzTitle(activeWindowIndex);
    await renderPointCharts(activeWindowIndex);
    if (typeof onWindowSelect === "function") {
      onWindowSelect(activeWindowIndex);
    }
    if (shouldLogDebug && typeof onWindowDebug === "function") {
      onWindowDebug(activeWindowIndex);
    }
  }

  await selectWindow(activeWindowIndex);

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
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) {
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
