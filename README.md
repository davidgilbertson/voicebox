# Voicebox

Voicebox is a microphone-based voice training app for real-time pitch feedback and guided scale practice.

There are four pages + settings

## Scales

- Plays guided scale patterns.
- Choose pattern and BPM.
- By default, scales will start at the bottom of your range (as defined in settings) and increment up one semitone each repeat.
- When the scale repeats reach the top of your range they will start descending again.
- Gesture area controls repeat direction:
  - Swipe up: shift up a semitone on repeat
  - Swipe down: shift down a semitone on repeat
  - Swipe right: repeat at same pitch
- Swipe repeatedly if you feel like it.
- Tap the gesture area to play/pause.
- There's also a piano to play arbitrary notes.
- In the settings you can define your vocal range. That affects the visible piano keys and the limits for the scales.

## Spectrogram

- Shows a live frequency heatmap of your voice.
- Useful for seeing harmonics, noise, and overall tone energy over time.
- You can limit the displayed frequency range and apply background-noise subtraction in settings.
- If you have a constant background noise (e.g. air conditioner) you can record a noise profile in settings which will be subtracted from your voice.
- Tap the screen to pause/resume.

## Pitch

- Shows your detected pitch trace over time.
- You can define the visible pitch range in settings.
- Tap the screen to pause/resume.

## Vibrato

- Shows pitch movement plus live vibrato-rate readout (Hz).
- Follows your vibrato, zoomed right in so you can see the shape clearly.
- Includes a target zone on the rate bar to help you stay in a desired vibrato range.
- Tap the screen to pause/resume.

---

The Spectrogram, Pitch, and Vibrato pages are all linked, so you can switch between them to see different views of your voice, while playing or while paused.

## Settings

### General

- **Keep running in background**: continue recording when app loses focus.
- **Auto pause on silence**: pauses timeline writes during silence.

### Scales Page

- **Min / Max**: note range used for scale playback.

### Spectrogram Page

- **Min / Max**: frequency range shown on the spectrogram (Hz).
- **Hold to sample**: captures background noise profile.
- **Clear**: removes saved noise profile.

### Pitch Page

- **Min / Max**: note range shown on the pitch chart.

### Performance

- **Run at 30 FPS**: lowers frame rate to reduce battery use. This makes quite a big difference to battery use and is barely noticable.
- **Half-resolution canvas**: lowers chart render resolution for lower CPU/GPU use.
- **Battery use**: estimated battery drain rate (`%/min`). Shows `NA` when battery stats are unavailable. This reading only makes sense if Voicebox is the only app you're using and it stays active. It updates once per minute.
