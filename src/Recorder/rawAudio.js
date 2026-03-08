import { clamp } from "../tools.js";
import { RingBuffer } from "./ringBuffer.js";

function getSampleCapacity(sampleRate, seconds) {
  return Math.max(1, Math.floor(sampleRate * seconds));
}

export function createRawAudioState({ sampleRate, seconds }) {
  return {
    ring: new RingBuffer(getSampleCapacity(sampleRate, seconds)),
    sampleRate,
    seconds,
  };
}

export function resetRawAudioState(rawAudioState, { sampleRate, seconds }) {
  rawAudioState.ring = new RingBuffer(getSampleCapacity(sampleRate, seconds));
  rawAudioState.sampleRate = sampleRate;
  rawAudioState.seconds = seconds;
}

export function appendRawAudioSamples(rawAudioState, samples) {
  if (!samples?.length) return;
  for (let i = 0; i < samples.length; i += 1) {
    rawAudioState.ring.push(samples[i]);
  }
}

export function readRawAudioSamples(rawAudioState) {
  return rawAudioState.ring.values();
}

function floatTo16BitPcm(value) {
  const clamped = clamp(value, -1, 1);
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

export function createWavBlob(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, floatTo16BitPcm(samples[i]), true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}
