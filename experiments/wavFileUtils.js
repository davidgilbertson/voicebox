import fs from "node:fs";

function parseWavBuffer(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let offset = 12;
  let formatTag = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const nextOffset = chunkDataStart + chunkSize + (chunkSize % 2);

    if (chunkId === "fmt ") {
      formatTag = buffer.readUInt16LE(chunkDataStart);
      channels = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === "data") {
      dataOffset = chunkDataStart;
      dataSize = chunkSize;
    }

    offset = nextOffset;
  }

  if (
    formatTag === null ||
    channels === null ||
    sampleRate === null ||
    bitsPerSample === null ||
    dataOffset === null ||
    dataSize === null
  ) {
    throw new Error("Missing required WAV chunks");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(frameCount);

  if (formatTag === 1 && bitsPerSample === 16) {
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = buffer.readInt16LE(dataOffset + index * frameSize) / 32768;
    }
  } else if (formatTag === 3 && bitsPerSample === 32) {
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = buffer.readFloatLE(dataOffset + index * frameSize);
    }
  } else {
    throw new Error(
      `Unsupported WAV format. formatTag=${formatTag}, bitsPerSample=${bitsPerSample}`,
    );
  }

  return { sampleRate, channels, bitsPerSample, frameCount, samples };
}

export function loadWavFile(wavPath) {
  return {
    wavPath,
    ...parseWavBuffer(fs.readFileSync(wavPath)),
  };
}
