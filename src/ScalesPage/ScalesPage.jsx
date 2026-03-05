import { useEffect, useState } from "react";
import { Metronome } from "lucide-react";
import StepperControl from "../components/StepperControl.jsx";
import Select from "../components/Select.jsx";
import Piano from "./Piano.jsx";
import GestureArea from "./GestureArea.jsx";
import {
  readScaleGestureHelpDismissed,
  SCALE_BPM_MAX,
  SCALE_BPM_MIN,
  readScaleMaxNote,
  readScaleMinNote,
  writeScaleGestureHelpDismissed,
} from "./config.js";
import { SCALE_PATTERNS } from "./PlaybackEngine.js";

export default function ScalesPage({
  scaleMinNote = readScaleMinNote(),
  scaleMaxNote = readScaleMaxNote(),
  keepRunningInBackground = false,
  isForeground = true,
  engine,
}) {
  const [engineUi, setEngineUi] = useState(() => engine.getUiSnapshot());
  const [showGestureHelp, setShowGestureHelp] = useState(() => !readScaleGestureHelpDismissed());

  useEffect(() => engine.subscribeUi(setEngineUi), [engine]);

  useEffect(() => {
    engine.updateSettings({
      scaleMinNote,
      scaleMaxNote,
      keepRunningInBackground,
      isForeground,
    });
  }, [engine, isForeground, keepRunningInBackground, scaleMaxNote, scaleMinNote]);

  const onDismissGestureHelp = () => {
    setShowGestureHelp(false);
    writeScaleGestureHelpDismissed(true);
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className="min-h-0 w-32 shrink-0">
        <Piano minNote={scaleMinNote} maxNote={scaleMaxNote} onKeyPress={engine.onPianoKeyPress} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 py-4 select-none">
        <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:gap-4 xl:flex-nowrap">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-4">
            <Select
              value={engineUi.selectedScaleName}
              onChange={(event) => engine.setSelectedScaleName(event.target.value)}
              className="h-16 w-full rounded-md border-0 bg-slate-800/80 pr-10 pl-4 text-base font-semibold text-slate-100 focus:outline-none md:w-auto md:leading-none"
              containerClassName="w-full md:w-auto"
              ariaLabel="Scale pattern"
            >
              {Object.keys(SCALE_PATTERNS).map((scaleName) => (
                <option
                  key={scaleName}
                  value={scaleName}
                  className="bg-slate-900 font-normal text-slate-100"
                >
                  {scaleName}
                </option>
              ))}
            </Select>

            <div className="flex items-center gap-2 md:gap-4">
              <div className="w-full max-w-40 md:w-auto md:max-w-none">
                <StepperControl
                  size="large"
                  units="BPM"
                  value={engineUi.bpm}
                  onDecrement={() => engine.setBpm(Math.max(SCALE_BPM_MIN, engineUi.bpm - 10))}
                  onIncrement={() => engine.setBpm(Math.min(SCALE_BPM_MAX, engineUi.bpm + 10))}
                  decrementDisabled={engineUi.bpm <= SCALE_BPM_MIN}
                  incrementDisabled={engineUi.bpm >= SCALE_BPM_MAX}
                  decrementAriaLabel="Decrease scales BPM"
                  incrementAriaLabel="Increase scales BPM"
                  valueClassName="min-w-[4ch] text-center text-base font-semibold text-slate-100"
                  contentWidth="5ch"
                />
              </div>
              <button
                type="button"
                onClick={engine.toggleMetronome}
                aria-pressed={engineUi.isMetronomeEnabled}
                aria-label={engineUi.isMetronomeEnabled ? "Disable metronome" : "Enable metronome"}
                className={`ml-auto inline-flex h-16 w-16 items-center justify-center rounded-md md:ml-0 ${
                  engineUi.isMetronomeEnabled
                    ? "bg-amber-400 text-amber-950"
                    : "bg-slate-800/80 text-slate-300"
                }`}
              >
                <Metronome aria-hidden="true" className="size-7" />
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={engine.togglePlaying}
            disabled={!engineUi.isPianoReady}
            className={`h-16 w-full rounded-md px-4 text-lg font-semibold md:w-auto md:min-w-48 md:px-8 xl:ml-auto ${
              engineUi.isPlaying ? "bg-amber-400 text-amber-950" : "bg-blue-400 text-slate-950"
            } disabled:opacity-50`}
          >
            {engineUi.isPlaying ? "Pause" : "Play"}
          </button>
        </div>

        <GestureArea
          testId="scales-gesture-area"
          className="relative flex min-h-0 flex-1 touch-none items-center justify-center rounded-md"
          onTap={engine.togglePlaying}
          onSwipe={engine.onGestureSwipe}
          externalFlashSignal={engineUi.gestureFlashSignal}
          showHelp={showGestureHelp}
          helpContent={
            <div
              className="h-full w-full rounded-md border border-slate-700 bg-slate-900/95 p-3 text-sm text-slate-200 shadow-xl"
              data-no-gesture-tap
            >
              <div className="text-base font-semibold text-slate-100">Gestures</div>
              <div className="mt-1 leading-relaxed">
                In this area, use gestures to control what happens when the scale repeats: swipe up
                to shift up a semitone, swipe down to shift down, or swipe right to repeat at the
                same pitch.
              </div>
              <div className="mt-1 leading-relaxed">
                Swipe up or down repeatedly to quickly move through the range.
              </div>
              <div className="mt-1 leading-relaxed text-slate-300">
                Tap empty space in this area to play or pause.
              </div>
              <button
                type="button"
                onClick={onDismissGestureHelp}
                className="mt-2 rounded-md bg-blue-400 px-3 py-1.5 text-xs font-semibold text-slate-950"
                data-no-gesture-tap
              >
                Got it
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
