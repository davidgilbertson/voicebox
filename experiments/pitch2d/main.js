const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const OCTAVES = [6, 5, 4, 3, 2];
const AUDIBLE_PARTIAL_COUNT = 4;
const PARTIAL_SLOT_COUNT =
  AUDIBLE_PARTIAL_COUNT * 2 ** (Math.max(...OCTAVES) - Math.min(...OCTAVES));
const MOVE_DURATION_SECONDS = 3;
const RELEASE_SECONDS = 0.04;
const MASTER_GAIN = 0.035;
const WAVEFORM_SAMPLE_COUNT = 500;
const WAVEFORM_RENDER_INTERVAL_MS = 50;
const WAVEFORM_TIME_SPAN_SECONDS = 3 / frequencyForNote(0, 2);
const SPECTROGRAM_COLUMN_COUNT = 100;
const SPECTROGRAM_BIN_COUNT = 96;
const SPECTROGRAM_MIN_HZ = 80;
const SPECTROGRAM_MAX_HZ = 3000;
const AUDIO_UPDATE_INTERVAL_MS = 50;
const AUDIO_RAMP_SECONDS = 0.04;

const noteGrid = document.getElementById("noteGrid");
const statusElement = document.getElementById("status");
const waveformChart = document.getElementById("waveformChart");
const spectrogramChart = document.getElementById("spectrogramChart");
const cellsByKey = new Map();

let audioContext = null;
let masterGain = null;
let partials = [];
let selectedNote = null;
let morphSettleTimer = null;
let audioAnimationId = null;
let waveformAnimationId = null;
let spectrogramColumns = [];

function midiNumber(noteIndex, octave) {
  return (octave + 1) * 12 + noteIndex;
}

function frequencyForNote(noteIndex, octave) {
  return 440 * 2 ** ((midiNumber(noteIndex, octave) - 69) / 12);
}

function gainForPartial(partialNumber) {
  return partialNumber <= AUDIBLE_PARTIAL_COUNT ? 1 : 0;
}

function lerp(fromValue, toValue, progress) {
  return fromValue + (toValue - fromValue) * progress;
}

function noteKey(note) {
  return `${note.noteIndex}-${note.octave}`;
}

function noteLabel(note) {
  return `${NOTE_NAMES[note.noteIndex]}${note.octave}`;
}

function createAudioGraph() {
  audioContext = new AudioContext();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);

  partials = Array.from({ length: PARTIAL_SLOT_COUNT }, (_, index) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.type = "sine";
    gainNode.gain.value = 0;
    oscillator.connect(gainNode);
    gainNode.connect(masterGain);
    oscillator.start();
    return { oscillator, gainNode, partialNumber: index + 1 };
  });
}

