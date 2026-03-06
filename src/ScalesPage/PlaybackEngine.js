import {
  readScaleBpm,
  readScaleMaxNote,
  readScaleMinNote,
  readScaleSelectedName,
  SCALE_BPM_MAX,
  SCALE_BPM_MIN,
  writeScaleBpm,
  writeScaleSelectedName,
} from "./config.js";
import { clamp } from "../tools.js";
import { noteNameToMidi } from "../pitchScale.js";
import {
  ensureMetronomeTickLoaded,
  ensurePianoLoaded,
  playMetronomeTick,
  playNote,
} from "./piano.js";

/**
 * Terminology
 * Pattern: a sequence of values that are played from some base note
 * Set: one repeat of a pattern, starting at a particular note
 * Root note: the note that the pattern starts on
 * Cue: a short lead-in sound before the next set starts
 * Session: the continued loop of playing one pattern, resting, and repeating
 *   (with an increased, decreased, or the same root note)
 */
const SEMITONE_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0];
const PENTATONIC_PATTERN = [0, 2, 4, 7, 9, 7, 4, 2, 0, 2, 4, 7, 9, 7, 4, 2, 0];
const MAJOR_PATTERN = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
const TWO_UP_ONE_DOWN_PATTERN = [
  0, 4, 2, 5, 4, 7, 5, 9, 7, 11, 9, 12, 9, 11, 7, 9, 5, 7, 4, 5, 2, 4, 0,
];
export const SCALE_PATTERNS = {
  Semitones: SEMITONE_PATTERN,
  Pentatonic: PENTATONIC_PATTERN,
  Major: MAJOR_PATTERN,
  "2 Up 1 Down": TWO_UP_ONE_DOWN_PATTERN,
};
const RAPID_VERTICAL_SWIPE_MS = 500;
const MIDI_MIN = 21;
const MIDI_MAX = 108;

let playbackEngineSingleton = null;

function patternOffsetBounds(pattern) {
  let min = pattern[0] ?? 0;
  let max = pattern[0] ?? 0;
  for (let i = 1; i < pattern.length; i += 1) {
    min = Math.min(min, pattern[i]);
    max = Math.max(max, pattern[i]);
  }
  return { min, max };
}

function buildSetTimeline(pattern) {
  return ["cue", "rest", "rest", ...pattern, "rest", "rest", "rest", "rest"];
}

function semitoneDeltaForRepeatDirection(repeatDirection) {
  return repeatDirection === "up" ? 1 : repeatDirection === "down" ? -1 : 0;
}

function sanitizeScaleName(name) {
  return Object.hasOwn(SCALE_PATTERNS, name) ? name : "Semitones";
}

export class PlaybackEngine {
  constructor() {
    this.listeners = new Set();
    const initialScaleMin = readScaleMinNote();
    const initialScaleMax = readScaleMaxNote();
    const initialScaleName = sanitizeScaleName(readScaleSelectedName());
    const initialBpm = clamp(readScaleBpm(), SCALE_BPM_MIN, SCALE_BPM_MAX);
    this.state = {
      ui: {
        bpm: initialBpm,
        selectedScaleName: initialScaleName,
        repeatDirection: "up",
        isPlaying: false,
        isMetronomeEnabled: false,
        isPianoReady: false,
        gestureFlashSignal: null,
      },
      keepRunningInBackground: false,
      isForeground: true,
      activeNotes: [],
      playbackTimeoutId: 0,
      timelineIndex: 0,
      nextPulseAtMs: 0,
      stepInFlight: false,
      lastStepAtMs: 0,
      startupPriming: false,
      rapidVerticalSwipe: {
        direction: null,
        atMs: 0,
        count: 0,
      },
      setTimeline: buildSetTimeline(SCALE_PATTERNS[initialScaleName]),
      patternOffsetBounds: patternOffsetBounds(SCALE_PATTERNS[initialScaleName]),
      currentSetRootMidi: clamp(noteNameToMidi(initialScaleMin) ?? MIDI_MIN, MIDI_MIN, MIDI_MAX),
      scaleMinMidi: clamp(noteNameToMidi(initialScaleMin) ?? MIDI_MIN, MIDI_MIN, MIDI_MAX),
      scaleMaxMidi: clamp(noteNameToMidi(initialScaleMax) ?? MIDI_MAX, MIDI_MIN, MIDI_MAX),
    };

    if (this.state.scaleMinMidi > this.state.scaleMaxMidi) {
      const nextMin = this.state.scaleMaxMidi;
      this.state.scaleMaxMidi = this.state.scaleMinMidi;
      this.state.scaleMinMidi = nextMin;
      this.state.currentSetRootMidi = this.state.scaleMinMidi;
    }

    // Warm up playback assets as soon as engine is created.
    ensurePianoLoaded()
      .then(() => {
        this.setUi({ isPianoReady: true });
      })
      .catch(() => {
        this.setUi({ isPianoReady: false });
      });
    ensureMetronomeTickLoaded().catch(() => {});
  }

