import Soundfont from "soundfont-player";

let audioContext = null;
let piano = null;
let loadingPianoPromise = null;
let resumeAudioPromise = null;
let pianoGain = 1;
const playedNoteListeners = new Set();

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
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
    loadingPianoPromise = Soundfont.instrument(audioContext, "acoustic_grand_piano")
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
  ensureAudioContext();
  if (!audioContext) return false;
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
  await ensurePianoLoaded();
  return audioContext.state !== "suspended";
}

/**
 * Play a note on the loaded piano instrument.
 * `note` can be either a MIDI note number (e.g. 60) or a note name string (e.g. "C4").
 */
export async function playNote(note, durationSeconds, {emitHighlight = true} = {}) {
  const ready = await ensurePianoReadyForPlayback();
  if (!ready) return null;
  const instrument = await ensurePianoLoaded();
  if (!audioContext) return null;

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
