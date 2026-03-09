function finiteMax(values, fallback) {
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value) && value > maxValue) {
      maxValue = value;
    }
  }
  return Number.isFinite(maxValue) ? maxValue : fallback;
}

function finiteMin(values, fallback) {
  let minValue = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value) && value < minValue) {
      minValue = value;
    }
  }
  return Number.isFinite(minValue) ? minValue : fallback;
}

function hzToMidi(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return Number.NaN;
  return 69 + 12 * Math.log2(hz / 440);
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function hzToCents(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return Number.NaN;
  return 1200 * Math.log2(hz);
}

function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const name = names[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

function buildCentsNoteTicks(minHz, maxHz) {
  const minMidi = Math.floor(hzToMidi(minHz));
  const maxMidi = Math.ceil(hzToMidi(maxHz));
  const tickvals = [];
  const ticktext = [];
  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    tickvals.push(hzToCents(midiToHz(midi)));
    ticktext.push(midiToNoteName(midi));
  }
  return { tickvals, ticktext };
}

function plotTheme() {
  return {
    paper_bgcolor: "#050505",
    plot_bgcolor: "#050505",
    font: { color: "#e2e8f0" },
    margin: { l: 52, r: 24, t: 44, b: 44 },
    xaxis: { title: "Time (s)", gridcolor: "#1f2937" },
    yaxis: { gridcolor: "#1f2937" },
  };
}

const SMOOTH_RADIUS = 3;
const SMOOTH_KERNEL = [0.01, 0.08, 0.22, 0.38, 0.22, 0.08, 0.01];

function smoothFiniteRun(values, indices, start, end, output) {
  for (let point = start + SMOOTH_RADIUS; point <= end - SMOOTH_RADIUS; point += 1) {
    let smoothed = 0;
    for (let i = -SMOOTH_RADIUS; i <= SMOOTH_RADIUS; i += 1) {
      smoothed += values[indices[point + i]] * SMOOTH_KERNEL[i + SMOOTH_RADIUS];
    }
    output[indices[point]] = smoothed;
  }
}

function smoothPitchForDisplay(values) {
  const raw = Float32Array.from(values, (value) => (Number.isFinite(value) ? value : Number.NaN));
  const output = new Float32Array(raw.length);
  output.set(raw);
  if (raw.length < SMOOTH_RADIUS * 2 + 1) {
    return Array.from(output);
  }
  const indices = new Uint32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    indices[i] = i;
  }
  let runStart = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (Number.isFinite(raw[i])) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      smoothFiniteRun(raw, indices, runStart, i - 1, output);
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    smoothFiniteRun(raw, indices, runStart, raw.length - 1, output);
  }
  return Array.from(output);
}

function vibratoTrace(timeSec, values, color) {
  return {
    x: timeSec,
    y: values,
    mode: "lines",
    line: { width: 3, color },
    connectgaps: false,
    hovertemplate: "t=%{x:.3f}s<br>Vibrato=%{y:.2f} Hz<extra></extra>",
  };
}

