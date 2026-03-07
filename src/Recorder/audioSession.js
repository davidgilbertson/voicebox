function pickPreferredAudioInputDeviceId(devices) {
  const preferredInput = devices
    .filter((device) => device.kind === "audioinput")
    .find((device) => {
      const label = (device.label || "").toLowerCase();
      return (
        label &&
        !label.includes("bluetooth") &&
        !label.includes("headset") &&
        !label.includes("default")
      );
    });
  return preferredInput?.deviceId || null;
}

async function getPreferredAudioInputDeviceId() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
    return null;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return pickPreferredAudioInputDeviceId(devices);
}

export async function createBaseMicrophoneSession({ fftSize }) {
  let context = null;
  let stream = null;
  let source = null;
  let analyser = null;
  try {
    const preferredDeviceId = await getPreferredAudioInputDeviceId();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: false,
        ...(preferredDeviceId ? { deviceId: preferredDeviceId } : {}),
      },
    });
    context = new AudioContext();
    await context.resume();

    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);

    return {
      context,
      stream,
      source,
      analyser,
    };
  } catch (error) {
    destroyMicrophoneSession({ context, stream, source, analyser });
    throw error;
  }
}

export async function createRecorderAudioSession({
  fftSize,
  highResSpectrogram = false,
  displayPixelsPerSecond,
  workletModuleUrl,
  onWorkletMessage,
}) {
  let session = null;
  let captureNode = null;
  let highResAnalyser = null;
  let silentOutputGain = null;
  try {
    session = await createBaseMicrophoneSession({ fftSize });
    await session.context.audioWorklet.addModule(workletModuleUrl);

    captureNode = new AudioWorkletNode(session.context, "audio-capture-processor");
    captureNode.port.onmessage = onWorkletMessage ?? null;
    session.source.connect(captureNode);

    if (highResSpectrogram) {
      highResAnalyser = session.context.createAnalyser();
      highResAnalyser.fftSize = fftSize * 2;
      highResAnalyser.smoothingTimeConstant = 0;
      session.source.connect(highResAnalyser);
    }

    silentOutputGain = session.context.createGain();
    silentOutputGain.gain.value = 0;
    captureNode.connect(silentOutputGain);
    silentOutputGain.connect(session.context.destination);

    const sampleRate = session.context.sampleRate;
    const hopSize = Math.round(sampleRate / displayPixelsPerSecond);
    captureNode.port.postMessage({
      type: "set-batch-size",
      batchSize: hopSize,
    });

    return {
      ...session,
      captureNode,
      highResAnalyser,
      silentOutputGain,
      sampleRate,
      hopSize,
    };
  } catch (error) {
    destroyRecorderAudioSession({
      ...(session ?? {}),
      captureNode,
      highResAnalyser,
      silentOutputGain,
    });
    throw error;
  }
}

export function destroyMicrophoneSession({ context, stream, source, analyser }) {
  if (source) {
    source.disconnect();
  }
  if (analyser) {
    analyser.disconnect();
  }
  if (stream) {
    const tracks =
      typeof stream.getTracks === "function"
        ? stream.getTracks()
        : typeof stream.getAudioTracks === "function"
          ? stream.getAudioTracks()
          : [];
    tracks.forEach((track) => track.stop());
  }
  if (context && context.state !== "closed") {
    context.close();
  }
}

export function destroyRecorderAudioSession({
  context,
  stream,
  source,
  captureNode,
  analyser,
  highResAnalyser,
  silentOutputGain,
}) {
  if (captureNode) {
    captureNode.port.onmessage = null;
    captureNode.disconnect();
  }
  if (silentOutputGain) {
    silentOutputGain.disconnect();
  }
  if (highResAnalyser) {
    highResAnalyser.disconnect();
  }
  destroyMicrophoneSession({ context, stream, source, analyser });
}
