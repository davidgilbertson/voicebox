const SELECTED_SOURCE_STORAGE_KEY = "voicebox.private.selectedAudioSourceKey";
const RECORDED_AUDIO_STORAGE_KEY = "voicebox.private.recordedAudio";
const RECORDED_SOURCE_KEY = "recorded:last";

const ASSET_FILES = [
  "High ah gaps.wav",
  "david_clipping_e4.wav",
  "david_subharmonics.wav",
  "david_vibrato_2.wav",
  "david_vibrato_3.wav",
  "david_vocals.wav",
  "david_vocals2.wav",
  "david_vocals_31s.wav",
  "david_vocals_vibrato.wav",
  "maria_vibrato.wav",
  "opera-female-vocals_140bpm_A_major.wav",
  "opera-vocals_129bpm_F_minor.wav",
  "rozette_vibrato.wav",
];

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toAssetUrl(fileName) {
  return `../../.private/assets/${fileName}`;
}

export function getAssetSources() {
  return ASSET_FILES.map((fileName) => {
    const url = toAssetUrl(fileName);
    return {
      key: `asset:${url}`,
      label: fileName,
      type: "asset",
      url,
    };
  });
}

export function getRecordedSourceOption() {
  const payload = localStorage.getItem(RECORDED_AUDIO_STORAGE_KEY);
  if (!payload) return null;
  return {
    key: RECORDED_SOURCE_KEY,
    label: "Last recording",
    type: "recorded",
  };
}

export function getAudioSources() {
  const sources = getAssetSources();
  const recordedOption = getRecordedSourceOption();
  if (recordedOption) {
    sources.unshift(recordedOption);
  }
  return sources;
}

export function readSelectedAudioSourceKey() {
  return localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY);
}

export function writeSelectedAudioSourceKey(sourceKey) {
  if (typeof sourceKey !== "string" || sourceKey.length === 0) return;
  localStorage.setItem(SELECTED_SOURCE_STORAGE_KEY, sourceKey);
}

export function getAssetSourceKey(assetUrl) {
  return `asset:${assetUrl}`;
}

export function resolveSelectedSource(sources, selectedKey, fallbackAssetUrl) {
  const fallbackKey = getAssetSourceKey(fallbackAssetUrl);
  if (selectedKey) {
    const selected = sources.find((source) => source.key === selectedKey);
    if (selected) return selected;
  }
  const fallback = sources.find((source) => source.key === fallbackKey);
  if (fallback) return fallback;
  return sources[0] ?? null;
}

export function saveRecordedAudio(audioInput) {
  if (!Number.isFinite(audioInput?.sampleRate) || !(audioInput?.samples instanceof Float32Array)) {
    return { stored: false, reason: "invalid_input" };
  }

  const bytes = new Uint8Array(
    audioInput.samples.buffer,
    audioInput.samples.byteOffset,
    audioInput.samples.byteLength,
  );
  const payload = JSON.stringify({
    version: 1,
    sampleRate: audioInput.sampleRate,
    sampleCount: audioInput.samples.length,
    samplesBase64: bytesToBase64(bytes),
  });
  localStorage.setItem(RECORDED_AUDIO_STORAGE_KEY, payload);
  return {
    stored: true,
  };
}

export function loadRecordedAudio() {
  const payload = localStorage.getItem(RECORDED_AUDIO_STORAGE_KEY);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload);
    if (!Number.isFinite(parsed?.sampleRate) || typeof parsed?.samplesBase64 !== "string") {
      return null;
    }
    const bytes = base64ToBytes(parsed.samplesBase64);
    if (bytes.byteLength % 4 !== 0) {
      return null;
    }
    const samplesBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const samples = new Float32Array(samplesBuffer);
    return {
      sampleRate: parsed.sampleRate,
      samples,
    };
  } catch {
    return null;
  }
}

export function loadAudioInputForSource(source) {
  if (!source) return null;
  if (source.type === "asset") {
    return source.url;
  }
  if (source.type === "recorded") {
    return loadRecordedAudio();
  }
  return null;
}
