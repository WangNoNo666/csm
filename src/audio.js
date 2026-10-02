/* ============================================================
   音效 —— 纯 WebAudio 合成，无需外部资源
   风格：干净的合成器音色，跳跃/落地/冲刺/传送各有辨识度
   ============================================================ */

class AudioKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuf = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.34;
    // 轻微压缩，避免叠音爆掉
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 18; comp.ratio.value = 8;
    this.master.connect(comp); comp.connect(this.ctx.destination);

    // 噪声缓冲
    const len = this.ctx.sampleRate * 0.4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setEnabled(v) { this.enabled = v; if (this.master) this.master.gain.value = v ? 0.34 : 0; }

  _tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  _noise(dur, gain = 0.16, filterFreq = 1200, q = 1, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = filterFreq; bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  jump()      { this._tone(430, 0.13, 'triangle', 0.16, 700); this._noise(0.06, 0.05, 2600, 1.2); }
  land(i = .5) { this._tone(150 - i * 40, 0.1, 'sine', 0.05 + i * 0.16, 70); this._noise(0.07, 0.04 + i * 0.09, 500, 0.8); }
  airJump()   { this._tone(560, 0.12, 'triangle', 0.12, 900); this._noise(0.08, 0.05, 2400, 1); }
  portal()    { this._tone(320, 0.26, 'sine', 0.16, 1250); this._tone(480, 0.22, 'triangle', 0.09, 1900, 0.02); this._noise(0.2, 0.09, 3200, 2); }
  crystal()   { this._tone(720, 0.1, 'sine', 0.14, 1180); this._tone(1180, 0.14, 'sine', 0.1, 1600, 0.05); }
  place()     { this._tone(520, 0.09, 'square', 0.09, 780); }
  fail()      { this._tone(220, 0.2, 'sawtooth', 0.12, 90); this._noise(0.2, 0.1, 700, 0.8); }
  death()     { this._tone(300, 0.35, 'sawtooth', 0.16, 60); this._noise(0.28, 0.14, 900, 0.6, 0.02); }
  win()       { [0, .1, .2, .34].forEach((d, i) => this._tone([523, 659, 784, 1046][i], 0.3, 'triangle', 0.15, null, d)); }
  roomIn()    { this._tone(300, 0.22, 'sine', 0.1, 600); }
  button()    { this._tone(640, 0.07, 'square', 0.11, 900); }
}
