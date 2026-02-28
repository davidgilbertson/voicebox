export class RingBuffer {
  #values;
  #writeIndex;
  #sampleCount;

  constructor(length) {
    const targetLength = Math.max(1, Math.floor(length));
    this.#values = new Float32Array(targetLength);
    this.#values.fill(Number.NaN);
    this.#writeIndex = 0;
    this.#sampleCount = 0;
  }

  get capacity() {
    return this.#values.length;
  }

  get sampleCount() {
    return this.#sampleCount;
  }

  values() {
    return this.slice();
  }

  at(index) {
    let orderedIndex = index;
    if (orderedIndex < 0) {
      orderedIndex = this.#sampleCount + orderedIndex;
    }
    if (orderedIndex < 0 || orderedIndex >= this.#sampleCount) return undefined;
    const firstIndex = this.#sampleCount === this.#values.length ? this.#writeIndex : 0;
    const rawIndex = (firstIndex + orderedIndex) % this.#values.length;
    if (rawIndex < 0) return undefined;
    return this.#values[rawIndex];
  }

  slice(start = 0, end = this.#sampleCount) {
    const ordered = new Float32Array(this.#sampleCount);
    for (let i = 0; i < this.#sampleCount; i += 1) {
      ordered[i] = this.at(i);
    }
    return ordered.slice(start, end);
  }

  newest() {
    if (this.#sampleCount <= 0) return Number.NaN;
    return this.fromNewest(0);
  }

  fromNewest(offset) {
    if (offset < 0 || offset >= this.#sampleCount) return undefined;
    const rawIndex = (this.#writeIndex + this.#values.length - 1 - offset) % this.#values.length;
    return this.#values[rawIndex];
  }

  setAt(index, value) {
    let orderedIndex = index;
    if (orderedIndex < 0) {
      orderedIndex = this.#sampleCount + orderedIndex;
    }
    if (orderedIndex < 0 || orderedIndex >= this.#sampleCount) return;
    const firstIndex = this.#sampleCount === this.#values.length ? this.#writeIndex : 0;
    const rawIndex = (firstIndex + orderedIndex) % this.#values.length;
    if (rawIndex < 0) return;
    this.#values[rawIndex] = value;
  }

  findMostRecentFinite() {
    for (let offset = 0; offset < this.#sampleCount; offset += 1) {
      const value = this.fromNewest(offset);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  push(value) {
    this.#values[this.#writeIndex] = value;
    this.#writeIndex = (this.#writeIndex + 1) % this.#values.length;
    if (this.#sampleCount < this.#values.length) {
      this.#sampleCount += 1;
    }
  }

  resize(nextLength) {
    const targetLength = Math.max(1, Math.floor(nextLength));
    if (targetLength === this.#values.length) return;

    const ordered = this.slice();
    const nextValues = new Float32Array(targetLength);
    nextValues.fill(Number.NaN);
    if (this.#sampleCount > 0) {
      const nextSampleCount = Math.min(targetLength, this.#sampleCount);
      const start = ordered.length - nextSampleCount;
      nextValues.set(ordered.subarray(start), 0);
      this.#sampleCount = nextSampleCount;
      this.#writeIndex = nextSampleCount === targetLength ? 0 : nextSampleCount;
    } else {
      this.#sampleCount = 0;
      this.#writeIndex = 0;
    }
    this.#values = nextValues;
  }
}
