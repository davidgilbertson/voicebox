function normalizePermissionState(state) {
  return state === "granted" || state === "prompt" || state === "denied" ? state : "unknown";
}

export async function queryMicrophonePermissionState() {
  if (typeof navigator.permissions?.query !== "function") {
    return "unknown";
  }

  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return normalizePermissionState(status?.state);
  } catch {
    return "unknown";
  }
}
