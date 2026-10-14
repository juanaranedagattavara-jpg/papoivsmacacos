// Audio 100% sintetizado con WebAudio (sin archivos externos).
export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.intensity = 0;
    this.musicTimer = null;
    this.step = 0;
    this.nextTime = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(comp);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.75;
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.16;
      this.music.connect(this.master);
      // ruido blanco reutilizable
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // distorsión para gruñidos
      this.curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        this.curve[i] = Math.tanh(x * 6);
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setSfx(on) { this.sfxOn = on; }
  setMusic(on) {
    this.musicOn = on;
    if (!on) this.stopMusic();
  }

  // ------------------------------------------------------------ primitivas
  out(vol = 1, pan = 0) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  tone(dest, { type = 'sine', f0 = 440, f1 = null, t = 0, dur = 0.2, a = 0.005, vol = 0.5, curve = 'exp', detune = 0 }) {
    const c = this.ctx;
    const now = c.currentTime + t;
    const o = c.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, now);
    if (f1 !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
      else o.frequency.linearRampToValueAtTime(f1, now + dur);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g);
    g.connect(dest);
    o.start(now);
    o.stop(now + dur + 0.05);
    return o;
  }

  noise(dest, { t = 0, dur = 0.3, vol = 0.4, type = 'bandpass', f0 = 1000, f1 = null, q = 1, a = 0.005 }) {
    const c = this.ctx;
    const now = c.currentTime + t;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, now);
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(now, Math.random() * 0.5);
    s.stop(now + dur + 0.05);
  }

  // ------------------------------------------------------------ efectos
  play(name, { vol = 1, pan = 0 } = {}) {
    if (!this.ctx || !this.sfxOn || vol < 0.03) return;
    const o = this.out(vol, pan);
    const T = (opts) => this.tone(o, opts);
    const N = (opts) => this.noise(o, opts);
    switch (name) {
      case 'click': T({ f0: 900, f1: 1300, dur: 0.06, vol: 0.25 }); break;
      case 'shootIce':
        T({ type: 'sine', f0: 1800, f1: 500, dur: 0.18, vol: 0.35 });
        T({ type: 'triangle', f0: 2600, f1: 1200, dur: 0.12, vol: 0.15 });
        N({ type: 'highpass', f0: 5000, dur: 0.12, vol: 0.12 });
        break;
      case 'throw':
        N({ type: 'bandpass', f0: 400, f1: 1600, dur: 0.22, vol: 0.4, q: 2 });
        T({ type: 'sine', f0: 220, f1: 330, dur: 0.1, vol: 0.15 });
        break;
      case 'freeze':
        for (const [f, d] of [[2093, 0.5], [2637, 0.45], [3136, 0.4], [4186, 0.3]]) T({ f0: f, dur: d, vol: 0.12 });
        N({ type: 'highpass', f0: 3000, dur: 0.35, vol: 0.2 });
        break;
      case 'bonk':
        T({ type: 'sine', f0: 380, f1: 90, dur: 0.22, vol: 0.6 });
        T({ type: 'square', f0: 900, f1: 300, dur: 0.05, vol: 0.12 });
        N({ type: 'lowpass', f0: 1200, dur: 0.08, vol: 0.3 });
        break;
      case 'fart': {
        const c = this.ctx;
        const now = c.currentTime;
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(95, now);
        osc.frequency.linearRampToValueAtTime(70, now + 0.55);
        const lfo = c.createOscillator();
        lfo.frequency.value = 28;
        const lfoG = c.createGain();
        lfoG.gain.value = 30;
        lfo.connect(lfoG); lfoG.connect(osc.frequency);
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 520; f.Q.value = 6;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.7, now + 0.03);
        g.gain.setValueAtTime(0.7, now + 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
        osc.connect(f); f.connect(g); g.connect(o);
        osc.start(now); lfo.start(now);
        osc.stop(now + 0.65); lfo.stop(now + 0.65);
        N({ type: 'lowpass', f0: 300, dur: 0.5, vol: 0.25 });
        break;
      }
      case 'leap':
        T({ type: 'sine', f0: 260, f1: 820, dur: 0.18, vol: 0.4 });
        T({ type: 'sine', f0: 820, f1: 420, t: 0.17, dur: 0.18, vol: 0.25 });
        break;
      case 'slip':
        T({ type: 'sine', f0: 1500, f1: 260, dur: 0.5, vol: 0.35, curve: 'lin' });
        T({ type: 'sine', f0: 140, f1: 60, t: 0.45, dur: 0.2, vol: 0.5 });
        break;
      case 'mutate': {
        const c = this.ctx;
        const now = c.currentTime;
        const ws = c.createWaveShaper();
        ws.curve = this.curve;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.5, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
        ws.connect(g); g.connect(o);
        for (const det of [0, 7, -5]) {
          const osc = c.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(140 + det, now);
          osc.frequency.exponentialRampToValueAtTime(55, now + 0.9);
          osc.connect(ws);
          osc.start(now); osc.stop(now + 1.0);
        }
        N({ type: 'bandpass', f0: 600, f1: 200, dur: 0.9, vol: 0.4, q: 1.5 });
        T({ type: 'sine', f0: 60, f1: 35, dur: 0.8, vol: 0.6 });
        break;
      }
      case 'infect':
        T({ type: 'square', f0: 300, f1: 600, dur: 0.15, vol: 0.12 });
        T({ type: 'square', f0: 600, f1: 250, t: 0.12, dur: 0.2, vol: 0.12 });
        break;
      case 'shock':
        N({ type: 'lowpass', f0: 900, f1: 80, dur: 0.6, vol: 0.7 });
        T({ type: 'sine', f0: 90, f1: 35, dur: 0.6, vol: 0.7 });
        break;
      case 'tag':
        T({ type: 'triangle', f0: 1200, f1: 1600, dur: 0.08, vol: 0.3 });
        T({ type: 'sine', f0: 200, f1: 70, t: 0.03, dur: 0.25, vol: 0.5 });
        N({ type: 'bandpass', f0: 2000, dur: 0.1, vol: 0.2 });
        break;
      case 'jailed':
        // trombón triste
        [[392, 0], [370, 0.28], [349, 0.56]].forEach(([f, t]) => {
          T({ type: 'sawtooth', f0: f, dur: 0.3, t, vol: 0.18 });
        });
        T({ type: 'sawtooth', f0: 330, f1: 300, t: 0.84, dur: 0.7, vol: 0.18, curve: 'lin' });
        break;
      case 'rescue':
        [523, 659, 784, 1047].forEach((f, i) => T({ type: 'triangle', f0: f, t: i * 0.07, dur: 0.3, vol: 0.3 }));
        T({ type: 'sine', f0: 2093, t: 0.28, dur: 0.5, vol: 0.12 });
        break;
      case 'steal':
        for (let i = 0; i < 4; i++) T({ type: 'square', f0: i % 2 ? 660 : 880, t: i * 0.14, dur: 0.13, vol: 0.14 });
        break;
      case 'stolen':
        for (let i = 0; i < 4; i++) T({ type: 'sawtooth', f0: i % 2 ? 330 : 440, t: i * 0.16, dur: 0.15, vol: 0.14 });
        break;
      case 'capture': {
        const notes = [523, 659, 784, 1047, 784, 1047];
        notes.forEach((f, i) => {
          T({ type: 'sawtooth', f0: f, t: i * 0.09, dur: 0.25, vol: 0.12 });
          T({ type: 'triangle', f0: f, t: i * 0.09, dur: 0.3, vol: 0.2 });
        });
        [523, 659, 784].forEach((f) => T({ type: 'triangle', f0: f, t: 0.6, dur: 1.0, vol: 0.18 }));
        T({ type: 'sine', f0: 2093, t: 0.6, dur: 0.8, vol: 0.08 });
        N({ type: 'highpass', f0: 6000, t: 0.6, dur: 0.8, vol: 0.1 });
        break;
      }
      case 'enemyCapture':
        [392, 349, 311, 262].forEach((f, i) => T({ type: 'triangle', f0: f, t: i * 0.16, dur: 0.3, vol: 0.2 }));
        break;
      case 'serum':
        for (let i = 0; i < 4; i++) T({ type: 'sine', f0: 400 + i * 180, f1: 900 + i * 220, t: i * 0.05, dur: 0.1, vol: 0.2 });
        break;
      case 'serumSpawn':
        [1319, 1568, 1976, 2637].forEach((f, i) => T({ type: 'sine', f0: f, t: i * 0.06, dur: 0.6, vol: 0.08 }));
        break;
      case 'brote':
        for (let i = 0; i < 3; i++) {
          T({ type: 'sawtooth', f0: 400, f1: 900, t: i * 0.6, dur: 0.3, vol: 0.13, curve: 'lin' });
          T({ type: 'sawtooth', f0: 900, f1: 400, t: i * 0.6 + 0.3, dur: 0.3, vol: 0.13, curve: 'lin' });
        }
        break;
      case 'beep': T({ type: 'square', f0: 660, dur: 0.12, vol: 0.18 }); break;
      case 'go':
        T({ type: 'square', f0: 1320, dur: 0.35, vol: 0.18 });
        T({ type: 'sine', f0: 2200, f1: 2600, dur: 0.4, vol: 0.12 });
        break;
      case 'win': {
        const seq = [523, 659, 784, 1047, 0, 988, 1047];
        seq.forEach((f, i) => f && T({ type: 'triangle', f0: f, t: i * 0.13, dur: 0.3, vol: 0.25 }));
        [523, 659, 784, 1047].forEach((f) => T({ type: 'sawtooth', f0: f, t: 0.95, dur: 1.2, vol: 0.06 }));
        break;
      }
      case 'lose':
        [523, 494, 466, 440].forEach((f, i) => T({ type: 'triangle', f0: f, t: i * 0.25, dur: 0.35, vol: 0.2 }));
        break;
      case 'hit': T({ type: 'triangle', f0: 1700, dur: 0.07, vol: 0.25 }); T({ type: 'sine', f0: 2600, t: 0.04, dur: 0.08, vol: 0.12 }); break;
      case 'drop': T({ type: 'sine', f0: 160, f1: 60, dur: 0.25, vol: 0.4 }); break;
      case 'return':
        N({ type: 'bandpass', f0: 400, f1: 3000, dur: 0.35, vol: 0.3, q: 3 });
        T({ type: 'sine', f0: 600, f1: 1200, dur: 0.25, vol: 0.2 });
        break;
      case 'emote': T({ type: 'sine', f0: 900, f1: 1400, dur: 0.08, vol: 0.2 }); T({ type: 'sine', f0: 1400, f1: 1100, t: 0.08, dur: 0.08, vol: 0.15 }); break;
      case 'lunge': N({ type: 'bandpass', f0: 300, f1: 900, dur: 0.2, vol: 0.4, q: 2 }); break;
      case 'knock':
        T({ type: 'sine', f0: 150, f1: 45, dur: 0.35, vol: 0.7 });
        N({ type: 'lowpass', f0: 800, dur: 0.15, vol: 0.4 });
        break;
      case 'levelup':
        [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => T({ type: 'triangle', f0: f, t: i * 0.08, dur: 0.4, vol: 0.2 }));
        break;
      case 'immune': T({ type: 'square', f0: 220, dur: 0.08, vol: 0.12 }); break;
      case 'splash': N({ type: 'bandpass', f0: 1200, f1: 400, dur: 0.25, vol: 0.2, q: 1 }); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ música
  startMusic() {
    if (!this.ctx || !this.musicOn || this.musicTimer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = setInterval(() => this.schedule(), 50);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  setIntensity(v) { this.intensity = v; }

  schedule() {
    const c = this.ctx;
    const bpm = 112 + this.intensity * 18;
    const s16 = 60 / bpm / 4;
    // progresión alegre: C - Am - F - G
    const prog = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
    const melody = [72, 0, 76, 79, 0, 76, 72, 0, 74, 0, 72, 69, 0, 67, 69, 0];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextTime < c.currentTime + 0.2) {
      const st = this.step % 64;
      const bar = Math.floor(st / 16);
      const s = st % 16;
      const t0 = this.nextTime - c.currentTime;
      const chord = prog[bar];
      const m = this.music;
      // bajo
      if (s % 4 === 0) this.tone(m, { type: 'triangle', f0: mtof(chord[0] - 12), t: t0, dur: s16 * 3.5, vol: 0.5 });
      if (s % 4 === 2) this.tone(m, { type: 'triangle', f0: mtof(chord[0]), t: t0, dur: s16 * 1.5, vol: 0.25 });
      // bombo y caja
      if (s % 8 === 0) this.tone(m, { type: 'sine', f0: 140, f1: 45, t: t0, dur: 0.18, vol: 0.7 });
      if (s % 8 === 4) this.noise(m, { type: 'bandpass', f0: 1800, t: t0, dur: 0.12, vol: 0.25 });
      // hi-hat
      if (s % 2 === 0 || this.intensity > 0.5) this.noise(m, { type: 'highpass', f0: 8000, t: t0, dur: 0.04, vol: s % 4 === 2 ? 0.12 : 0.06 });
      // marimba
      const n = melody[(s + bar * 3) % 16];
      if (n && (bar % 2 === 0 || s < 8)) this.tone(m, { type: 'sine', f0: mtof(n), t: t0, dur: 0.22, vol: 0.18 });
      // arpegio de tensión
      if (this.intensity > 0.3 && s % 2 === 1) {
        const note = chord[(s >> 1) % 3] + 24;
        this.tone(m, { type: 'square', f0: mtof(note), t: t0, dur: 0.08, vol: 0.05 * this.intensity });
      }
      this.nextTime += s16;
      this.step++;
    }
  }
}

// Voces de emote (sintetizador de voz del navegador, tono agudo tipo Papoi)
export function speak(text, team) {
  try {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[¡!¿?]/g, ''));
    u.lang = 'es-ES';
    u.pitch = team === 0 ? 2 : 1.4;
    u.rate = team === 0 ? 1.35 : 1.15;
    u.volume = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* sin voz */ }
}
