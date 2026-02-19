import {Minus, Plus} from "lucide-react";

export default function StepperControl({
                                         value,
                                         onDecrement,
                                         onIncrement,
                                         decrementDisabled = false,
                                         incrementDisabled = false,
                                         decrementAriaLabel = "Decrease value",
                                         incrementAriaLabel = "Increase value",
                                         valueClassName = "min-w-[3ch] text-center text-base font-semibold text-slate-100",
                                         minContentWidth = null,
                                         contentWidth = null,
                                       }) {
  const resolvedMinContentWidth = typeof minContentWidth === "number" ? `${minContentWidth}px` : minContentWidth;
  const resolvedContentWidth = typeof contentWidth === "number" ? `${contentWidth}px` : contentWidth;
  const contentStyle = resolvedContentWidth
      ? {width: resolvedContentWidth}
      : resolvedMinContentWidth
          ? {minWidth: resolvedMinContentWidth}
          : undefined;

  return (
      <div className="inline-flex h-11 items-stretch rounded-md bg-slate-800/80">
        <button
            type="button"
            onClick={onDecrement}
            disabled={decrementDisabled}
            className="inline-flex h-full select-none touch-manipulation items-center justify-center rounded-md px-3 text-slate-500 disabled:opacity-40"
            aria-label={decrementAriaLabel}
        >
          <Minus className="h-5 w-5"/>
        </button>
        <div
            className={`inline-flex items-center justify-center px-4 ${valueClassName}`}
            style={contentStyle}
        >
          {value}
        </div>
        <button
            type="button"
            onClick={onIncrement}
            disabled={incrementDisabled}
            className="inline-flex h-full select-none touch-manipulation items-center justify-center rounded-md px-3 text-slate-500 disabled:opacity-40"
            aria-label={incrementAriaLabel}
        >
          <Plus className="h-5 w-5"/>
        </button>
      </div>
  );
}
