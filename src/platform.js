export function isAppleTouchDevice() {
  return (
    /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
    (!navigator.platform || navigator.platform === "MacIntel" ? navigator.maxTouchPoints > 1 : true)
  );
}
