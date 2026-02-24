export function computeIsForeground() {
  if (document.visibilityState === "hidden") return false;
  if (document.hasFocus) {
    return document.hasFocus();
  }
  return true;
}

export function subscribeToForegroundChanges(onChange) {
  const notify = () => {
    onChange(computeIsForeground());
  };
  notify();
  document.addEventListener("visibilitychange", notify);
  window.addEventListener("focus", notify);
  window.addEventListener("blur", notify);
  window.addEventListener("pageshow", notify);
  window.addEventListener("pagehide", notify);
  return () => {
    document.removeEventListener("visibilitychange", notify);
    window.removeEventListener("focus", notify);
    window.removeEventListener("blur", notify);
    window.removeEventListener("pageshow", notify);
    window.removeEventListener("pagehide", notify);
  };
}
