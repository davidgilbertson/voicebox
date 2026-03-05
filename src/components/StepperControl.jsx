import { Minus, Plus } from "lucide-react";

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
  size = "small",
  units = null,
}) {
  const resolvedMinContentWidth =
    typeof minContentWidth === "number" ? `${minContentWidth}px` : minContentWidth;
  const resolvedContentWidth =
    typeof contentWidth === "number" ? `${contentWidth}px` : contentWidth;
  const contentStyle = resolvedContentWidth
    ? { width: resolvedContentWidth }
    : resolvedMinContentWidth
      ? { minWidth: resolvedMinContentWidth }
      : undefined;
  const isLarge = size === "large";

  return (
    <div
      className={`inline-flex items-stretch rounded-md bg-slate-800/80 ${isLarge ? "h-16" : "h-11"}`}
    >
      <button
        type="button"
        onClick={onDecrement}
        disabled={decrementDisabled}
        className={`inline-flex h-full touch-manipulation items-center justify-center rounded-md text-slate-500 select-none disabled:opacity-40 ${
          isLarge ? "px-4" : "px-3"
        }`}
        aria-label={decrementAriaLabel}
      >
        <Minus className={isLarge ? "h-6 w-6" : "h-5 w-5"} />
      </button>
      <div
        className={`inline-flex items-center justify-center ${isLarge ? "px-5" : "px-4"} ${valueClassName}`}
        style={contentStyle}
      >
        {units ? (
          <div
            className={`flex flex-col items-center justify-center leading-none ${isLarge ? "gap-1" : "gap-0.5"}`}
          >
            <span className={isLarge ? "text-xl leading-4" : undefined}>{value}</span>
            <span
              className={`${isLarge ? "text-sm" : "text-[10px]"} font-semibold tracking-wide text-slate-500 uppercase`}
            >
              {units}
            </span>
          </div>
        ) : (
          value
        )}
      </div>
      <button
        type="button"
        onClick={onIncrement}
        disabled={incrementDisabled}
        className={`inline-flex h-full touch-manipulation items-center justify-center rounded-md text-slate-500 select-none disabled:opacity-40 ${
          isLarge ? "px-4" : "px-3"
        }`}
        aria-label={incrementAriaLabel}
      >
        <Plus className={isLarge ? "h-6 w-6" : "h-5 w-5"} />
      </button>
    </div>
  );
}
