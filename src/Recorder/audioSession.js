export async function createRecorderAudioSession({
  preferredDeviceId = null,
  fftSize,
  highResSpectrogram = false,
  displayPixelsPerSecond,
  workletModuleUrl,
  onWorkletMessage,
}) {
  let context = null;
  let stream = null;
  let source = null;
  let captureNode = null;
  let analyser = null;
  let highResAnalyser = null;
  let silentOutputGain = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: false,
        ...(preferredDeviceId ? { deviceId: preferredDeviceId } : {}),
      },
    });

    context = new AudioContext();
    await context.audioWorklet.addModule(workletModuleUrl);
    await context.resume();

    source = context.createMediaStreamSource(stream);
    captureNode = new AudioWorkletNode(context, "audio-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      outputChannelCount: [1],
    });
    captureNode.port.onmessage = onWorkletMessage ?? null;

    analyser = context.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;

    source.connect(captureNode);
    source.connect(analyser);
    if (highResSpectrogram) {
      highResAnalyser = context.createAnalyser();
      highResAnalyser.fftSize = fftSize * 2;
      highResAnalyser.smoothingTimeConstant = 0;
      source.connect(highResAnalyser);
    }

    // Keep the worklet in the pull graph while producing no audible output.
    silentOutputGain = context.createGain();
    silentOutputGain.gain.value = 0;
    captureNode.connect(silentOutputGain);
    silentOutputGain.connect(context.destination);

    const sampleRate = context.sampleRate;
    const hopSize = Math.round(sampleRate / displayPixelsPerSecond);
    captureNode.port.postMessage({
      type: "set-batch-size",
      batchSize: hopSize,
    });

    return {
      context,
      stream,
      source,
      captureNode,
      analyser,
      highResAnalyser,
      silentOutputGain,
      sampleRate,
      hopSize,
    };
  } catch (error) {
    destroyRecorderAudioSession({
      context,
      stream,
      source,
      captureNode,
      analyser,
      highResAnalyser,
      silentOutputGain,
    });
    throw error;
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
  if (source) {
    source.disconnect();
  }
  if (silentOutputGain) {
    silentOutputGain.disconnect();
  }
  if (analyser) {
    analyser.disconnect();
  }
  if (highResAnalyser) {
    highResAnalyser.disconnect();
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (context && context.state !== "closed") {
    context.close();
  }
}