  setUi = (nextPartial) => {
    this.state.ui = { ...this.state.ui, ...nextPartial };
    for (const listener of this.listeners) {
      listener(this.state.ui);
    }
  };

  stopAllNotes = () => {
    for (let i = 0; i < this.state.activeNotes.length; i += 1) {
      this.state.activeNotes[i]?.stop?.();
    }
    this.state.activeNotes = [];
  };

  trackStartedNote = (startedNote) => {
    if (!startedNote?.stop) return false;
    this.state.activeNotes.push(startedNote);
    if (this.state.activeNotes.length > 16) {
      this.state.activeNotes.shift()?.stop?.();
    }
    return true;
  };

  clearPulseTimeout = () => {
    if (!this.state.playbackTimeoutId) return;
    window.clearTimeout(this.state.playbackTimeoutId);
    this.state.playbackTimeoutId = 0;
  };

  stopPulseLoop = () => {
    this.clearPulseTimeout();
    this.state.nextPulseAtMs = 0;
    this.state.stepInFlight = false;
    this.state.lastStepAtMs = 0;
    this.state.startupPriming = false;
  };

  stopPlayback = () => {
    this.stopPulseLoop();
    this.stopAllNotes();
  };

  schedulePulseAt = (nextAtMs) => {
    this.clearPulseTimeout();
    this.state.nextPulseAtMs = nextAtMs;
    const delayMs = Math.max(0, nextAtMs - performance.now());
    this.state.playbackTimeoutId = window.setTimeout(this.runPulse, delayMs);
  };

  reschedulePulseFromLastStep = () => {
    if (!this.state.lastStepAtMs) return;
    const stepMs = (60 / this.state.ui.bpm) * 1000;
    this.schedulePulseAt(this.state.lastStepAtMs + stepMs);
  };

  normalizeCurrentSetRootMidi = () => {
    const minAllowedRootMidi = Math.max(
      this.state.scaleMinMidi,
      this.state.scaleMinMidi - this.state.patternOffsetBounds.min,
    );
    const maxAllowedRootMidi = Math.min(
      this.state.scaleMaxMidi,
      this.state.scaleMaxMidi - this.state.patternOffsetBounds.max,
    );

    if (minAllowedRootMidi > maxAllowedRootMidi) {
      this.state.currentSetRootMidi = this.state.scaleMinMidi;
      return;
    }

    this.state.currentSetRootMidi = clamp(
      this.state.currentSetRootMidi,
      minAllowedRootMidi,
      maxAllowedRootMidi,
    );
  };

  restartPulseLoop = (primeFirstPulse = false) => {
    this.state.startupPriming = primeFirstPulse;
    const stepMs = (60 / this.state.ui.bpm) * 1000;
    this.schedulePulseAt(performance.now() + stepMs);
  };

