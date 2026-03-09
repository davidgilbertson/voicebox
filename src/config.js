import { readActiveView } from "./AppShell/config.js";
import {
  readScaleBpm,
  readScaleGestureHelpDismissed,
  readScaleMaxNote,
  readScaleMinNote,
  readScaleSelectedName,
} from "./ScalesPage/config.js";
import {
  readAutoPauseOnSilence,
  readHighResSpectrogram,
  readHalfResolutionCanvas,
  readKeepRunningInBackground,
  readMinVolumeThreshold,
  readPitchMaxNote,
  readPitchMinNote,
  readPitchLineColorMode,
  readRunAt30Fps,
  readSpectrogramMaxHz,
  readSpectrogramMinHz,
} from "./Recorder/config.js";

export function readConfig() {
  return {
    app: {
      activeView: readActiveView(),
    },
    shared: {
      keepRunningInBackground: readKeepRunningInBackground(),
    },
    recorder: {
      autoPauseOnSilence: readAutoPauseOnSilence(),
      runAt30Fps: readRunAt30Fps(),
      halfResolutionCanvas: readHalfResolutionCanvas(),
      highResSpectrogram: readHighResSpectrogram(),
      minVolumeThreshold: readMinVolumeThreshold(),
      pitchMinNote: readPitchMinNote(),
      pitchMaxNote: readPitchMaxNote(),
      pitchLineColorMode: readPitchLineColorMode(),
      spectrogramMinHz: readSpectrogramMinHz(),
      spectrogramMaxHz: readSpectrogramMaxHz(),
    },
    scales: {
      bpm: readScaleBpm(),
      scaleMinNote: readScaleMinNote(),
      scaleMaxNote: readScaleMaxNote(),
      selectedScaleName: readScaleSelectedName(),
      gestureHelpDismissed: readScaleGestureHelpDismissed(),
    },
  };
}
