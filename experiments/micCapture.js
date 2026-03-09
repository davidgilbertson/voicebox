export async function recordMicrophoneAudio({
  maxDurationMs = 10_000,
} = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not supported in this browser.");
  }
  if (!window.MediaRecorder) {
    throw new Error("MediaRecorder is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: false,
    },
  });

  const recorder = new MediaRecorder(stream);
  const chunks = [];
  await new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.addEventListener("error", (event) => {
      reject(event.error ?? new Error("Recording failed."));
    });
    recorder.addEventListener("stop", finish);
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, Math.max(250, Math.floor(maxDurationMs)));
  });

  stream.getTracks().forEach((track) => track.stop());
  if (chunks.length === 0) {
    throw new Error("No audio was captured.");
  }

  const blob = new Blob(chunks, {type: recorder.mimeType || "audio/webm"});
  const bytes = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(bytes.slice(0));
    return {
      sampleRate: audioBuffer.sampleRate,
      samples: new Float32Array(audioBuffer.getChannelData(0)),
    };
  } finally {
    await audioContext.close();
  }
}