  setRepeatDirectionIfChanged = (nextRepeatDirection) => {
    if (this.state.ui.repeatDirection === nextRepeatDirection) return;
    this.setUi({ repeatDirection: nextRepeatDirection });
  };

  flashGestureDirection = (direction) => {
    if (direction !== "up" && direction !== "down" && direction !== "right") return;
    this.setUi({
      gestureFlashSignal: {
        direction,
        id: (this.state.ui.gestureFlashSignal?.id ?? 0) + 1,
      },
    });
  };

  playStep = async () => {
    if (!this.state.ui.isPlaying) return false;
    const timelineEntry = this.state.setTimeline[this.state.timelineIndex];
    const stepDuration = 60 / this.state.ui.bpm;
    let noteWasPlayed = false;

    if (timelineEntry === "cue") {
      const cueRootMidi = clamp(
        this.state.currentSetRootMidi,
        this.state.scaleMinMidi,
        this.state.scaleMaxMidi,
      );
      try {
        const startedNote = await playNote(cueRootMidi, stepDuration * 2);
        noteWasPlayed = this.trackStartedNote(startedNote);
      } catch {}
    } else if (timelineEntry !== "rest") {
      const noteMidi = clamp(
        this.state.currentSetRootMidi + timelineEntry,
        this.state.scaleMinMidi,
        this.state.scaleMaxMidi,
      );
      try {
        const startedNote = await playNote(noteMidi, stepDuration);
        noteWasPlayed = this.trackStartedNote(startedNote);
      } catch {}
    }

    const nextIndex = (this.state.timelineIndex + 1) % this.state.setTimeline.length;
    const nextStartsSet = nextIndex === 0;
    this.state.timelineIndex = nextIndex;

    if (!nextStartsSet) return noteWasPlayed;
    if (this.state.scaleMinMidi === this.state.scaleMaxMidi) {
      this.setRepeatDirectionIfChanged("stay");
      this.state.currentSetRootMidi = this.state.scaleMinMidi;
      return noteWasPlayed;
    }

    let nextDirection = this.state.ui.repeatDirection;
    let nextRootMidi =
      this.state.currentSetRootMidi + semitoneDeltaForRepeatDirection(nextDirection);
    const patternMinOffset = this.state.patternOffsetBounds.min;
    const patternMaxOffset = this.state.patternOffsetBounds.max;

    if (nextDirection === "up" && nextRootMidi + patternMaxOffset > this.state.scaleMaxMidi) {
      nextDirection = "down";
      nextRootMidi = this.state.currentSetRootMidi + semitoneDeltaForRepeatDirection(nextDirection);
      if (nextRootMidi + patternMinOffset < this.state.scaleMinMidi) {
        nextRootMidi = this.state.currentSetRootMidi;
      }
    } else if (
      nextDirection === "down" &&
      nextRootMidi + patternMinOffset < this.state.scaleMinMidi
    ) {
      nextDirection = "up";
      nextRootMidi = this.state.currentSetRootMidi + semitoneDeltaForRepeatDirection(nextDirection);
      if (nextRootMidi + patternMaxOffset > this.state.scaleMaxMidi) {
        nextRootMidi = this.state.currentSetRootMidi;
      }
    }

    if (nextDirection !== this.state.ui.repeatDirection) {
      this.flashGestureDirection(nextDirection);
    }
    this.setRepeatDirectionIfChanged(nextDirection);
    this.state.currentSetRootMidi = clamp(
      nextRootMidi,
      this.state.scaleMinMidi,
      this.state.scaleMaxMidi,
    );
    return noteWasPlayed;
  };

  shouldRunNow = () => {
    const allowPlayback = this.state.keepRunningInBackground || this.state.isForeground;
    return allowPlayback && (this.state.ui.isPlaying || this.state.ui.isMetronomeEnabled);
  };

