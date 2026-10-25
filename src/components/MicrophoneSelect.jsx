import { useEffect, useState } from "react";
import { readMicrophoneDeviceId, writeMicrophoneDeviceId } from "../Recorder/config.js";
import { Select } from "./Select.jsx";

export function MicrophoneSelect({ open, isAudioRunning, recorderEngine }) {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(readMicrophoneDeviceId);

  useEffect(() => {
    if (!open || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refreshDevices = async () => {
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          // Empty labels mean permission hasn't exposed usable device names yet.
          setDevices(
            available.filter(
              (device) => device.kind === "audioinput" && device.label && device.deviceId,
            ),
          );
        }
      } catch {
        // Device enumeration can be denied independently of opening Settings.
        if (!cancelled) setDevices([]);
      }
    };
    refreshDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
    };
  }, [open, isAudioRunning]);

  if (devices.length < 2) return null;

  return (
    <label className="flex min-w-0 items-center justify-between gap-4 text-sm">
      <span>Microphone</span>
      <Select
        value={devices.some((device) => device.deviceId === deviceId) ? deviceId : ""}
        onChange={(event) => {
          const nextDeviceId = event.target.value;
          writeMicrophoneDeviceId(nextDeviceId);
          setDeviceId(nextDeviceId);
          recorderEngine.restartAudio();
        }}
        containerClassName="min-w-0 max-w-[70%] flex-1"
        className="h-10 w-full min-w-0 truncate rounded-md border border-slate-600 bg-slate-800/80 pr-10 pl-3 text-slate-100"
      >
        <option value="">Automatic</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
