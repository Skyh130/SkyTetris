/* =========================================================================
 *  particles.js — 유리 파편과 별빛 (PRD FR-4.5, FR-4.6)
 *
 *  줄이 지워지면 유리알은 사라지는 게 아니라 '부서진다'.
 *  깨진 조각(shard)은 흩어져 떨어지고, 그중 일부는 별빛(mote)이 되어 올라간다.
 * ========================================================================= */

const MAX_PARTICLES = 400;      // NFR-2: 총량 상한

class Particles {
  constructor() {
    this.items = [];
    this.reduced = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  clear() { this.items.length = 0; }
  get count() { return this.items.length; }

  /* 파편 수백 개를 매 프레임 그라데이션으로 그리면 프레임이 무너진다.
     모양이 같은 것들은 작은 캔버스에 한 번 구워 두고 확대·회전해서 쓴다. */
  static _mote = new Map();
  static _shard = new Map();
  static MOTE_PX = 64;
  static SHARD_PX = 48;
  static SHARD_UNIT = 12;      // 구울 때 쓴 삼각형의 기준 크기

  static moteSprite(glow) {
    let cv = Particles._mote.get(glow);
    if (cv) return cv;
    const S = Particles.MOTE_PX;
    cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, rgba('#ffffff', 1));
    g.addColorStop(0.18, rgba('#ffffff', 0.7));
    g.addColorStop(0.40, rgba(glow, 0.42));
    g.addColorStop(1.00, rgba(glow, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    Particles._mote.set(glow, cv);
    return cv;
  }

  static shardSprite(color, glow) {
    const id = color + glow;
    let cv = Particles._shard.get(id);
    if (cv) return cv;
    const S = Particles.SHARD_PX, U = Particles.SHARD_UNIT, m = S / 2;
    cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    c.shadowColor = rgba(glow, 0.75);
    c.shadowBlur = U * 1.9;
    c.beginPath();                       // 깨진 유리다운 뾰족한 삼각형
    c.moveTo(m, m - U);
    c.lineTo(m + U * 0.85, m + U * 0.7);
    c.lineTo(m - U * 0.7, m + U * 0.55);
    c.closePath();
    c.fillStyle = rgba(color, 0.5);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = rgba('#ffffff', 0.78);
    c.lineWidth = 0.9;
    c.stroke();
    Particles._shard.set(id, cv);
    return cv;
  }

  _push(p) {
    if (this.items.length >= MAX_PARTICLES) return;
    this.items.push(p);
  }

  /* 한 칸이 부서진다. (cx, cy) = 칸의 중심 픽셀 좌표 */
  shatter(cx, cy, size, key, power = 1) {
    const P = PIECES[key] || { color: '#ffffff', glow: '#ffffff' };
    const shards = this.reduced ? 3 : Math.round(4 * power);
    for (let i = 0; i < shards; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(30, 165) * power;
      this._push({
        kind: 'shard',
        x: cx + rand(-size * 0.3, size * 0.3),
        y: cy + rand(-size * 0.3, size * 0.3),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - rand(20, 90),
        g: rand(220, 420),
        size: rand(size * 0.10, size * 0.28),
        rot: rand(0, Math.PI * 2),
        spin: rand(-9, 9),
        color: P.color,
        glow: P.glow,
        life: 0,
        max: rand(0.55, 1.15),
      });
    }
    const motes = this.reduced ? 2 : Math.round(3 * power);
    for (let i = 0; i < motes; i++) {
      this._push({
        kind: 'mote',
        x: cx + rand(-size * 0.5, size * 0.5),
        y: cy + rand(-size * 0.5, size * 0.5),
        vx: rand(-26, 26),
        vy: -rand(24, 88),
        size: rand(0.9, 2.4),
        color: '#ffffff',
        glow: P.glow,
        phase: rand(0, Math.PI * 2),
        life: 0,
        max: rand(0.9, 1.9),
      });
    }
  }

  /* 착지 충격파 */
  shockwave(cx, cy, w, key) {
    const P = PIECES[key] || { glow: '#ffffff' };
    this._push({
      kind: 'ring', x: cx, y: cy, w,
      glow: P.glow, life: 0, max: 0.42,
    });
  }

  /* 하드 드롭 잔상 */
  streak(x, y, w, h, key) {
    if (this.reduced) return;
    const P = PIECES[key] || { color: '#ffffff' };
    this._push({
      kind: 'streak', x, y, w, h,
      color: P.color, life: 0, max: 0.30,
    });
  }

  /* 유리알이 굳을 때 튀는 작은 반짝임 */
  spark(cx, cy, size, key) {
    const P = PIECES[key] || { glow: '#ffffff' };
    const n = this.reduced ? 1 : 3;
    for (let i = 0; i < n; i++) {
      this._push({
        kind: 'mote',
        x: cx + rand(-size * 0.5, size * 0.5),
        y: cy,
        vx: rand(-40, 40),
        vy: -rand(30, 70),
        size: rand(0.8, 1.8),
        color: '#ffffff',
        glow: P.glow,
        phase: rand(0, Math.PI * 2),
        life: 0,
        max: rand(0.35, 0.7),
      });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life += dt;
      if (p.life >= p.max) { this.items.splice(i, 1); continue; }
      if (p.kind === 'shard') {
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
      } else if (p.kind === 'mote') {
        p.vy += 26 * dt;              // 아주 약하게만 가라앉는다
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.phase += dt * 9;
      }
    }
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.items) {
      const k = p.life / p.max;

      if (p.kind === 'shard') {
        const sp = Particles.shardSprite(p.color, p.glow);
        const d = Particles.SHARD_PX * (p.size / Particles.SHARD_UNIT);
        ctx.save();                       // DPR·화면 흔들림 변환을 지키기 위해 save 로 감싼다
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(sp, -d / 2, -d / 2, d, d);
        ctx.restore();

      } else if (p.kind === 'mote') {
        const tw = 0.55 + 0.45 * Math.sin(p.phase);
        const d = p.size * (0.8 + tw * 0.5) * 8;
        ctx.globalAlpha = (1 - k) * tw;
        ctx.drawImage(Particles.moteSprite(p.glow), p.x - d / 2, p.y - d / 2, d, d);
        ctx.globalAlpha = 1;

      } else if (p.kind === 'ring') {
        const e = easeOutCubic(k);
        const a = (1 - k) * 0.55;
        ctx.strokeStyle = rgba(p.glow, a);
        ctx.lineWidth = 2.2 * (1 - k) + 0.4;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.w * (0.3 + e * 0.95), p.w * (0.10 + e * 0.30),
          0, 0, Math.PI * 2);
        ctx.stroke();

      } else if (p.kind === 'streak') {
        const a = (1 - k) * 0.30;
        const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
        g.addColorStop(0, rgba(p.color, 0));
        g.addColorStop(1, rgba(p.color, a));
        ctx.fillStyle = g;
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    }
    ctx.restore();
  }
}
