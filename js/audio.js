// Tiny synthesized sound effects (no files): flash guns, lasers, blasts, console blips and the
// Little Doctor's rising whine. The context starts on the first user gesture.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastAt = {};
    const wake = () => this.ensure();
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0.35;
        this.out.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Throttle so a swarm of ships doesn't stack hundreds of voices. */
  ok(name, gap) {
    if (this.muted || !this.ensure()) return false;
    const t = this.ctx.currentTime;
    if (t - (this.lastAt[name] ?? -1) < gap) return false;
    this.lastAt[name] = t;
    return true;
  }

  tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, freq, vol = 0.4, q = 0.8) {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(60, t + dur);
    f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t);
    s.stop(t + dur);
  }

  flash() { if (this.ok('flash', 0.05)) { this.tone('square', 1800, 300, 0.12, 0.12); this.burst(0.08, 5000, 0.12); } }
  frozen() { if (this.ok('frozen', 0.05)) { this.tone('sine', 900, 1900, 0.25, 0.18); this.tone('triangle', 1400, 2600, 0.3, 0.1, 0.05); } }
  push() { if (this.ok('push', 0.1)) this.burst(0.25, 900, 0.18, 2); }
  bump() { if (this.ok('bump', 0.08)) this.tone('sine', 140, 60, 0.18, 0.3); }
  laser(near = 1) { if (this.ok('laser', 0.04)) this.tone('sawtooth', 1600, 200, 0.1, 0.06 * near); }
  boom(big = 1) { if (this.ok('boom', 0.03)) this.burst(0.5 + 0.6 * big, 1200 * big, 0.25 + 0.2 * big); }
  blip() { if (this.ok('blip', 0.03)) this.tone('sine', 880, 1320, 0.07, 0.12); }
  order() { if (this.ok('order', 0.05)) { this.tone('sine', 660, 660, 0.06, 0.12); this.tone('sine', 990, 990, 0.08, 0.12, 0.07); } }
  alarm() { if (this.ok('alarm', 1)) { this.tone('square', 440, 440, 0.18, 0.08); this.tone('square', 330, 330, 0.18, 0.08, 0.2); } }
  win() { if (this.ok('win', 1)) [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.16, i * 0.13)); }
  lose() { if (this.ok('lose', 1)) [392, 330, 262].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.4, 0.16, i * 0.18)); }
  doctor() {
    if (!this.ok('doctor', 0.3)) return;
    this.tone('sine', 120, 2400, 1.1, 0.2);
    this.tone('triangle', 60, 1200, 1.2, 0.12);
    setTimeout(() => this.ctx && this.burst(2.2, 3000, 0.5, 0.5), 1000);
  }
}
