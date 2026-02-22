import "@testing-library/jest-dom/vitest";
import {afterEach, beforeEach, vi} from "vitest";
import {cleanup} from "@testing-library/react";

vi.mock("soundfont-player", () => ({
  default: {
    instrument: vi.fn(async () => ({
      play: () => ({
        stop: () => {
        },
      }),
      buffers: {},
    })),
    nameToUrl: () => "",
  },
}));

let visibilityState = "hidden";
let hasFocus = false;

Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilityState,
});

document.hasFocus = () => hasFocus;

window.__setForegroundForTests = ({visible, focused}) => {
  if (typeof visible === "boolean") {
    visibilityState = visible ? "visible" : "hidden";
  }
  if (typeof focused === "boolean") {
    hasFocus = focused;
  }
};

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
}

Object.defineProperty(window, "devicePixelRatio", {
  configurable: true,
  writable: true,
  value: 1,
});

window.matchMedia = window.matchMedia || ((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {
  },
  removeEventListener: () => {
  },
  addListener: () => {
  },
  removeListener: () => {
  },
  dispatchEvent: () => false,
}));

window.ResizeObserver = window.ResizeObserver || class ResizeObserver {
  observe() {
  }

  unobserve() {
  }

  disconnect() {
  }
};

const rafHandles = new Map();
let rafId = 1;
window.requestAnimationFrame = (callback) => {
  const id = rafId++;
  const timeoutId = window.setTimeout(() => {
    rafHandles.delete(id);
    callback(performance.now());
  }, 0);
  rafHandles.set(id, timeoutId);
  return id;
};
window.cancelAnimationFrame = (id) => {
  const timeoutId = rafHandles.get(id);
  if (timeoutId) {
    window.clearTimeout(timeoutId);
    rafHandles.delete(id);
  }
};

const canvasCtx = {
  setTransform: () => {
  },
  clearRect: () => {
  },
  beginPath: () => {
  },
  moveTo: () => {
  },
  lineTo: () => {
  },
  stroke: () => {
  },
  strokeText: () => {
  },
  fillText: () => {
  },
  drawImage: () => {
  },
  createImageData: (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }),
  putImageData: () => {
  },
  lineWidth: 1,
  strokeStyle: "",
  fillStyle: "",
  font: "",
  textAlign: "left",
  textBaseline: "alphabetic",
  lineJoin: "round",
  lineCap: "round",
  imageSmoothingEnabled: true,
};

HTMLCanvasElement.prototype.getContext = function getContext() {
  return canvasCtx;
};

class FakeAudioContext {
  constructor() {
    this.sampleRate = 48_000;
    this.state = "running";
    this.destination = {};
    this.audioWorklet = {
      addModule: async () => {
      },
    };
  }

  async resume() {
  }

  createMediaStreamSource() {
    return {
      connect: () => {
      },
      disconnect: () => {
      },
    };
  }

  createGain() {
    return {
      gain: {value: 0},
      connect: () => {
      },
      disconnect: () => {
      },
    };
  }

  createAnalyser() {
    let fftSize = 2048;
    return {
      get fftSize() {
        return fftSize;
      },
      set fftSize(nextFftSize) {
        fftSize = nextFftSize;
      },
      get frequencyBinCount() {
        return Math.max(1, Math.floor(fftSize / 2));
      },
      smoothingTimeConstant: 0,
      // TODO (@davidgilbertson): never used now?
      getByteFrequencyData: (array) => {
        array.fill(0);
      },
      getFloatFrequencyData: (array) => {
        array.fill(-120);
      },
      connect: () => {
      },
      disconnect: () => {
      },
    };
  }

  async close() {
    this.state = "closed";
  }
}

class FakeAudioWorkletNode {
  constructor() {
    this.port = {
      onmessage: null,
    };
  }

  connect() {
  }

  disconnect() {
  }
}

window.AudioContext = FakeAudioContext;
window.AudioWorkletNode = FakeAudioWorkletNode;

if (!navigator.mediaDevices) {
  navigator.mediaDevices = {};
}
navigator.mediaDevices.getUserMedia = vi.fn(async () => ({
  getTracks: () => [{
    stop: () => {
    }
  }],
}));

Object.defineProperty(navigator, "getBattery", {
  configurable: true,
  writable: true,
  value: undefined,
});

beforeEach(() => {
  visibilityState = "hidden";
  hasFocus = false;
  navigator.getBattery = undefined;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const timeoutId of rafHandles.values()) {
    window.clearTimeout(timeoutId);
  }
  rafHandles.clear();
});