  runPulse = async () => {
    if (!this.shouldRunNow()) {
      this.stopPulseLoop();
      return;
    }
    if (this.state.stepInFlight) return;
    this.state.stepInFlight = true;
    const primingFirstPulse = this.state.startupPriming;
    this.state.lastStepAtMs = performance.now();
    try {
      const noteWasPlayed = await this.playStep();
      if (this.state.ui.isMetronomeEnabled) {
        const metronomeTickPromise = noteWasPlayed
          ? playMetronomeTick({ duck: true })
          : playMetronomeTick();
        await metronomeTickPromise.catch(() => {});
      }
    } finally {
      this.state.stepInFlight = false;
      if (primingFirstPulse) {
        this.state.startupPriming = false;
        const stepMs = (60 / this.state.ui.bpm) * 1000;
        this.schedulePulseAt(performance.now() + stepMs);
        return;
      }
      this.reschedulePulseFromLastStep();
    }
  };

  syncPulseLoopForPolicy = () => {
    const allowPlayback = this.state.keepRunningInBackground || this.state.isForeground;
    if (!allowPlayback || (!this.state.ui.isPlaying && !this.state.ui.isMetronomeEnabled)) {
      this.stopPulseLoop();
      return;
    }
    if (!this.state.nextPulseAtMs) {
      this.restartPulseLoop(true);
    }
  };

  syncNotePlaybackForPlayingOrPolicy = () => {
    const allowPlayback = this.state.keepRunningInBackground || this.state.isForeground;
    if (!this.state.ui.isPlaying || !allowPlayback) {
      this.stopAllNotes();
      return;
    }
    this.state.timelineIndex = 0;
    this.state.stepInFlight = false;
    this.state.lastStepAtMs = 0;
    this.restartPulseLoop(this.state.startupPriming);
  };

  updateSettings = ({ scaleMinNote, scaleMaxNote, keepRunningInBackground, isForeground }) => {
    if (typeof keepRunningInBackground === "boolean") {
      this.state.keepRunningInBackground = keepRunningInBackground;
    }
    if (typeof isForeground === "boolean") {
      this.state.isForeground = isForeground;
    }
    if (scaleMinNote || scaleMaxNote) {
      const nextMin = clamp(
        noteNameToMidi(scaleMinNote ?? readScaleMinNote()) ?? MIDI_MIN,
        MIDI_MIN,
        MIDI_MAX,
      );
      const nextMax = clamp(
        noteNameToMidi(scaleMaxNote ?? readScaleMaxNote()) ?? MIDI_MAX,
        MIDI_MIN,
        MIDI_MAX,
      );
      this.state.scaleMinMidi = Math.min(nextMin, nextMax);
      this.state.scaleMaxMidi = Math.max(nextMin, nextMax);
      if (!this.state.ui.isPlaying) {
        this.state.currentSetRootMidi = this.state.scaleMinMidi;
      }
      this.normalizeCurrentSetRootMidi();
    }
    this.syncPulseLoopForPolicy();
    this.syncNotePlaybackForPlayingOrPolicy();
  };

  setBpm = (nextBpm) => {
    const bpm = clamp(nextBpm, SCALE_BPM_MIN, SCALE_BPM_MAX);
    if (bpm === this.state.ui.bpm) return;
    this.setUi({ bpm });
    writeScaleBpm(bpm);
    if (this.state.nextPulseAtMs) {
      this.reschedulePulseFromLastStep();
    }
  };

  setSelectedScaleName = (nextScaleName) => {
    const selectedScaleName = sanitizeScaleName(nextScaleName);
    if (selectedScaleName === this.state.ui.selectedScaleName) return;
    this.setUi({ selectedScaleName });
    writeScaleSelectedName(selectedScaleName);
    const pattern = SCALE_PATTERNS[selectedScaleName];
    this.state.setTimeline = buildSetTimeline(pattern);
    this.state.patternOffsetBounds = patternOffsetBounds(pattern);
    this.normalizeCurrentSetRootMidi();
    this.state.timelineIndex = 0;
  };

