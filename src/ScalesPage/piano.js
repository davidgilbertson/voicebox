import Soundfont from "soundfont-player";

let audioContext = null;
let piano = null;
let loadingPianoPromise = null;
let resumeAudioPromise = null;
let pianoGain = 1;
let metronomeTickBuffer = null;
let loadingMetronomeTickPromise = null;
const playedNoteListeners = new Set();
// Downloaded from: https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3.js
const LOCAL_PIANO_SOUNDFONT_URL = "/soundfonts/acoustic_grand_piano-mp3.js";
const METRONOME_TICK_URL = "/metronome-tick.wav";

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

async function ensureAudioReady() {
  ensureAudioContext();
  if (audioContext.state === "suspended") {
    if (!resumeAudioPromise) {
      resumeAudioPromise = audioContext.resume()
          .catch(() => false)
          .finally(() => {
            resumeAudioPromise = null;
          });
    }
    const resumed = await resumeAudioPromise;
    if (resumed === false || audioContext.state === "suspended") {
      return false;
    }
  }
  return true;
}

function computePeakNormalizationGain(instrument) {
  const buffers = instrument && instrument.buffers;
  if (!buffers || typeof buffers !== "object") {
    return 1;
  }
  const entries = Object.values(buffers);
  let globalPeak = 0;
  for (const buf of entries) {
    if (!buf) continue;
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
      }
    }
    if (peak > globalPeak) globalPeak = peak;
  }
  return globalPeak > 0 ? 1 / globalPeak : 1;
}


export async function ensurePianoLoaded() {
  if (piano) return piano;
  ensureAudioContext();
  if (!loadingPianoPromise) {
    loadingPianoPromise = Soundfont.instrument(audioContext, "acoustic_grand_piano", {
      nameToUrl: (name) => {
        if (name === "acoustic_grand_piano") return LOCAL_PIANO_SOUNDFONT_URL;
        return Soundfont.nameToUrl(name);
      },
    })
        .then((instrument) => {
          piano = instrument;
          pianoGain = computePeakNormalizationGain(instrument);
          return piano;
        })
        .finally(() => {
          loadingPianoPromise = null;
        });
  }
  return loadingPianoPromise;
}

export async function ensurePianoReadyForPlayback() {
  const ready = await ensureAudioReady();
  if (!ready) return false;
  await ensurePianoLoaded();
  return true;
}

export async function ensureMetronomeTickLoaded() {
  if (import.meta.env.MODE === "test") return null;
  if (metronomeTickBuffer) return metronomeTickBuffer;
  ensureAudioContext();
  if (!loadingMetronomeTickPromise) {
    loadingMetronomeTickPromise = fetch(METRONOME_TICK_URL, {cache: "force-cache"})
        .then((response) => {
          if (!response.ok) throw new Error("Failed to load metronome sample");
          return response.arrayBuffer();
        })
        .then((bytes) => audioContext.decodeAudioData(bytes))
        .then((decoded) => {
          metronomeTickBuffer = decoded;
          return metronomeTickBuffer;
        })
        .finally(() => {
          loadingMetronomeTickPromise = null;
        });
  }
  return loadingMetronomeTickPromise;
}

export async function playMetronomeTick() {
  const ready = await ensureAudioReady();
  if (!ready) return;
  const sampleBuffer = await ensureMetronomeTickLoaded();
  if (!sampleBuffer) return;

  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(1, audioContext.currentTime);
  gainNode.connect(audioContext.destination);

  const source = audioContext.createBufferSource();
  source.buffer = sampleBuffer;
  source.connect(gainNode);
  source.start(audioContext.currentTime);

  source.addEventListener("ended", () => {
    source.disconnect();
    gainNode.disconnect();
  }, {once: true});
}

/**
 * Play a note on the loaded piano instrument.
 * `note` can be either a MIDI note number (e.g. 60) or a note name string (e.g. "C4").
 */
export async function playNote(note, durationSeconds, {emitHighlight = true} = {}) {
  const ready = await ensurePianoReadyForPlayback();
  if (!ready) return null;
  const instrument = await ensurePianoLoaded();

  const startedNote = instrument.play(note, audioContext.currentTime, {
    duration: durationSeconds,
    gain: pianoGain,
  });
  if (emitHighlight) {
    for (const listener of playedNoteListeners) {
      listener({note, durationSeconds});
    }
  }
  return startedNote;
}

export function subscribeToPlayedNotes(listener) {
  playedNoteListeners.add(listener);
  return () => {
    playedNoteListeners.delete(listener);
  };
}
