import { buildPicaCorrelationHistogram, getPicaPitchAnalysisFromWaveform } from "./picaPitch.js";
import {
  PICA_WINDOW_CYCLES,
  PICA_WINDOW_DURATION_SEC,
  PICA_WINDOW_SAMPLES_AT_48K,
} from "./windowing.js";

let detachWindowKeyHandler = null;
const MIN_PITCH_CHART_HZ = 40;
const MAX_PITCH_CHART_HZ = 1300;

function getBottomLegend() {
  return {
    orientation: "h",
    x: 0.5,
    xanchor: "center",
    y: -0.16,
    yanchor: "top",
  };
}

function getHeatmapStyle(value, maxValue = 3) {
  const intensity = Math.max(0, Math.min(1, value / maxValue));
  const alpha = 0.15 + intensity * 0.55;
  return `background: rgba(192, 132, 252, ${alpha.toFixed(3)});`;
}

function getNearestHistogramY(histogram, hz) {
  if (!Number.isFinite(hz)) return [];

  let bestIndex = 0;
  let bestDistance = Math.abs(histogram.hz[0] - hz);
  for (let index = 1; index < histogram.hz.length; index += 1) {
    const distance = Math.abs(histogram.hz[index] - hz);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return [histogram.logCorrelation[bestIndex]];
}

function getSelectedPitchLabel(hz) {
  return Number.isFinite(hz) ? `${hz.toFixed(2)} Hz` : "n/a";
}

function getActualPitchLabel(label) {
  if (label === null) return "null";
  if (Number.isFinite(label)) return `${label.toFixed(2)} Hz`;
  return "n/a";
}

function getWaveformTitle(waveformWindow, analysis) {
  const durationMs =
    waveformWindow.durationMs > 0 ? waveformWindow.durationMs : PICA_WINDOW_DURATION_SEC * 1000;
  const reason = analysis.rejectionReason ? `, rejected: ${analysis.rejectionReason}` : "";
  return `Waveform ending at t=${waveformWindow.endTimeSec.toFixed(3)}s, I=${waveformWindow.windowIndex} (${durationMs.toFixed(1)} ms window, ${PICA_WINDOW_SAMPLES_AT_48K} samples @ 48k, ${PICA_WINDOW_CYCLES} cycles at E1${reason})`;
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
  if (!(analysis.winningCandidate?.periodSamples > 0)) return [];
  const widthSec = analysis.winningCandidate.periodSamples / waveformWindow.sampleRate;
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
  for (const extremum of analysis.foldExtrema) {
    x.push((waveformWindow.startSample + extremum.index) / waveformWindow.sampleRate);
    y.push(waveformWindow.samples[extremum.index]);
    color.push(winningPointPair.includes(extremum.index) ? "#f87171" : "#f59e0b");
    symbol.push(extremum.type === "trough" ? "triangle-down" : "circle");
  }
  return { x, y, color, symbol };
}

function renderCandidateTable(panel, analysis, fftPitchHz) {
  const families = analysis.candidateFamilies;
  if (families.length === 0) {
    if (analysis.winningCandidate?.type === "carryForward") {
      panel.innerHTML = `<div class="candidate-summary">Carry-forward path won at ${analysis.winningCandidate.hz.toFixed(2)} Hz with logCorr ${analysis.winningCandidate.logCorrelation.toFixed(3)}.</div>`;
      return;
    }
    panel.innerHTML = `<div class="candidate-summary">No candidates. ${analysis.rejectionReason ?? ""}</div>`;
    return;
  }

  let closestKey = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  families.forEach((family, familyIndex) => {
    const distance = Math.abs(1200 * Math.log2(family.hz / fftPitchHz));
    if (distance < closestDistance) {
      closestDistance = distance;
      closestKey = familyIndex;
    }
  });

  const renderTypeTable = (type) => {
    const typedFamilies = families
      .filter((family) => family.type === type)
      .sort((left, right) => left.hz - right.hz);
    if (typedFamilies.length === 0) return "";
    const closestFamily = closestKey === null ? null : families[closestKey];

    const header = typedFamilies.map((_, index) => `<th>${index + 1}</th>`).join("");
    const rows = [
      {
        label: "Pre-walk",
        render: (family) => `${(48000 / family.sourcePeriodSamples).toFixed(1)} Hz`,
      },
      {
        label: "Candidate",
        render: (family) => `${family.hz.toFixed(1)} Hz`,
      },
      {
        label: "Source gap",
        render: (family) => `${family.sourcePeriodSamples} smp`,
      },
      {
        label: "logCorr",
        render: (family) => family.logCorrelation.toFixed(3),
      },
      {
        label: "hzN",
        render: (family) => family.normalizedHzFeature.toFixed(3),
      },
      {
        label: "corrN",
        render: (family) => family.normalizedCorrelationFeature.toFixed(3),
      },
      {
        label: "score",
        render: (family) => family.weightedScore.toFixed(3),
      },
    ]
      .map((row) => {
        const cells = typedFamilies
          .map((family) => {
            const selected = analysis.winningCandidate === family;
            const bold = closestFamily === family ? " font-weight: 700;" : "";
            const heatmap =
              row.label === "logCorr"
                ? getHeatmapStyle(family.logCorrelation)
                : row.label === "hzN"
                  ? getHeatmapStyle(family.normalizedHzFeature, 1)
                  : row.label === "corrN"
                    ? getHeatmapStyle(family.normalizedCorrelationFeature, 1)
                    : row.label === "score"
                      ? getHeatmapStyle(family.weightedScore)
                      : "";
            return `<td class="candidate-value${selected ? " candidate-selected" : ""}" style="${heatmap}${bold}">${row.render(
              family,
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
    ? `Winner ${analysis.winningCandidate.hz.toFixed(2)} Hz, logCorr ${analysis.winningCandidate.logCorrelation.toFixed(3)}, score ${analysis.winningCandidate.weightedScore.toFixed(3)}`
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
  histogram,
  actualPitchHz,
  onActualPitchSelect,
) {
  const fftPitchHz = waveformWindow.fftPitchHz;
  const picaPitchHz = waveformWindow.picaPitchHz;
  const carryForwardPitchHz = waveformWindow.carryForwardPitchHz;
  const fftMarkerX = Number.isFinite(fftPitchHz) ? [fftPitchHz] : [];
  const fftMarkerY = getNearestHistogramY(histogram, fftPitchHz);
  const picaMarkerX = Number.isFinite(picaPitchHz) ? [picaPitchHz] : [];
  const picaMarkerY = getNearestHistogramY(histogram, picaPitchHz);
  const carryForwardMarkerX = Number.isFinite(carryForwardPitchHz) ? [carryForwardPitchHz] : [];
  const carryForwardMarkerY = getNearestHistogramY(histogram, carryForwardPitchHz);
  const actualMarkerX = Number.isFinite(actualPitchHz) ? [actualPitchHz] : [];
  const actualMarkerY = getNearestHistogramY(histogram, actualPitchHz);

  await plotly.newPlot(
    "harmonicChart",
    [
      {
        x: histogram.hz,
        y: histogram.correlation,
        type: "scatter",
        mode: "lines",
        line: { color: "rgba(249, 115, 22, 0.5)", width: 1.5 },
        hovertemplate: "Hz=%{x}<br>corr=%{y:.3f}<extra></extra>",
        name: "Correlation",
        yaxis: "y2",
      },
      {
        x: histogram.hz,
        y: histogram.logCorrelation,
        type: "scatter",
        mode: "lines+markers",
        line: { color: "rgba(255, 255, 255, 0.95)", width: 1.5 },
        marker: { color: "rgba(255, 255, 255, 0.95)", size: 4 },
        hovertemplate: "Hz=%{x}<br>logCorr=%{y:.3f}<extra></extra>",
        name: "Log correlation",
      },
      {
        x: fftMarkerX,
        y: fftMarkerY,
        mode: "markers",
        marker: { color: "#00b7ff", size: 12, symbol: "x" },
        hovertemplate: "FFT=%{x:.2f} Hz<br>logCorr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
      {
        x: picaMarkerX,
        y: picaMarkerY,
        mode: "markers",
        marker: { color: "#ff0066", size: 12, symbol: "cross" },
        hovertemplate: "Pica=%{x:.2f} Hz<br>logCorr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
      {
        x: carryForwardMarkerX,
        y: carryForwardMarkerY,
        mode: "markers",
        marker: { color: "#facc15", size: 12, symbol: "diamond" },
        hovertemplate: "Carry=%{x:.2f} Hz<br>logCorr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
      {
        x: actualMarkerX,
        y: actualMarkerY,
        mode: "markers",
        marker: { color: "#39ff14", size: 9, line: { color: "#000000", width: 1.5 } },
        hovertemplate: "Actual=%{x:.2f} Hz<br>logCorr=%{y:.3f}<extra></extra>",
        showlegend: false,
      },
    ],
    {
      title: `Correlation histogram (${histogram.minHz}-${histogram.maxHz} Hz)`,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      showlegend: true,
      legend: getBottomLegend(),
      margin: { l: 52, r: 52, t: 54, b: 76 },
      xaxis: {
        title: "Hz",
        gridcolor: "#1f2937",
        range: [histogram.minHz, 1300],
        tick0: 0,
        dtick: 100,
      },
      yaxis: { title: "-log10(1 - corr)", gridcolor: "#1f2937" },
      yaxis2: {
        title: "corr",
        overlaying: "y",
        side: "right",
        rangemode: "tozero",
        gridcolor: "#1f2937",
        zerolinecolor: "#1f2937",
      },
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

export async function renderPicaPitchCharts(result, options = {}) {
  const plotly = globalThis.Plotly;
  const {
    selectedWindowIndex = 0,
    getWaveformWindow,
    actualLabelEditor,
    onLabelChange,
    onWindowSelect,
  } = options;
  const candidatePanel = document.getElementById("candidatePanel");
  const actualPitchHz = [];
  const actualPitchColor = [];
  const hasActuals = Array.isArray(result.actualPitchHz);

  function getResolvedActualPitchHz(windowIndex) {
    if (!hasActuals) return undefined;
    const label = actualLabelEditor.getLabel(windowIndex);
    return label === undefined ? result.actualPitchHz?.[windowIndex] : label;
  }

  function refreshActualSeries() {
    actualPitchHz.splice(0, actualPitchHz.length);
    actualPitchColor.splice(0, actualPitchColor.length);
    for (let index = 0; index < result.timeSec.length; index += 1) {
      const actualHz = getResolvedActualPitchHz(index);
      if (actualHz === null) {
        actualPitchHz.push(Number.NaN);
        actualPitchColor.push("rgba(74, 222, 128, 0)");
      } else {
        actualPitchHz.push(actualHz);
        actualPitchColor.push(
          actualLabelEditor?.hasStoredLabel(index)
            ? "rgba(74, 222, 128, 1)"
            : "rgba(37, 111, 64, 1)",
        );
      }
    }
  }

  refreshActualSeries();

  await plotly.newPlot(
    "pitchChart",
    [
      {
        x: result.timeSec,
        y: result.pitchHz,
        mode: "lines",
        customdata: result.timeSec.map((_, index) => index),
        line: { width: 3, color: "rgba(56, 189, 248, 0.4)", dash: "dash" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>FFT=%{y:.2f} Hz<extra></extra>",
        name: "Voicebox FFT",
      },
      {
        x: result.timeSec,
        y: result.picaPitchHz,
        mode: "lines",
        customdata: result.timeSec.map((_, index) => index),
        line: { width: 1, color: "rgba(248, 113, 113, 0.95)" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Pica=%{y:.2f} Hz<extra></extra>",
        name: "PICA",
      },
      {
        x: result.timeSec,
        y: result.carryForwardPitchHz,
        mode: "lines",
        customdata: result.timeSec.map((_, index) => index),
        line: { width: 1.25, color: "rgba(250, 204, 21, 0.95)" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Carry=%{y:.2f} Hz<extra></extra>",
        name: "Carry",
      },
      {
        x: result.timeSec,
        y: actualPitchHz,
        mode: "markers",
        customdata: result.timeSec.map((_, index) => index),
        marker: { size: 6, color: actualPitchColor },
        hovertemplate: "t=%{x:.3f}s<br>Actual=%{y:.2f} Hz<extra></extra>",
        name: "Actual",
        visible: hasActuals,
      },
    ],
    {
      title: "Pitch Timeline",
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: { color: "#e2e8f0" },
      showlegend: true,
      legend: getBottomLegend(),
      margin: { l: 52, r: 24, t: 48, b: 76 },
      xaxis: { title: "Time (s)", gridcolor: "#1f2937" },
      yaxis: {
        title: "Pitch (Hz)",
        gridcolor: "#1f2937",
        type: "log",
        range: [Math.log10(MIN_PITCH_CHART_HZ), Math.log10(MAX_PITCH_CHART_HZ)],
      },
    },
    { responsive: true },
  );

  const maxWindowIndex = Math.max(0, result.timeSec.length - 1);
  let activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex));

  async function selectWindow(windowIndex) {
    activeWindowIndex = Math.max(0, Math.min(maxWindowIndex, windowIndex));
    const waveformWindow = getWaveformWindow(activeWindowIndex);
    const analysis = getPicaPitchAnalysisFromWaveform(
      waveformWindow.samples,
      waveformWindow.sampleRate,
      result.picaSettings,
    );
    const histogram = buildPicaCorrelationHistogram(
      waveformWindow.samples,
      waveformWindow.sampleRate,
      result.picaSettings,
    );
    const extremaMarkers = getExtremaMarkers(waveformWindow, analysis);

    await plotly.relayout("pitchChart", {
      title: `Pitch Timeline (pica: ${getSelectedPitchLabel(waveformWindow.picaPitchHz)}, carry: ${getSelectedPitchLabel(waveformWindow.carryForwardPitchHz)}, actual: ${getActualPitchLabel(getResolvedActualPitchHz(activeWindowIndex))})`,
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
        title: getWaveformTitle(waveformWindow, analysis),
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
          range: getAmplitudeRange(waveformWindow.samples),
        },
        shapes: [
          ...getWinningPeriodBox(waveformWindow, analysis),
          ...getPeriodMarkers(waveformWindow),
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

    renderCandidateTable(candidatePanel, analysis, waveformWindow.fftPitchHz);
    await renderHistogram(
      plotly,
      waveformWindow,
      histogram,
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
                "marker.color": [actualPitchColor],
                x: [result.timeSec],
              },
              [3],
            );
            void selectWindow(activeWindowIndex);
          }
        : undefined,
    );
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
          "marker.color": [actualPitchColor],
          x: [result.timeSec],
        },
        [3],
      );
    }
    void selectWindow(nextWindowIndex);
  };

  window.addEventListener("keydown", keydownHandler);
  detachWindowKeyHandler = () => {
    window.removeEventListener("keydown", keydownHandler);
  };
}
