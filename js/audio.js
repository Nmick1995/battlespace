// Procedural audio: a synthesized monk-choir / orchestral soundtrack + all sound effects.
// Everything is generated with the Web Audio API — no audio files.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);

const VOWELS = {
  // [frequency, gain, Q]
  ah: [[700, 1.0, 9], [1180, 0.55, 11], [2550, 0.28, 13], [3300, 0.12, 15]],
  oh: [[450, 1.0, 9], [800, 0.5, 11], [2830, 0.12, 14]],
  oo: [[310, 1.0, 8], [870, 0.28, 11], [2250, 0.08, 14]],
  sop: [[850, 1.0, 9], [1250, 0.6, 11], [2900, 0.35, 13], [3600, 0.15, 15]],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.65;
    this.sfxVol = 0.85;
    this.muted = false;
    this.session = null;
    this.mode = null;
  }

  init() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(6.0, 2.4);
    const revOut = ctx.createGain(); revOut.gain.value = 0.85;
    this.reverb.connect(revOut).connect(this.master);

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);
    this.musicRev = ctx.createGain(); this.musicRev.gain.value = this.musicVol;
    this.musicRev.connect(this.reverb);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);
    this.sfxRev = ctx.createGain(); this.sfxRev.gain.value = this.sfxVol * 0.6;
    this.sfxRev.connect(this.reverb);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    setInterval(() => this.tick(), 250);
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections then diffuse exponential tail — cathedral-ish
        const early = i < rate * 0.08 && Math.random() < 0.004 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay) * (i < rate * 0.02 ? i / (rate * 0.02) : 1);
      }
    }
    return buf;
  }

  setMusicVolume(v) { this.musicVol = v; if (this.ctx) { this.musicBus.gain.value = v; this.musicRev.gain.value = v; } }
  setSfxVolume(v) { this.sfxVol = v; if (this.ctx) { this.sfxBus.gain.value = v; this.sfxRev.gain.value = v * 0.6; } }
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  // ------------------------------------------------------------------ instruments
  dest(session) { return session || { out: this.sfxBus, rev: this.sfxRev }; }

  envGain(t, att, dur, rel, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setValueAtTime(peak, t + Math.max(att, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(att, dur) + rel);
    return g;
  }

  route(node, d, dry = 1, wet = 0.6) {
    const ctx = this.ctx;
    const a = ctx.createGain(); a.gain.value = dry; node.connect(a).connect(d.out);
    const b = ctx.createGain(); b.gain.value = wet; node.connect(b).connect(d.rev);
  }

  // A choir section singing one note: several detuned sawtooth "singers" through vowel formants.
  choir(d, t, dur, midi, vel, vowel = 'ah', singers = 3, att = 0.5, rel = 1.4) {
    const ctx = this.ctx, f = mtof(midi);
    const pre = ctx.createGain(); pre.gain.value = 0.9 / singers;
    const end = t + dur + rel + 0.2;
    for (let i = 0; i < singers; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.detune.value = (i - (singers - 1) / 2) * 9 + rand(-4, 4);
      const lfo = ctx.createOscillator(); lfo.frequency.value = rand(4.4, 5.6);
      const lg = ctx.createGain(); lg.gain.value = rand(8, 14);
      lfo.connect(lg).connect(o.detune);
      o.connect(pre);
      const st = t + rand(0, 0.06);
      o.start(st); lfo.start(st); o.stop(end); lfo.stop(end);
    }
    const env = this.envGain(t, att, dur, rel, vel);
    for (const [ff, g, q] of VOWELS[vowel]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = ff * (vowel === 'sop' ? 1 : midi > 62 ? 1.08 : 1); bp.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g * 3.2;
      pre.connect(bp).connect(gg).connect(env);
    }
    // body: soft fundamental
    const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f;
    const sg = ctx.createGain(); sg.gain.value = 0.35; s.connect(sg).connect(env);
    s.start(t); s.stop(end);
    this.route(env, d, 0.55, 1.0);
  }

  pad(d, t, dur, midi, vel, cutoff = 900, att = 2, rel = 3) {
    const ctx = this.ctx, f = mtof(midi), end = t + dur + rel + 0.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.7;
    for (const det of [-7, 0, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.33; o.connect(g).connect(lp);
      o.start(t); o.stop(end);
    }
    const env = this.envGain(t, att, dur, rel, vel);
    lp.connect(env);
    this.route(env, d, 0.8, 0.7);
  }

  brass(d, t, dur, midi, vel) {
    const ctx = this.ctx, f = mtof(midi), end = t + dur + 1.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(2200, t + Math.min(dur, 1.2));
    lp.frequency.exponentialRampToValueAtTime(500, t + dur + 1);
    for (const [type, det, g0] of [['sawtooth', -5, 0.4], ['sawtooth', 5, 0.4], ['square', 0, 0.2]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = g0; o.connect(g).connect(lp);
      o.start(t); o.stop(end);
    }
    const env = this.envGain(t, 0.35, dur, 1.2, vel);
    lp.connect(env);
    this.route(env, d, 0.8, 0.6);
  }

  pluck(d, t, midi, vel, len = 0.22) {
    const ctx = this.ctx, f = mtof(midi);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(500, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp); o2.connect(lp); lp.connect(g);
    o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
    this.route(g, d, 0.7, 0.35);
  }

  taiko(d, t, vel, pitch = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); o.start(t); o.stop(t + 1);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 * pitch;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.7, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(lp).connect(ng); n.start(t, Math.random()); n.stop(t + 0.3);
    this.route(g, d, 1, 0.45); this.route(ng, d, 1, 0.3);
  }

  swell(d, t, dur, vel) { // reverse cymbal
    const ctx = this.ctx;
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(hp).connect(g); n.start(t); n.stop(t + dur + 0.1);
    this.route(g, d, 0.6, 0.8);
  }

  bell(d, t, midi, vel) {
    const ctx = this.ctx, f = mtof(midi);
    for (const [ratio, g0, dec] of [[1, 1, 3], [2.76, 0.4, 1.6], [5.4, 0.2, 0.8]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel * g0, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); o.start(t); o.stop(t + dec + 0.1);
      this.route(g, d, 0.4, 1.0);
    }
  }

  // ------------------------------------------------------------------ composition
  playMusic(mode) {
    if (!this.ctx || this.mode === mode) return;
    this.stopMusic(2.5);
    this.mode = mode;
    const ctx = this.ctx;
    const out = ctx.createGain(); out.connect(this.musicBus);
    const rev = ctx.createGain(); rev.connect(this.musicRev);
    out.gain.setValueAtTime(0.0001, ctx.currentTime);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    rev.gain.setValueAtTime(0.0001, ctx.currentTime);
    rev.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    const plan = mode === 'menu' ? ['chant', 'anthem', 'reprise'] : ['amb1', 'amb2'];
    this.session = { out, rev, plan, idx: 0, next: ctx.currentTime + 0.3 };
  }

  stopMusic(fade = 1.5) {
    const s = this.session;
    if (!s) return;
    const t = this.ctx.currentTime;
    for (const g of [s.out, s.rev]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + fade);
    }
    setTimeout(() => { s.out.disconnect(); s.rev.disconnect(); }, (fade + 0.5) * 1000);
    this.session = null; this.mode = null;
  }

  tick() {
    const s = this.session;
    if (!s) return;
    while (s.next < this.ctx.currentTime + 1.5) {
      const name = s.plan[s.idx % s.plan.length];
      s.idx++;
      s.next += this.sections[name].call(this, s, s.next);
    }
  }

  get sections() {
    const B = 60 / 64; // beat length (64 bpm)
    return {
      // Gregorian-style male chant in D dorian over a low drone
      chant(d, t0) {
        this.pad(d, t0, 30 * B, 38, 0.10, 500, 4, 5);
        this.pad(d, t0, 30 * B, 45, 0.07, 500, 5, 5);
        this.taiko(d, t0, 0.5, 0.7);
        this.taiko(d, t0 + 16 * B, 0.45, 0.7);
        const mel = [[50, 2], [53, 1], [55, 1], [57, 3], [55, 1], [53, 2], [55, 2], [52, 2], [50, 2],
                     [57, 2], [60, 1], [62, 1], [64, 2], [62, 1], [60, 1], [57, 3], [55, 1], [57, 4]];
        let b = 0;
        mel.forEach(([n, len], i) => {
          const t = t0 + b * B;
          this.choir(d, t, len * B * 0.98, n, 0.34, i % 5 === 3 ? 'oh' : 'ah', 4, 0.25, 0.9);
          this.choir(d, t, len * B * 0.98, n - 12, 0.16, 'oh', 2, 0.3, 0.9);
          if (b >= 16) this.choir(d, t, len * B * 0.98, n - 5, 0.14, 'ah', 2, 0.3, 0.9); // organum
          b += len;
        });
        this.swell(d, t0 + 28 * B, 4 * B, 0.12);
        return 32 * B;
      },
      // Full choir + ostinato strings + taiko — the heroic part
      anthem(d, t0) {
        const chords = [
          [38, [50, 57, 62, 65]], [34, [46, 53, 58, 62]], [41, [53, 57, 60, 65]], [36, [48, 55, 60, 64]],
          [38, [50, 57, 62, 65]], [43, [50, 55, 58, 62]], [34, [46, 53, 58, 65]], [33, [52, 57, 61, 64]],
        ];
        chords.forEach(([root, notes], ci) => {
          const t = t0 + ci * 4 * B;
          notes.forEach((n, k) => this.choir(d, t, 4 * B * 0.96, n, k === 3 ? 0.2 : 0.17, 'ah', 3, 0.35, 1.2));
          this.brass(d, t, 4 * B * 0.9, root, 0.16);
          this.pad(d, t, 4 * B, root + 12, 0.06, 1400, 0.5, 1.5);
          // ostinato
          const pat = [0, 0, 12, 0, 7, 0, 12, 7];
          pat.forEach((iv, k) => this.pluck(d, t + k * B / 2, root + 12 + iv, k % 2 ? 0.07 : 0.12));
          // drums
          const hits = ci % 4 === 3 ? [[0, 1], [1, 0.6], [1.5, 0.6], [2, 0.9], [2.5, 0.6], [3, 0.8], [3.25, 0.6], [3.5, 0.8], [3.75, 0.9]]
                                     : [[0, 1], [1.5, 0.55], [2, 0.8], [3, 0.6], [3.5, 0.5]];
          hits.forEach(([bt, v]) => this.taiko(d, t + bt * B, 0.55 * v, bt === 0 ? 0.8 : 1));
        });
        // soprano descant over the second half
        const desc = [[69, 4], [70, 2], [72, 2], [74, 4], [73, 4]];
        let b = 16;
        desc.forEach(([n, len]) => { this.choir(d, t0 + b * B, len * B, n, 0.15, 'sop', 3, 0.6, 1.5); b += len; });
        this.swell(d, t0 + 29 * B, 3 * B, 0.15);
        return 32 * B;
      },
      reprise(d, t0) {
        const mel = [[57, 2], [60, 1], [62, 1], [64, 2], [62, 1], [60, 1], [57, 3], [55, 1], [50, 4]];
        let b = 0;
        mel.forEach(([n, len]) => {
          this.choir(d, t0 + b * B, len * B, n, 0.3, 'ah', 4, 0.25, 1);
          this.choir(d, t0 + b * B, len * B, n - 12, 0.14, 'oh', 2, 0.3, 1);
          b += len;
        });
        this.choir(d, t0, 16 * B, 74, 0.08, 'oo', 3, 3, 3);
        this.choir(d, t0, 16 * B, 69, 0.08, 'oo', 3, 3, 3);
        this.pad(d, t0, 16 * B, 38, 0.12, 600, 1, 4);
        this.taiko(d, t0, 0.6, 0.7); this.taiko(d, t0 + 8 * B, 0.4, 0.7);
        this.bell(d, t0 + 12 * B, 74, 0.08);
        return 16 * B;
      },
      // In-battle ambience: tense, sparse, choir swells
      amb1(d, t0) {
        this.pad(d, t0, 30 * B, 38, 0.09, 420, 4, 5);
        [[[50, 57, 62], 'oo'], [[46, 53, 62], 'oo'], [[43, 55, 62], 'oh'], [[45, 52, 61], 'oo']].forEach(([ch, v], i) => {
          ch.forEach((n) => this.choir(d, t0 + i * 8 * B, 7 * B, n, 0.11, v, 3, 2.5, 2.5));
        });
        for (let i = 0; i < 16; i++) this.taiko(d, t0 + i * 2 * B, i % 4 === 0 ? 0.3 : 0.14, 0.6);
        this.bell(d, t0 + 6 * B, 81, 0.04); this.bell(d, t0 + 22 * B, 76, 0.04);
        return 32 * B;
      },
      amb2(d, t0) {
        this.pad(d, t0, 30 * B, 34, 0.09, 420, 4, 5);
        const mel = [[62, 4], [60, 2], [57, 2], [58, 6], [57, 2]];
        let b = 0;
        mel.forEach(([n, len]) => { this.choir(d, t0 + b * B, len * B, n - 12, 0.16, 'ah', 3, 0.8, 1.5); b += len; });
        [[46, 53, 58], [45, 52, 57]].forEach((ch, i) => ch.forEach((n) => this.choir(d, t0 + 16 * B + i * 8 * B, 7 * B, n, 0.1, 'oo', 3, 2, 2.5)));
        for (let i = 0; i < 16; i++) this.taiko(d, t0 + i * 2 * B, i % 4 === 0 ? 0.3 : 0.14, 0.6);
        for (let i = 0; i < 16; i++) this.pluck(d, t0 + 16 * B + i * B, 38 + (i % 4 === 3 ? 7 : 0), 0.06, 0.3);
        return 32 * B;
      },
    };
  }

  stinger(win) {
    if (!this.ctx) return;
    this.stopMusic(1);
    const d = { out: this.musicBus, rev: this.musicRev };
    const t = this.ctx.currentTime + 0.1;
    const notes = win ? [50, 57, 62, 66, 69, 74] : [38, 50, 53, 57, 62];
    notes.forEach((n) => this.choir(d, t, 5, n, 0.16, win ? 'ah' : 'oh', 3, 0.6, 4));
    this.brass(d, t, 4, win ? 38 : 26, 0.25);
    this.taiko(d, t, 1, 0.7); this.taiko(d, t + 0.45, 0.6, 0.8); this.taiko(d, t + 0.9, 0.9, 0.6);
    if (win) this.bell(d, t + 1, 86, 0.1);
  }

  // ------------------------------------------------------------------ SFX
  noiseBurst(t, dur, type, f0, f1, vel, q = 1, wet = 0.4) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g); n.start(t, Math.random()); n.stop(t + dur + 0.05);
    this.route(g, this.dest(), 1, wet);
  }

  tone(t, dur, type, f0, f1, vel, wet = 0.3, att = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    this.route(g, this.dest(), 1, wet);
  }

  sfx(name, opts = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opts.delay || 0);
    switch (name) {
      case 'hover': this.tone(t, 0.06, 'sine', 1500, 1800, 0.05, 0.1); break;
      case 'click': this.tone(t, 0.08, 'square', 900, 600, 0.06, 0.2); this.tone(t + 0.05, 0.12, 'sine', 1400, 1400, 0.07, 0.3); break;
      case 'place':
        this.noiseBurst(t, 0.25, 'bandpass', 1200, 300, 0.3, 3);
        this.tone(t, 0.3, 'sine', 180, 70, 0.4); this.tone(t + 0.02, 0.15, 'square', 2200, 2200, 0.03, 0.4); break;
      case 'rotate': this.tone(t, 0.12, 'triangle', 500, 900, 0.1, 0.2); break;
      case 'error': this.tone(t, 0.15, 'square', 180, 150, 0.08, 0.1); break;
      case 'laser':
        this.tone(t, 0.18, 'square', 2400, 180, 0.12, 0.4);
        this.tone(t, 0.12, 'sawtooth', 1200, 300, 0.1, 0.4);
        this.noiseBurst(t, 0.08, 'highpass', 3000, 2000, 0.1); break;
      case 'plasma':
        this.tone(t, 0.6, 'sawtooth', 380, 45, 0.28, 0.5);
        this.tone(t, 0.5, 'sine', 90, 30, 0.6, 0.3);
        this.noiseBurst(t, 0.5, 'lowpass', 2500, 200, 0.45, 1, 0.6); break;
      case 'railcharge': this.tone(t, 0.9, 'sine', 300, 3200, 0.1, 0.4, 0.8); this.tone(t, 0.9, 'sawtooth', 150, 1600, 0.04, 0.4, 0.8); break;
      case 'railgun':
        this.noiseBurst(t, 0.35, 'highpass', 6000, 1500, 0.6, 0.7, 0.9);
        this.tone(t, 0.7, 'sine', 140, 28, 0.8, 0.5);
        this.tone(t, 0.9, 'sawtooth', 4000, 200, 0.06, 0.8); break;
      case 'missile':
        this.noiseBurst(t, 0.9, 'bandpass', 600, 2800, 0.35, 1.5, 0.5);
        this.tone(t, 0.25, 'sine', 160, 50, 0.4); break;
      case 'torpedo':
        this.tone(t, 1.0, 'sine', 220, 70, 0.45, 0.8);
        this.tone(t, 1.1, 'triangle', 880, 110, 0.1, 0.9);
        this.noiseBurst(t, 0.6, 'bandpass', 400, 1600, 0.2, 2, 0.7); break;
      case 'whoosh': this.noiseBurst(t, 1.1, 'bandpass', 250, 2200, 0.18, 1.2, 0.5); break;
      case 'explosion': {
        const s = opts.size || 1;
        this.noiseBurst(t, 1.4 * s, 'lowpass', 4000, 90, 0.9, 0.8, 0.8);
        this.tone(t, 1.2 * s, 'sine', 90, 24, 0.9, 0.4);
        for (let i = 0; i < 6 * s; i++) this.noiseBurst(t + 0.1 + Math.random() * 0.8 * s, 0.08, 'bandpass', 2000 + Math.random() * 3000, 800, 0.2, 2, 0.6);
        break;
      }
      case 'ripple':
        this.bell(this.dest(), t, 88, 0.06);
        this.tone(t, 0.9, 'sine', 900, 1800, 0.05, 1.0, 0.02);
        this.noiseBurst(t, 0.6, 'bandpass', 4000, 1200, 0.07, 4, 0.9); break;
      case 'sink':
        this.noiseBurst(t, 4.5, 'lowpass', 3500, 40, 1.0, 0.7, 1.0);
        this.tone(t, 3.5, 'sine', 70, 18, 1.0, 0.5);
        this.tone(t + 0.3, 3, 'sawtooth', 110, 35, 0.12, 0.8, 0.5);
        for (let i = 0; i < 20; i++) this.noiseBurst(t + Math.random() * 3, 0.1, 'bandpass', 1500 + Math.random() * 3000, 600, 0.25, 2, 0.6);
        break;
      case 'rumble': this.noiseBurst(t, 1.8, 'lowpass', 400, 60, 0.35, 1, 0.6); break;
      case 'decloak':
        this.tone(t, 1.3, 'sine', 200, 1400, 0.08, 0.9, 0.9);
        this.noiseBurst(t, 1.2, 'bandpass', 800, 5000, 0.12, 6, 0.9); break;
      case 'alarm':
        for (let i = 0; i < 2; i++) { this.tone(t + i * 0.45, 0.35, 'square', 520, 520, 0.05, 0.5); this.tone(t + i * 0.45 + 0.18, 0.2, 'square', 390, 390, 0.05, 0.5); }
        break;
      case 'incoming': this.tone(t, 1.2, 'sawtooth', 1800, 150, 0.06, 0.6, 0.3); this.noiseBurst(t, 1.2, 'bandpass', 3000, 300, 0.15, 2, 0.6); break;
    }
  }
}
