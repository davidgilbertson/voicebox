const SHARED_HZ_AXIS_RANGE = [0, 2000];

export function renderCharts(payload) {
  const plotly = globalThis.Plotly;
  if (!plotly) {
    throw new Error("Plotly is not loaded");
  }

  const pitchTrace = [{
    x: payload.track.windowIndex,
    y: payload.track.hz,
    mode: "lines+markers",
    marker: {size: 3, opacity: 0.9},
    line: {width: 1.5},
    name: payload.track.method,
    connectgaps: false,
    hovertemplate: "Window %{x}<br>Hz %{y:.2f}<extra></extra>",
  }];

  plotly.newPlot("pitchChart", pitchTrace, {
    title: `Pitch by Analysis Window (${payload.track.method}, windowSize=${payload.windowSize}, bins=${payload.frequencyBinCount}, browser analyser FFT)`,
    paper_bgcolor: "#050505",
    plot_bgcolor: "#050505",
    font: {color: "#e2e8f0"},
    margin: {l: 52, r: 24, t: 52, b: 46},
    xaxis: {title: "Window Index (n)", gridcolor: "#1f2937"},
    yaxis: {
      title: "Pitch (Hz)",
      gridcolor: "#1f2937",
      range: [payload.pitchRange.minHz, payload.pitchRange.maxHz],
    },
  }, {responsive: true});

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

  const firstInspectableWindow = payload.track.freqCandidateScores.findIndex((scores) => Array.isArray(scores));
  const initialWindow = firstInspectableWindow >= 0 ? firstInspectableWindow : 0;
  renderCandidateScoresForWindow(initialWindow);
  renderSpectrumForWindow(initialWindow);

  const pitchChartElement = document.getElementById("pitchChart");
  pitchChartElement.on("plotly_click", (event) => {
    const windowNumber = event.points?.[0]?.pointIndex;
    if (windowNumber == null) return;
    renderCandidateScoresForWindow(windowNumber);
    renderSpectrumForWindow(windowNumber);
  });
}