async function ensureAudioGraph() {
  if (!audioContext) {
    createAudioGraph();
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

function setBankToNote(note, atTime) {
  const baseFrequency = frequencyForNote(note.noteIndex, note.octave);
  for (const partial of partials) {
    partial.oscillator.frequency.setValueAtTime(baseFrequency * partial.partialNumber, atTime);
    partial.gainNode.gain.setValueAtTime(gainForPartial(partial.partialNumber), atTime);
  }
}

function rampMasterGain(now) {
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(MASTER_GAIN, now + 0.01);
  masterGain.gain.setValueAtTime(MASTER_GAIN, now + MOVE_DURATION_SECONDS);
  masterGain.gain.linearRampToValueAtTime(0, now + MOVE_DURATION_SECONDS + RELEASE_SECONDS);
}

function gainForVerticalLevel(partialNumber, level) {
  const lowerLevel = Math.floor(level);
  const upperLevel = Math.ceil(level);
  const levelProgress = level - lowerLevel;
  const lowerScale = 2 ** lowerLevel;
  const upperScale = 2 ** upperLevel;
  const lowerGain =
    partialNumber % lowerScale === 0 ? gainForPartial(partialNumber / lowerScale) : 0;
  const upperGain =
    partialNumber % upperScale === 0 ? gainForPartial(partialNumber / upperScale) : 0;
  return lerp(lowerGain, upperGain, levelProgress);
}

function partialStateForMove(fromNote, toNote, progress) {
  const lowerOctave = Math.min(fromNote.octave, toNote.octave);
  const baseFrequency = lerp(
    frequencyForNote(fromNote.noteIndex, lowerOctave),
    frequencyForNote(toNote.noteIndex, lowerOctave),
    progress,
  );
  const fromLevel = fromNote.octave - lowerOctave;
  const toLevel = toNote.octave - lowerOctave;
  const level = lerp(fromLevel, toLevel, progress);

  return {
    frequencies: Array.from(
      { length: PARTIAL_SLOT_COUNT },
      (_, index) => baseFrequency * (index + 1),
    ),
    gains: Array.from({ length: PARTIAL_SLOT_COUNT }, (_, index) =>
      gainForVerticalLevel(index + 1, level),
    ),
  };
}

function applyPartialState(partialState, now, rampSeconds) {
  for (const partial of partials) {
    const frequency = partialState.frequencies[partial.partialNumber - 1];
    const gain = partialState.gains[partial.partialNumber - 1];

    partial.oscillator.frequency.cancelScheduledValues(now);
    partial.oscillator.frequency.setValueAtTime(partial.oscillator.frequency.value, now);
    partial.oscillator.frequency.linearRampToValueAtTime(frequency, now + rampSeconds);
    partial.gainNode.gain.cancelScheduledValues(now);
    partial.gainNode.gain.setValueAtTime(partial.gainNode.gain.value, now);
    partial.gainNode.gain.linearRampToValueAtTime(gain, now + rampSeconds);
  }
}

function partialStateForNote(note) {
  const baseFrequency = frequencyForNote(note.noteIndex, note.octave);
  return {
    periodFrequency: baseFrequency,
    frequencies: Array.from(
      { length: PARTIAL_SLOT_COUNT },
      (_, index) => baseFrequency * (index + 1),
    ),
    gains: Array.from({ length: PARTIAL_SLOT_COUNT }, (_, index) => gainForPartial(index + 1)),
  };
}

function renderWaveform(partialState) {
  const x = [];
  const y = [];

  if (partialState) {
    for (let sampleIndex = 0; sampleIndex < WAVEFORM_SAMPLE_COUNT; sampleIndex++) {
      const t = (sampleIndex / (WAVEFORM_SAMPLE_COUNT - 1)) * WAVEFORM_TIME_SPAN_SECONDS;
      x.push(t * 1000);
      y.push(
        partialState.frequencies.reduce(
          (total, frequency, index) =>
            total + partialState.gains[index] * Math.sin(2 * Math.PI * frequency * t),
          0,
        ),
      );
    }
  }

  const maxAmplitude = y.length ? Math.max(...y.map((value) => Math.abs(value))) || 1 : 1;

  Plotly.react(
    waveformChart,
    [
      {
        x,
        y: y.map((value) => value / maxAmplitude),
        mode: "lines",
        line: { color: "#38bdf8", width: 2 },
        hoverinfo: "skip",
      },
    ],
    {
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      margin: { l: 34, r: 12, t: 12, b: 28 },
      xaxis: {
        title: { text: "ms", font: { size: 11, color: "#94a3b8" } },
        range: [0, WAVEFORM_TIME_SPAN_SECONDS * 1000],
        color: "#94a3b8",
        gridcolor: "#1f2937",
        zerolinecolor: "#334155",
      },
      yaxis: {
        range: [-1.05, 1.05],
        color: "#94a3b8",
        gridcolor: "#1f2937",
        zerolinecolor: "#334155",
        fixedrange: true,
      },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );
}

function spectrogramFrequencies() {
  return Array.from({ length: SPECTROGRAM_BIN_COUNT }, (_, index) => {
    const progress = index / (SPECTROGRAM_BIN_COUNT - 1);
    return SPECTROGRAM_MIN_HZ * (SPECTROGRAM_MAX_HZ / SPECTROGRAM_MIN_HZ) ** progress;
  });
}

function appendSpectrogramColumn(partialState) {
  const column = spectrogramFrequencies().map((frequency) => {
    let value = 0;
    for (let i = 0; i < partialState.frequencies.length; i += 1) {
      const gain = partialState.gains[i];
      if (!gain) continue;
      const cents = 1200 * Math.log2(frequency / partialState.frequencies[i]);
      value += gain * Math.exp(-0.5 * (cents / 35) ** 2);
    }
    return value;
  });
  spectrogramColumns.push(column);
  while (spectrogramColumns.length > SPECTROGRAM_COLUMN_COUNT) {
    spectrogramColumns.shift();
  }
}

function renderSpectrogram() {
  const frequencies = spectrogramFrequencies();
  Plotly.react(
    spectrogramChart,
    [
      {
        x: Array.from({ length: spectrogramColumns.length }, (_, index) => index),
        y: frequencies,
        z: frequencies.map((_, yIndex) => spectrogramColumns.map((column) => column[yIndex] ?? 0)),
        type: "heatmap",
        colorscale: "Viridis",
        showscale: false,
        hoverinfo: "skip",
      },
    ],
    {
      paper_bgcolor: "#050505",
      plot_bgcolor: "#050505",
      margin: { l: 42, r: 12, t: 12, b: 28 },
      xaxis: {
        range: [0, SPECTROGRAM_COLUMN_COUNT - 1],
        showticklabels: false,
        color: "#94a3b8",
        gridcolor: "#1f2937",
        zerolinecolor: "#334155",
      },
      yaxis: {
        type: "log",
        range: [Math.log10(SPECTROGRAM_MIN_HZ), Math.log10(SPECTROGRAM_MAX_HZ)],
        tickvals: [100, 200, 400, 800, 1600],
        ticktext: ["100", "200", "400", "800", "1600"],
        color: "#94a3b8",
        gridcolor: "#1f2937",
        zerolinecolor: "#334155",
        fixedrange: true,
      },
      showlegend: false,
    },
    { displayModeBar: false, responsive: true },
  );
}

function animateWaveform(fromNote, toNote) {
  window.cancelAnimationFrame(waveformAnimationId);

  if (!fromNote) {
    const partialState = partialStateForNote(toNote);
    renderWaveform(partialState);
    appendSpectrogramColumn(partialState);
    renderSpectrogram();
    return;
  }

  const startedAtMs = performance.now();
  let lastRenderedAtMs = -Infinity;
  const renderFrame = () => {
    const nowMs = performance.now();
    const progress = Math.min(1, (nowMs - startedAtMs) / (MOVE_DURATION_SECONDS * 1000));
    if (progress === 1 || nowMs - lastRenderedAtMs >= WAVEFORM_RENDER_INTERVAL_MS) {
      const partialState = partialStateForMove(fromNote, toNote, progress);
      renderWaveform(partialState);
      appendSpectrogramColumn(partialState);
      renderSpectrogram();
      lastRenderedAtMs = nowMs;
    }

    if (progress < 1) {
      waveformAnimationId = window.requestAnimationFrame(renderFrame);
    } else {
      renderWaveform(partialStateForNote(toNote));
    }
  };

  renderFrame();
}

async function playMove(toNote) {
  await ensureAudioGraph();
  const now = audioContext.currentTime;
  window.clearTimeout(morphSettleTimer);
  window.cancelAnimationFrame(audioAnimationId);

  if (!selectedNote) {
    setBankToNote(toNote, now);
  } else {
    const fromNote = selectedNote;
    const startedAtMs = performance.now();
    let lastAudioUpdateMs = -Infinity;
    const renderFrame = () => {
      const nowMs = performance.now();
      const progress = Math.min(1, (nowMs - startedAtMs) / (MOVE_DURATION_SECONDS * 1000));
      if (progress === 1 || nowMs - lastAudioUpdateMs >= AUDIO_UPDATE_INTERVAL_MS) {
        applyPartialState(
          partialStateForMove(fromNote, toNote, progress),
          audioContext.currentTime,
          AUDIO_RAMP_SECONDS,
        );
        lastAudioUpdateMs = nowMs;
      }

      if (progress < 1) {
        audioAnimationId = window.requestAnimationFrame(renderFrame);
      }
    };
    renderFrame();

    morphSettleTimer = window.setTimeout(
      () => {
        setBankToNote(toNote, audioContext.currentTime);
      },
      (MOVE_DURATION_SECONDS + RELEASE_SECONDS) * 1000,
    );
  }

  rampMasterGain(now);
  animateWaveform(selectedNote, toNote);
}

function updateSelection(note) {
  if (selectedNote) {
    cellsByKey.get(noteKey(selectedNote))?.classList.remove("selected");
  }
  selectedNote = note;
  cellsByKey.get(noteKey(selectedNote))?.classList.add("selected");
  statusElement.textContent = `Selected ${noteLabel(note)}.`;
}

async function selectNote(note) {
  await playMove(note);
  updateSelection(note);
}

function moveSelection(noteIndexDelta, octaveDelta) {
  if (!selectedNote) {
    selectNote({ noteIndex: 0, octave: 3 });
    return;
  }

  const noteIndex = selectedNote.noteIndex + noteIndexDelta;
  const octave = selectedNote.octave + octaveDelta;
  if (noteIndex < 0 || noteIndex >= NOTE_NAMES.length || octave < 2 || octave > 6) {
    return;
  }
  selectNote({ noteIndex, octave });
}

function buildGrid() {
  noteGrid.append(document.createElement("div"));
  for (const noteName of NOTE_NAMES) {
    const label = document.createElement("div");
    label.className = "axis-label";
    label.textContent = noteName;
    noteGrid.append(label);
  }

  for (const octave of OCTAVES) {
    const octaveIndex = OCTAVES.indexOf(octave);
    const octaveLabel = document.createElement("div");
    octaveLabel.className = "axis-label";
    octaveLabel.textContent = String(octave);
    noteGrid.append(octaveLabel);

    for (let noteIndex = 0; noteIndex < NOTE_NAMES.length; noteIndex++) {
      const note = { noteIndex, octave };
      const slot = document.createElement("div");
      slot.className = "note-slot";
      if (noteIndex === 0) slot.classList.add("first-column");
      if (noteIndex === NOTE_NAMES.length - 1) slot.classList.add("last-column");
      if (octaveIndex === 0) slot.classList.add("first-row");
      if (octaveIndex === OCTAVES.length - 1) slot.classList.add("last-row");
      const button = document.createElement("button");
      button.className = "note-cell";
      button.type = "button";
      button.ariaLabel = `${NOTE_NAMES[noteIndex]}${octave}`;
      button.addEventListener("click", () => selectNote(note));
      slot.append(button);
      noteGrid.append(slot);
      cellsByKey.set(noteKey(note), button);
    }
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveSelection(-1, 0);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    moveSelection(1, 0);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(0, 1);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(0, -1);
  }
});

buildGrid();
renderWaveform(null);
renderSpectrogram();