export async function renderVibratoCharts(result, options = {}) {
  const { onTopChartClick = null, getTopChartHoverWindow = null } = options;
  const plotly = globalThis.Plotly;
  if (!plotly) {
    throw new Error("Plotly is not loaded");
  }

  const pitchMinHz = finiteMin(result.pitchHz, 100);
  const pitchMaxHz = finiteMax(result.pitchHz, 500);
  const pitchMinCents = finiteMin(result.pitchCents, hzToCents(pitchMinHz));
  const pitchMaxCents = finiteMax(result.pitchCents, hzToCents(pitchMaxHz));
  const centsRangeSpan = Math.max(50, pitchMaxCents - pitchMinCents);
  const pitchPadding = centsRangeSpan * 0.08;
  const centsTicks = buildCentsNoteTicks(pitchMinHz, pitchMaxHz);
  const smoothedPitchCents = result.smoothedPitchCents ?? smoothPitchForDisplay(result.pitchCents);
  await plotly.newPlot(
    "pitchChart",
    [
      {
        x: result.timeSec,
        y: result.pitchCents,
        mode: "lines",
        line: { width: 3, color: "rgba(56, 189, 248, 0.7)" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Pitch=%{y:.1f} cents<extra></extra>",
        name: "Pitch (raw)",
      },
      {
        x: result.timeSec,
        y: smoothedPitchCents,
        mode: "lines",
        line: { width: 3, color: "rgba(74, 222, 128, 0.7)" },
        connectgaps: false,
        hovertemplate: "t=%{x:.3f}s<br>Pitch=%{y:.1f} cents<extra></extra>",
        name: "Pitch (smoothed)",
      },
      {
        x: [],
        y: [],
        mode: "markers",
        marker: { size: 8, color: "#f97316" },
        name: "Selected peaks",
        hovertemplate: "Peak t=%{x:.3f}s<br>Pitch=%{y:.1f} cents<extra></extra>",
      },
    ],
    {
      ...plotTheme(),
      title: "Pitch",
      showlegend: true,
      yaxis: {
        title: "Pitch (cents)",
        gridcolor: "#1f2937",
        range: [pitchMinCents - pitchPadding, pitchMaxCents + pitchPadding],
        tickvals: centsTicks.tickvals,
        ticktext: centsTicks.ticktext,
      },
      shapes: [],
    },
    { responsive: true },
  );

  const vibratoMinHz = 3;
  const vibratoMaxHz = 11;

  const lastTwoShapeRawTrace = vibratoTrace(
    result.timeSec,
    result.vibrato.lastTwoShapePeaksRawInput?.hz ?? [],
    "rgba(96, 165, 250, 0.7)",
  );
  lastTwoShapeRawTrace.name = "Rate from raw pitch";
  const lastTwoShapeSmoothedTrace = vibratoTrace(
    result.timeSec,
    result.vibrato.lastTwoShapePeaksSmoothedInput?.hz ?? result.vibrato.lastTwoShapePeaks?.hz ?? [],
    "rgba(74, 222, 128, 0.7)",
  );
  lastTwoShapeSmoothedTrace.name = "Rate from smoothed pitch";
  await plotly.newPlot(
    "vibratoLastTwoShapePeaksChart",
    [lastTwoShapeRawTrace, lastTwoShapeSmoothedTrace],
    {
      ...plotTheme(),
      title: "Vibrato Rate - Last Two Shape Peaks",
      showlegend: true,
      yaxis: { title: "Hz", gridcolor: "#1f2937", range: [vibratoMinHz, vibratoMaxHz] },
    },
    { responsive: true },
  );

  const methodWindows = {
    vibratoLastTwoShapePeaksChart: result.vibrato.lastTwoShapePeaks.windows,
  };
  const lowerChartIds = ["vibratoLastTwoShapePeaksChart"];

  function clearHighlight() {
    plotly.relayout("pitchChart", { shapes: [] });
  }

  function highlightWindow(windowRange) {
    if (!windowRange) {
      clearHighlight();
      return;
    }
    plotly.relayout("pitchChart", {
      shapes: [
        {
          type: "rect",
          xref: "x",
          yref: "paper",
          x0: windowRange.startSec,
          x1: windowRange.endSec,
          y0: 0,
          y1: 1,
          fillcolor: "rgba(56, 189, 248, 0.20)",
          line: { width: 1, color: "rgba(56, 189, 248, 0.8)" },
        },
      ],
    });
  }

  function setVerticalLine(chartId, xTimeSec) {
    const shapes = Number.isFinite(xTimeSec)
      ? [
          {
            type: "line",
            xref: "x",
            yref: "paper",
            x0: xTimeSec,
            x1: xTimeSec,
            y0: 0,
            y1: 1,
            line: { color: "rgba(226, 232, 240, 0.8)", width: 1 },
          },
        ]
      : [];
    plotly.relayout(chartId, { shapes });
  }

  function syncVerticalLinesFromHover(sourceChartId, xTimeSec) {
    for (const chartId of lowerChartIds) {
      if (chartId === sourceChartId) continue;
      setVerticalLine(chartId, xTimeSec);
    }
  }

  function clearLowerChartVerticalLines() {
    for (const chartId of lowerChartIds) {
      setVerticalLine(chartId, null);
    }
  }

  function bindWindowHighlight(chartId) {
    const chartElement = document.getElementById(chartId);
    const windows = methodWindows[chartId];

    chartElement.on("plotly_hover", (event) => {
      const pointIndex = event.points?.[0]?.pointIndex;
      if (!Number.isInteger(pointIndex)) return;
      const xTimeSec = event.points?.[0]?.x;
      highlightWindow(windows[pointIndex] ?? null);
      syncVerticalLinesFromHover(chartId, xTimeSec);
    });
    chartElement.on("plotly_click", (event) => {
      const pointIndex = event.points?.[0]?.pointIndex;
      if (!Number.isInteger(pointIndex)) return;
      highlightWindow(windows[pointIndex] ?? null);
    });
    chartElement.on("plotly_unhover", () => {
      clearHighlight();
      clearLowerChartVerticalLines();
    });
  }

  bindWindowHighlight("vibratoLastTwoShapePeaksChart");

  function setPeakMarkers(timelineIndices) {
    if (!Array.isArray(timelineIndices) || timelineIndices.length === 0) {
      plotly.restyle("pitchChart", { x: [[]], y: [[]] }, [2]);
      return;
    }
    const x = [];
    const y = [];
    for (const index of timelineIndices) {
      if (!Number.isInteger(index)) continue;
      if (index < 0 || index >= result.timeSec.length) continue;
      const pitchValue = smoothedPitchCents[index];
      if (!Number.isFinite(pitchValue)) continue;
      x.push(result.timeSec[index]);
      y.push(pitchValue);
    }
    plotly.restyle("pitchChart", { x: [x], y: [y] }, [2]);
  }

  const pitchChartElement = document.getElementById("pitchChart");
  pitchChartElement.on("plotly_hover", (event) => {
    const pointIndex = event.points?.[0]?.pointIndex;
    if (!Number.isInteger(pointIndex)) return;
    const xTimeSec = event.points?.[0]?.x;
    if (typeof getTopChartHoverWindow !== "function") return;
    highlightWindow(getTopChartHoverWindow(pointIndex));
    syncVerticalLinesFromHover("pitchChart", xTimeSec);
  });
  pitchChartElement.on("plotly_unhover", () => {
    clearHighlight();
    clearLowerChartVerticalLines();
  });
  pitchChartElement.on("plotly_click", (event) => {
    const pointIndex = event.points?.[0]?.pointIndex;
    if (!Number.isInteger(pointIndex)) return;
    if (typeof onTopChartClick === "function") {
      const clickResult = onTopChartClick(pointIndex);
      setPeakMarkers(clickResult?.selectedPeakTimelineIndices ?? []);
    }
  });
}
