import {useEffect, useRef, useState} from "react";
import {ArrowDown, ArrowRight, ArrowUp} from "lucide-react";

const TAP_GESTURE_MAX_PX = 10;
const SWIPE_GESTURE_THRESHOLD_PX = 100;
const SWIPE_FLASH_HOLD_MS = 140;
const SWIPE_FLASH_TOTAL_MS = 700;

function isGestureTapTarget(element) {
  return element?.closest?.("button,input,select,textarea,a,label,[role='button'],[data-no-gesture-tap]") !== null;
}

function classifyGesture(deltaX, deltaY) {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const maxAxisPx = Math.max(absX, absY);
  return {
    isTap: maxAxisPx < TAP_GESTURE_MAX_PX,
    isSwipe: maxAxisPx > SWIPE_GESTURE_THRESHOLD_PX,
  };
}

function swipeDirection(deltaX, deltaY) {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= SWIPE_GESTURE_THRESHOLD_PX ? "right" : deltaX <= -SWIPE_GESTURE_THRESHOLD_PX ? "left" : null;
  }
  return deltaY <= -SWIPE_GESTURE_THRESHOLD_PX ? "up" : deltaY >= SWIPE_GESTURE_THRESHOLD_PX ? "down" : null;
}

export default function GestureArea({
                                      onTap,
                                      onSwipe,
                                      showHelp = false,
                                      helpContent = null,
                                      className = "",
                                      testId,
                                    }) {
  const gestureRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    handled: false,
  });
  const [swipeFlash, setSwipeFlash] = useState(null);
  const [swipeFlashFading, setSwipeFlashFading] = useState(false);
  const swipeFlashFadeTimeoutRef = useRef(0);
  const swipeFlashTimeoutRef = useRef(0);

  useEffect(() => {
    return () => {
      if (swipeFlashFadeTimeoutRef.current) {
        window.clearTimeout(swipeFlashFadeTimeoutRef.current);
      }
      if (swipeFlashTimeoutRef.current) {
        window.clearTimeout(swipeFlashTimeoutRef.current);
      }
    };
  }, []);

  const showSwipeFlash = (direction) => {
    if (direction !== "up" && direction !== "down" && direction !== "right") return;
    setSwipeFlash((prev) => ({direction, id: (prev?.id ?? 0) + 1}));
    setSwipeFlashFading(false);
    if (swipeFlashFadeTimeoutRef.current) {
      window.clearTimeout(swipeFlashFadeTimeoutRef.current);
    }
    swipeFlashFadeTimeoutRef.current = window.setTimeout(() => {
      setSwipeFlashFading(true);
    }, SWIPE_FLASH_HOLD_MS);
    if (swipeFlashTimeoutRef.current) {
      window.clearTimeout(swipeFlashTimeoutRef.current);
    }
    swipeFlashTimeoutRef.current = window.setTimeout(() => {
      setSwipeFlash(null);
    }, SWIPE_FLASH_TOTAL_MS);
  };

  const handleGestureMove = (deltaX, deltaY) => {
    const gesture = gestureRef.current;
    if (gesture.handled) return true;
    if (
        Math.abs(deltaX) < SWIPE_GESTURE_THRESHOLD_PX &&
        Math.abs(deltaY) < SWIPE_GESTURE_THRESHOLD_PX
    ) {
      return false;
    }
    gesture.handled = true;
    const direction = swipeDirection(deltaX, deltaY);
    if (!direction) return true;
    onSwipe?.(direction);
    showSwipeFlash(direction);
    return true;
  };

  const onPointerDownCapture = (event) => {
    gestureRef.current.pointerId = event.pointerId;
    gestureRef.current.startX = event.clientX;
    gestureRef.current.startY = event.clientY;
    gestureRef.current.handled = false;
  };

  const onPointerMoveCapture = (event) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId || gesture.handled) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const handled = handleGestureMove(deltaX, deltaY);
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerUpCapture = (event) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const gestureType = classifyGesture(deltaX, deltaY);
    const handled = gestureType.isSwipe ? handleGestureMove(deltaX, deltaY) : gesture.handled;
    gestureRef.current.pointerId = null;
    if (gesture.handled || handled || !gestureType.isTap) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isGestureTapTarget(event.target)) return;
    onTap?.();
  };

  const onPointerCancelCapture = () => {
    gestureRef.current.pointerId = null;
    gestureRef.current.handled = false;
  };

  const swipeFlashIcon = swipeFlash?.direction === "up" ? ArrowUp
      : swipeFlash?.direction === "down" ? ArrowDown
          : swipeFlash?.direction === "right" ? ArrowRight
              : null;
  const SwipeFlashIcon = swipeFlashIcon;

  return (
      <div
          data-testid={testId}
          className={className}
          onPointerDownCapture={onPointerDownCapture}
          onPointerMoveCapture={onPointerMoveCapture}
          onPointerUpCapture={onPointerUpCapture}
          onPointerCancelCapture={onPointerCancelCapture}
      >
        {showHelp ? helpContent : SwipeFlashIcon ? (
            <SwipeFlashIcon
                key={swipeFlash.id}
                className={`h-24 w-24 text-blue-300 transition-opacity duration-500 ${
                    swipeFlashFading ? "opacity-0" : "opacity-100"
                }`}
            />
        ) : null}
      </div>
  );
}