  setIsPlaying = (isPlaying) => {
    const nextIsPlaying = Boolean(isPlaying);
    if (nextIsPlaying === this.state.ui.isPlaying) return;
    this.setUi({ isPlaying: nextIsPlaying });
    this.syncPulseLoopForPolicy();
    this.syncNotePlaybackForPlayingOrPolicy();
  };

  togglePlaying = () => {
    if (!this.state.ui.isPianoReady) return;
    this.setIsPlaying(!this.state.ui.isPlaying);
  };

  setIsMetronomeEnabled = (isMetronomeEnabled) => {
    const nextIsMetronomeEnabled = Boolean(isMetronomeEnabled);
    if (nextIsMetronomeEnabled === this.state.ui.isMetronomeEnabled) return;
    this.setUi({ isMetronomeEnabled: nextIsMetronomeEnabled });
    this.syncPulseLoopForPolicy();
  };

  toggleMetronome = () => {
    this.setIsMetronomeEnabled(!this.state.ui.isMetronomeEnabled);
  };

  onGestureSwipe = (direction) => {
    if (direction === "right") {
      this.state.rapidVerticalSwipe.direction = null;
      this.state.rapidVerticalSwipe.count = 0;
      this.setRepeatDirectionIfChanged("stay");
      return;
    }
    if (direction === "left") {
      this.state.rapidVerticalSwipe.direction = null;
      this.state.rapidVerticalSwipe.count = 0;
      return;
    }
    if (direction !== "up" && direction !== "down") return;
    const nowMs = performance.now();
    const rapid = this.state.rapidVerticalSwipe;
    const isSameDirection = rapid.direction === direction;
    const isWithinRapidWindow = nowMs - rapid.atMs <= RAPID_VERTICAL_SWIPE_MS;
    rapid.count = isSameDirection && isWithinRapidWindow ? rapid.count + 1 : 1;
    rapid.direction = direction;
    rapid.atMs = nowMs;
    this.setRepeatDirectionIfChanged(direction);
    if (this.state.ui.isPlaying && rapid.count >= 2) {
      const nextRootMidi =
        this.state.currentSetRootMidi + semitoneDeltaForRepeatDirection(direction);
      this.state.currentSetRootMidi = clamp(
        nextRootMidi,
        this.state.scaleMinMidi,
        this.state.scaleMaxMidi,
      );
      this.state.timelineIndex = 0;
      this.playStep();
      this.restartPulseLoop(false);
    }
  };

  onPianoKeyPress = (midi) => {
    if (!this.state.ui.isPlaying || typeof midi !== "number") return;
    if (midi + this.state.patternOffsetBounds.max > this.state.scaleMaxMidi) return;
    this.state.currentSetRootMidi = clamp(midi, this.state.scaleMinMidi, this.state.scaleMaxMidi);
    this.state.timelineIndex = 0;
    this.playStep();
    this.restartPulseLoop(false);
  };

  resetForInactivePage = () => {
    this.stopPlayback();
    this.state.timelineIndex = 0;
    this.state.currentSetRootMidi = this.state.scaleMinMidi;
    this.state.rapidVerticalSwipe.direction = null;
    this.state.rapidVerticalSwipe.count = 0;
    this.setUi({
      isPlaying: false,
      isMetronomeEnabled: false,
      repeatDirection: "up",
    });
  };

  stop = () => {
    this.stopPlayback();
  };

  destroy = () => {
    this.stopPlayback();
    this.listeners.clear();
  };

  subscribeUi = (listener) => {
    this.listeners.add(listener);
    listener(this.state.ui);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getUiSnapshot = () => this.state.ui;
}

export function getPlaybackEngine() {
  if (!playbackEngineSingleton) {
    playbackEngineSingleton = new PlaybackEngine();
  }
  return playbackEngineSingleton;
}

if (import.meta.env.MODE === "test") {
  globalThis.__resetPlaybackEngineSingletonForTests = () => {
    if (!playbackEngineSingleton) return;
    playbackEngineSingleton.destroy();
    playbackEngineSingleton = null;
  };
}
