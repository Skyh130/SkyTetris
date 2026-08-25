/* =========================================================================
 *  audio.js — Web Sfx 로 합성한 유리 소리 (PRD FR-7)
 *  외부 음원 파일을 쓰지 않는다. 전부 코드로 만든다. (NFR-5)
 * ========================================================================= */

const Sfx = {
  ctx: null,
  master: null,
  delay: null,
  muted: Store.get('glassnight.muted') === '1',

  /* 브라우저 자동재생 정책 — 첫 사용자 입력에서 연다 (FR-7.4) */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);

      // 유리다운 잔향 — 짧은 피드백 딜레이로 대신한다
      this.delay = this.ctx.createDelay(0.6);
      this.delay.delayTime.value = 0.18;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.26;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.30;
      const damp = this.ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 3600;
      this.delay.connect(fb); fb.connect(this.delay);
      this.delay.connect(damp); damp.connect(wet); wet.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    Store.set('glassnight.muted', this.muted ? '1' : '0');
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  },

  /* 한 음. 유리알을 튕긴 소리에 가깝게 배음 하나를 얹는다. */
  tone(freq, {
    dur = 0.5, type = 'sine', gain = 0.2, when = 0,
    harmonic = 0.35, send = 0.5, glide = 0,
  } = {}) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(gain, t0 + 0.008);      // 딱 하고 붙는 어택
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    out.connect(this.master);
    if (this.delay && send > 0) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      out.connect(s); s.connect(this.delay);
    }

    const mk = (f, g, ty) => {
      const o = this.ctx.createOscillator();
      o.type = ty;
      o.frequency.setValueAtTime(f, t0);
      if (glide) o.frequency.exponentialRampToValueAtTime(f * glide, t0 + dur);
      const og = this.ctx.createGain();
      og.gain.value = g;
      o.connect(og); og.connect(out);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    };
    mk(freq, 1, type);
    if (harmonic > 0) mk(freq * 2.76, harmonic, 'sine');      // 유리 특유의 비배수 배음
  },

  /* 짧은 잡음 — 부서지는 소리의 결 */
  noise(dur = 0.14, gain = 0.10, freq = 2600) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0);
  },

  /* 5음 음계 — 무엇을 눌러도 서로 어울리게 */
  scale: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  note(i, base = 523.25) {
    const s = this.scale[clamp(i, 0, this.scale.length - 1)];
    return base * Math.pow(2, s / 12);
  },

  move()   { this.tone(this.note(1, 261.6), { dur: 0.07, gain: 0.035, harmonic: 0.1, send: 0.1 }); },
  rotate() { this.tone(this.note(3, 349.2), { dur: 0.10, gain: 0.045, harmonic: 0.2, send: 0.2 }); },
  hold()   { this.tone(this.note(2, 392.0), { dur: 0.24, gain: 0.07, type: 'triangle' }); },

  /* 착지 — 낮은 유리 두드림 (FR-7.2) */
  lock() {
    this.tone(this.note(0, 174.6), { dur: 0.22, gain: 0.10, type: 'triangle', harmonic: 0.5, send: 0.25 });
    this.noise(0.06, 0.035, 1400);
  },

  hardDrop() {
    this.tone(this.note(0, 130.8), { dur: 0.30, gain: 0.14, type: 'triangle', harmonic: 0.45, glide: 0.72 });
    this.noise(0.10, 0.06, 900);
  },

  /* 줄 삭제 — 유리 차임 아르페지오. 지운 줄이 많을수록 높이 올라간다. */
  clear(lines, tspin, b2b) {
    const steps = Math.min(9, 2 + lines * 2 + (tspin ? 2 : 0));
    const base = tspin ? 587.33 : 523.25;
    for (let i = 0; i < steps; i++) {
      this.tone(this.note(i, base), {
        dur: 0.55 + i * 0.05,
        gain: 0.085,
        when: i * 0.045,
        harmonic: 0.42,
        send: 0.7,
      });
    }
    this.noise(0.18, 0.05 + lines * 0.012, 3200);
    if (b2b) this.tone(this.note(9, base), { dur: 1.0, gain: 0.06, when: 0.22, send: 0.9 });
  },

  /* 퍼펙트 클리어 — 이 게임에서 가장 드문 순간이므로 가장 길게 울린다 */
  perfectClear() {
    [0, 2, 4, 5, 7, 9].forEach((i, k) => {
      this.tone(this.note(i, 523.25), {
        dur: 1.6, gain: 0.085, when: k * 0.075, harmonic: 0.5, send: 1,
      });
    });
    this.tone(this.note(0, 261.6), { dur: 2.0, gain: 0.07, type: 'triangle', send: 0.8 });
    this.noise(0.4, 0.05, 4200);
  },

  levelUp() {
    [0, 2, 4, 6].forEach((i, k) => {
      this.tone(this.note(i, 392.0), { dur: 0.8, gain: 0.075, when: k * 0.10, send: 0.8 });
    });
  },

  gameOver() {
    [6, 4, 2, 0].forEach((i, k) => {
      this.tone(this.note(i, 261.6), {
        dur: 1.1, gain: 0.10, when: k * 0.16, type: 'triangle', send: 0.7,
      });
    });
  },
};
