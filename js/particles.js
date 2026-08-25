/* =========================================================================
 *  particles.js — 유리 파편과 별빛 (PRD FR-4.5, FR-4.6)
 *
 *  줄이 지워지면 유리알은 사라지는 게 아니라 '부서진다'.
 *  깨진 조각(shard)은 흩어져 떨어지고, 그중 일부는 별빛(mote)이 되어 올라간다.
 * ========================================================================= */

const MAX_PARTICLES = 520;      // NFR-2: 총량 상한

class Particles {
  constructor() {
    this.items = [];
    this.reduced = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  clear() { this.items.length = 0; }
  get count() { return this.items.length; }

  _push(p) {
    if (this.items.length >= MAX_PARTICLES) return;
    this.items.push(p);
  }

  /* 한 칸이 부서진다. (cx, cy) = 칸의 중심 픽셀 좌표 */
  shatter(cx, cy, size, key, power = 1) {
    const P = PIECES[key] || { color: '#ffffff', glow: '#ffffff' };
    const shards = this.reduced ? 3 : Math.round(7 * power);
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
    const motes = this.reduced ? 2 : Math.round(5 * power);
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
        const a = (1 - k) * 0.9;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.shadowColor = rgba(p.glow, a * 0.7);
        ctx.shadowBlur = p.size * 2.2;
        ctx.beginPath();                       // 깨진 유리다운 뾰족한 삼각형
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.85, p.size * 0.7);
        ctx.lineTo(-p.size * 0.7, p.size * 0.55);
        ctx.closePath();
        ctx.fillStyle = rgba(p.color, a * 0.75);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', a * 0.55);
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore();

      } else if (p.kind === 'mote') {
        const tw = 0.55 + 0.45 * Math.sin(p.phase);
        const a = (1 - k) * tw;
        const r = p.size * (0.8 + tw * 0.5);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
        g.addColorStop(0, rgba('#ffffff', a));
        g.addColorStop(0.35, rgba(p.glow, a * 0.5));
        g.addColorStop(1, rgba(p.glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
        ctx.fill();

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
