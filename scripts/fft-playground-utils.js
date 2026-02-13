import fs from "node:fs";

export function parseWavMono(filePath) {
  const bytes = fs.readFileSync(filePath);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const riff = bytes.toString("ascii", 0, 4);
  const wave = bytes.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Unsupported WAV container: ${filePath}`);
  }

  let offset = 12;
  let format = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt ") {
      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        channelCount: view.getUint16(chunkDataOffset + 2, true),
        sampleRate: view.getUint32(chunkDataOffset + 4, true),
        blockAlign: view.getUint16(chunkDataOffset + 12, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = chunkDataOffset + paddedSize;
  }

  if (!format || dataOffset <= 0 || dataSize <= 0) {
    throw new Error(`Incomplete WAV metadata: ${filePath}`);
  }

  const {
    audioFormat,
    channelCount,
    sampleRate,
    blockAlign,
    bitsPerSample,
  } = format;
  if (channelCount !== 1) {
    throw new Error(`Expected mono WAV for this playground, got ${channelCount} channels.`);
  }

  const frameCount = Math.floor(dataSize / blockAlign);
  const out = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * blockAlign;
    if (audioFormat === 1 && bitsPerSample === 16) {
      out[frame] = view.getInt16(frameOffset, true) / 32768;
      continue;
    }
    throw new Error(
        `Unsupported WAV encoding: format=${audioFormat}, bits=${bitsPerSample}. ` +
        "Export from Audacity as Signed 16-bit PCM."
    );
  }

  return {sampleRate, samples: out};
}

export function createPitchOverTimeHtml(payload) {
  const json = JSON.stringify(payload);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FFT Playground Pitch Track</title>
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
    <style>
      body { margin: 0; background: #050505; color: #e2e8f0; font-family: ui-sans-serif, system-ui, sans-serif; }
      #charts { width: 100vw; min-height: 100vh; display: grid; grid-template-rows: 55vh 45vh; }
      #pitchChart, #candidateChart { width: 100vw; height: 100%; }
    </style>
  </head>
  <body>
    <div id="charts">
      <div id="pitchChart"></div>
      <div id="candidateChart"></div>
    </div>
    <script>
      const data = ${json};
      const pitchTrace = [{
        x: data.track.windowIndex,
        y: data.track.hz,
        mode: "lines+markers",
        marker: {
          size: 3,
          opacity: 0.9,
        },
        line: {
          width: 1.5,
        },
        name: data.track.method,
        connectgaps: false,
      }];
      Plotly.newPlot("pitchChart", pitchTrace, {
        title: "Pitch by Analysis Window (" + data.track.method
          + ", windowSize=" + data.windowSize
          + ", bins=" + data.frequencyBinCount
          + ", windowFn=" + data.mockFftWindowFunction
          + ", includeNyquist=" + data.mockFftIncludeNyquist
          + ")",
        paper_bgcolor: "#050505",
        plot_bgcolor: "#050505",
        font: {color: "#e2e8f0"},
        xaxis: {title: "Window Index (n)", gridcolor: "#1f2937"},
        yaxis: {
          title: "Pitch (Hz)",
          gridcolor: "#1f2937",
          range: [data.pitchRange.minHz, data.pitchRange.maxHz],
        },
      }, {responsive: true});

      function buildHzTicks(startBin, endBin, binSizeHz, desiredTickCount = 8) {
        if (!(endBin >= startBin)) return {tickvals: [], ticktext: []};
        const span = endBin - startBin;
        const step = Math.max(1, Math.floor(span / Math.max(1, desiredTickCount - 1)));
        const tickvals = [];
        const ticktext = [];
        for (let bin = startBin; bin <= endBin; bin += step) {
          tickvals.push(bin);
          ticktext.push((bin * binSizeHz).toFixed(0));
        }
        if (tickvals[tickvals.length - 1] !== endBin) {
          tickvals.push(endBin);
          ticktext.push((endBin * binSizeHz).toFixed(0));
        }
        return {tickvals, ticktext};
      }

      function renderCandidateScoresForWindow(windowNumber) {
        const startBin = data.track.freqCandidateStartBins[windowNumber];
        const scores = data.track.freqCandidateScores[windowNumber];
        const predictedHz = data.track.hz[windowNumber];
        if (!Array.isArray(scores) || scores.length === 0 || startBin == null) {
          Plotly.newPlot("candidateChart", [{
            x: [],
            y: [],
            mode: "lines",
            name: "freqCandidateScores",
          }], {
            title: "freqCandidateScores (window " + windowNumber + ", no signal)",
            paper_bgcolor: "#050505",
            plot_bgcolor: "#050505",
            font: {color: "#e2e8f0"},
            xaxis: {title: "Candidate Frequency (Hz)", gridcolor: "#1f2937"},
            yaxis: {title: "Score", gridcolor: "#1f2937"},
          }, {responsive: true});
          return;
        }
        const xBins = Array.from({length: scores.length}, (_, i) => startBin + i);
        const xHz = xBins.map((bin) => bin * data.binSizeHz);
        const endBin = startBin + scores.length - 1;
        const hzTicks = buildHzTicks(startBin, endBin, data.binSizeHz);
        Plotly.newPlot("candidateChart", [{
          x: xBins,
          y: scores,
          customdata: xHz,
          mode: "lines",
          name: "freqCandidateScores",
          hovertemplate: "Hz %{customdata:.1f}<br>Score %{y:.3f}<extra></extra>",
        }], {
          title: "freqCandidateScores (window " + windowNumber + ", pitch="
            + (Number.isFinite(predictedHz) ? predictedHz.toFixed(2) + " Hz" : "NaN")
            + ")",
          paper_bgcolor: "#050505",
          plot_bgcolor: "#050505",
          font: {color: "#e2e8f0"},
          xaxis: {
            title: "Candidate Frequency (Hz)",
            gridcolor: "#1f2937",
            tickvals: hzTicks.tickvals,
            ticktext: hzTicks.ticktext,
          },
          yaxis: {title: "Score", gridcolor: "#1f2937"},
        }, {responsive: true});
      }

      const firstInspectableWindow = data.track.freqCandidateScores.findIndex((scores) => Array.isArray(scores));
      renderCandidateScoresForWindow(firstInspectableWindow >= 0 ? firstInspectableWindow : 0);

      const pitchChartElement = document.getElementById("pitchChart");
      pitchChartElement.on("plotly_click", (event) => {
        const windowNumber = event.points?.[0]?.pointIndex;
        if (windowNumber == null) return;
        renderCandidateScoresForWindow(windowNumber);
      });
    </script>
  </body>
</html>`;
}
