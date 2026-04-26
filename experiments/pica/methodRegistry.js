const METHOD_DEFINITIONS = {
  PITCHY: {
    resultKey: "pitchyPitchHz",
    perfKey: "pitchyPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: false,
  },
  FFT: {
    resultKey: "pitchHz",
    perfKey: "voiceboxPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: false,
  },
  PICA: {
    resultKey: "picaPitchHz",
    perfKey: "picaPipelineMsPerSecondAudio",
    selectedByDefault: true,
    supportsHpo: true,
  },
  PICACF: {
    resultKey: "picaCfPitchHz",
    perfKey: "picaCfPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: true,
  },
  PIZA: {
    resultKey: "pizaPitchHz",
    perfKey: "pizaPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: true,
  },
  PICA2: {
    resultKey: "pica2PitchHz",
    perfKey: "pica2PipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: true,
  },
  PIRA: {
    resultKey: "piraPitchHz",
    perfKey: "piraPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: false,
  },
  PIFS: {
    resultKey: "pifsPitchHz",
    perfKey: "pifsPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: true,
  },
  PIPS: {
    resultKey: "pipsPitchHz",
    perfKey: "pipsPipelineMsPerSecondAudio",
    selectedByDefault: true,
    supportsHpo: true,
  },
  PISC: {
    resultKey: "piscPitchHz",
    perfKey: "piscPipelineMsPerSecondAudio",
    selectedByDefault: false,
    supportsHpo: true,
  },
};

export const CURRENT_METHOD_KEY = "PICA";
export const PICA_METHOD_REGISTRY = Object.entries(METHOD_DEFINITIONS).map(([key, definition]) => ({
  key,
  ...definition,
}));
export const PICA_METHOD_KEYS = PICA_METHOD_REGISTRY.map((method) => method.key);
export const HPO_METHOD_KEYS = PICA_METHOD_REGISTRY.filter((method) => method.supportsHpo).map(
  (method) => method.key,
);

export function getMethodDefinition(methodKey) {
  return METHOD_DEFINITIONS[methodKey]
    ? { key: methodKey, ...METHOD_DEFINITIONS[methodKey] }
    : undefined;
}

export function getDefaultSelectedMethods() {
  return Object.fromEntries(
    PICA_METHOD_REGISTRY.map((method) => [method.key, method.selectedByDefault]),
  );
}

export function normalizeSelectedMethods(selectedMethods = {}) {
  return { ...getDefaultSelectedMethods(), ...selectedMethods };
}

export function getCurrentMethodDefinition() {
  return getMethodDefinition(CURRENT_METHOD_KEY);
}
