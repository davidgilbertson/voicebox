export async function queryMicrophonePermissionState() {
  if (typeof navigator.permissions?.query !== "function") {
    return "unknown";
  }

  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status?.state === "granted" || status?.state === "prompt" || status?.state === "denied"
      ? status.state
      : "unknown";
  } catch {
    return "unknown";
  }
}
