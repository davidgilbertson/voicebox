const SHARED_HZ_AXIS_RANGE = [0, 2000];
let detachWindowKeyHandler = null;

export function renderCharts(payload, options = {}) {
  const {selectedWindowIndex = null, onWindowSelect = null} = options;
  const plotly = globalThis.Plotly;
  if (!plotly) {
    throw new Error("Plotly is not loaded");
  }
  const finiteHzValues = payload.track.hz.filter((value) => Number.isFinite(value) && value > 0);
  const observedMaxHz = finiteHzValues.length > 0 ? Math.max(...finiteHzValues) : 0;
  const dynamicPitchMaxHz = Math.max(
      1,
      observedMaxHz > 0 ? observedMaxHz * 1.05 : payload.pitchRange.maxHz
  );

  function buildPitchTraces(activeWindowNumber) {
    const mainTrace = {
      x: payload.track.windowIndex,
      y: payload.track.hz,
      mode: "lines+markers",
      marker: {size: 3, opacity: 0.9},
      line: {width: 1.5},
      name: payload.track.method,
      connectgaps: false,
      hovertemplate: "Window %{x}<br>Hz %{y:.2f}<extra></extra>",
    };
    const selectedHz = payload.track.hz[activeWindowNumber];
    const selectedTrace = Number.isFinite(selectedHz)
        ? {
          x: [activeWindowNumber],
          y: [selectedHz],
          mode: "markers",
          marker: {size: 10, color: "#f59e0b"},
          name: "selected window",
          showlegend: false,
          hovertemplate: "Selected window %{x}<br>Hz %{y:.2f}<extra></extra>",
        }
        : {
          x: [],
          y: [],
          mode: "markers",
          marker: {size: 10, color: "#f59e0b"},
          name: "selected window",
          showlegend: false,
          hovertemplate: "Selected window %{x}<br>Hz %{y:.2f}<extra></extra>",
        };
    return [mainTrace, selectedTrace];
  }

  function renderPitchChart(activeWindowNumber) {
    plotly.newPlot("pitchChart", buildPitchTraces(activeWindowNumber), {
      title: `Pitch by Analysis Window (${payload.track.method}, windowSize=${payload.windowSize}, bins=${payload.frequencyBinCount}, browser analyser FFT)`,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: {color: "#e2e8f0"},
      showlegend: false,
      margin: {l: 52, r: 24, t: 52, b: 46},
      xaxis: {title: "Window Index (n)", gridcolor: "#1f2937"},
      yaxis: {
        title: "Pitch (Hz)",
        gridcolor: "#1f2937",
        range: [0, dynamicPitchMaxHz],
      },
    }, {responsive: true});
  }

  function updateSelectedWindowMarker(activeWindowNumber) {
    const selectedHz = payload.track.hz[activeWindowNumber];
    const x = Number.isFinite(selectedHz) ? [[activeWindowNumber]] : [[]];
    const y = Number.isFinite(selectedHz) ? [[selectedHz]] : [[]];
    plotly.restyle("pitchChart", {x, y}, [1]);
  }

  renderPitchChart(0);

  function renderCandidateScoresForWindow(windowNumber) {
    const startBin = payload.track.freqCandidateStartBins[windowNumber];
    const scores = payload.track.freqCandidateScores[windowNumber];
    const predictedHz = payload.track.hz[windowNumber];
    if (!Array.isArray(scores) || scores.length === 0 || startBin == null) {
      plotly.newPlot("candidateChart", [{x: [], y: [], mode: "lines", name: "freqCandidateScores"}], {
        title: `freqCandidateScores (window ${windowNumber}, no signal)`,
        paper_bgcolor: "#050505",
        plot_bgcolor: "#050505",
        font: {color: "#e2e8f0"},
        margin: {l: 52, r: 24, t: 52, b: 46},
        xaxis: {title: "Candidate Frequency (Hz)", gridcolor: "#1f2937"},
        yaxis: {title: "Score", gridcolor: "#1f2937"},
      }, {responsive: true});
      return;
    }

    const xHz = Array.from({length: scores.length}, (_, i) => (startBin + i) * payload.binSizeHz);

    plotly.newPlot("candidateChart", [{
      x: xHz,
      y: scores,
      mode: "lines",
      name: "freqCandidateScores",
      hovertemplate: "Hz %{x:.1f}<br>Score %{y:.5f}<extra></extra>",
    }], {
      title: `freqCandidateScores (window ${windowNumber}, pitch=${Number.isFinite(predictedHz) ? `${predictedHz.toFixed(2)} Hz` : "NaN"})`,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: {color: "#e2e8f0"},
      margin: {l: 52, r: 24, t: 52, b: 46},
      xaxis: {
        title: "Candidate Frequency (Hz)",
        gridcolor: "#1f2937",
        range: SHARED_HZ_AXIS_RANGE,
      },
      yaxis: {title: "Score", gridcolor: "#1f2937"},
    }, {responsive: true});
  }

  function renderSpectrumForWindow(windowNumber) {
    const magnitudes = payload.track.windowSpectrumMagnitudes?.[windowNumber];
    const predictedHz = payload.track.hz[windowNumber];
    if (!magnitudes || magnitudes.length === 0) {
      plotly.newPlot("spectrumChart", [{x: [], y: [], mode: "lines", name: "spectrum"}], {
        title: `Spectrum (window ${windowNumber}, no data)`,
        paper_bgcolor: "#050505",
        plot_bgcolor: "#050505",
        font: {color: "#e2e8f0"},
        margin: {l: 52, r: 24, t: 52, b: 46},
        xaxis: {title: "Frequency (Hz)", gridcolor: "#1f2937"},
        yaxis: {title: "Magnitude", gridcolor: "#1f2937"},
      }, {responsive: true});
      return;
    }

    const xHz = Array.from({length: magnitudes.length}, (_, bin) => bin * payload.binSizeHz);
    plotly.newPlot("spectrumChart", [{
      x: xHz,
      y: magnitudes,
      mode: "lines",
      name: "spectrum",
      hovertemplate: "Hz %{x:.1f}<br>Magnitude %{y:.5f}<extra></extra>",
    }], {
      title: `Spectrum (window ${windowNumber}, pitch=${Number.isFinite(predictedHz) ? `${predictedHz.toFixed(2)} Hz` : "NaN"})`,
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      font: {color: "#e2e8f0"},
      margin: {l: 52, r: 24, t: 52, b: 46},
      xaxis: {title: "Frequency (Hz)", gridcolor: "#1f2937", range: SHARED_HZ_AXIS_RANGE},
      yaxis: {title: "Magnitude", gridcolor: "#1f2937"},
    }, {responsive: true});
  }

  function logWindowDebug(windowNumber) {
    const debug = payload.track.processorDebug?.[windowNumber];
    if (!debug) return;
    console.log("[pitchExperiments] window debug", {
      windowNumber,
      predictedHz: payload.track.hz[windowNumber],
      ...debug,
    });
  }

  const firstInspectableWindow = payload.track.freqCandidateScores.findIndex((scores) => Array.isArray(scores));
  const maxWindowIndex = Math.max(0, payload.track.windowIndex.length - 1);
  const requestedWindow = Number.isInteger(selectedWindowIndex)
      ? Math.max(0, Math.min(maxWindowIndex, selectedWindowIndex))
      : null;
  const hasRequestedData = requestedWindow !== null
      && Array.isArray(payload.track.freqCandidateScores[requestedWindow]);
  const initialWindow = hasRequestedData ? requestedWindow : (firstInspectableWindow >= 0 ? firstInspectableWindow : 0);
  let activeWindowNumber = initialWindow;

  function selectWindow(windowNumber) {
    const clampedWindowNumber = Math.max(0, Math.min(maxWindowIndex, windowNumber));
    activeWindowNumber = clampedWindowNumber;
    updateSelectedWindowMarker(clampedWindowNumber);
    renderSpectrumForWindow(clampedWindowNumber);
    renderCandidateScoresForWindow(clampedWindowNumber);
    logWindowDebug(clampedWindowNumber);
    if (typeof onWindowSelect === "function") {
      onWindowSelect(clampedWindowNumber);
    }
  }

  selectWindow(initialWindow);

  const pitchChartElement = document.getElementById("pitchChart");
  pitchChartElement.on("plotly_click", (event) => {
    const clickedX = event.points?.[0]?.x;
    const windowNumber = Number.isInteger(clickedX) ? clickedX : null;
    if (windowNumber === null) return;
    selectWindow(windowNumber);
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
      selectWindow(activeWindowNumber - 1);
      return;
    }
    selectWindow(activeWindowNumber + 1);
  };
  window.addEventListener("keydown", keydownHandler);
  detachWindowKeyHandler = () => {
    window.removeEventListener("keydown", keydownHandler);
  };
}
