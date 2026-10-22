// Gathers microphone audio into 50 ms blocks of 16 kHz mono for dictation.
class Gather extends AudioWorkletProcessor {
  constructor() {
    super();
    this.k = sampleRate / 16000;
    this.out = new Float32Array(800);
    this.n = 0;
    this.pos = 0;
    this.last = 0;
  }
  push(v) {
    this.out[this.n++] = v;
    if (this.n === this.out.length) { this.port.postMessage(this.out, [this.out.buffer]); this.out = new Float32Array(800); this.n = 0; }
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const len = ch[0].length;
    const mono = new Float32Array(len);
    for (const c of ch) for (let i = 0; i < len; i++) mono[i] += c[i] / ch.length;
    if (this.k === 1) { for (let i = 0; i < len; i++) this.push(mono[i]); return true; }
    // Rarely needed: the page asks for a 16 kHz context, so Chromium resamples the microphone itself.
    for (; this.pos < len; this.pos += this.k) {
      const j = Math.floor(this.pos), f = this.pos - j;
      const a = j < 0 ? this.last : mono[j], b = j + 1 < len ? mono[j + 1] : mono[j];
      this.push(a * (1 - f) + b * f);
    }
    this.pos -= len;
    this.last = mono[len - 1];
    return true;
  }
}
registerProcessor('lime-gather', Gather);
