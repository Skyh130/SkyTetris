/* =========================================================================
 *  sky.js — 짙어가는 가을 밤하늘 (PRD FR-5)
 *
 *  레벨이 오르면 밤이 깊어진다. 해거름 → 초저녁 → 깊은 밤 → 자정 → 서리 새벽.
 *  레벨업 순간에 배경이 툭 끊기지 않도록 두 시각의 색을 보간해서 잇고,
 *  하늘·별·안개처럼 잘 변하지 않는 층은 오프스크린에 구워 두고 재사용한다.
 * ========================================================================= */

/* 레벨 → 그 순간의 하늘 상태 */
function phaseAt(level) {
  const ps = NIGHT_PHASES;
  if (level <= ps[0].at) return { ...ps[0], index: 0, t: 0, ridge: ps[0].sky[3] };
  if (level >= ps[ps.length - 1].at) {
    const last = ps[ps.length - 1];
    return { ...last, index: ps.length - 1, t: 0, ridge: last.sky[3] };
  }
  let i = 0;
  while (i < ps.length - 1 && level > ps[i + 1].at) i++;
  const a = ps[i], b = ps[i + 1];
  const t = clamp((level - a.at) / (b.at - a.at), 0, 1);
  return {
    index: t < 0.5 ? i : i + 1,
    t,
    name: t < 0.5 ? a.name : b.name,
    subtitle: t < 0.5 ? a.subtitle : b.subtitle,
    sky: a.sky.map((c, k) => mixHex(c, b.sky[k], t)),
    star: lerp(a.star, b.star, t),
    starTint: mixHex(a.starTint, b.starTint, t),
    moon: {
      y: lerp(a.moon.y, b.moon.y, t),
      r: lerp(a.moon.r, b.moon.r, t),
      alpha: lerp(a.moon.alpha, b.moon.alpha, t),
      tint: mixHex(a.moon.tint, b.moon.tint, t),
    },
    haze: t < 0.5 ? a.haze : b.haze,
    leafTint: (t < 0.5 ? a : b).leafTint,
    ridge: mixHex(a.sky[3], b.sky[3], t),
  };
}

class Sky {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');   // 하늘 + 별 + 안개를 구워 두는 곳
    this.bctx = this.base.getContext('2d');
    this.w = 0; this.h = 0;

    this.level = 1;          // 목표 레벨
    this.shownLevel = 1;     // 화면에 실제로 반영 중인 레벨 (부드럽게 따라간다)
    this.bakedLevel = -99;   // base 캔버스가 구워진 시점의 레벨

    this.stars = [];
    this.brightStars = [];
    this.leaves = [];
    this.meteors = [];
    this.clouds = [];
    this.meteorTimer = rand(6, 14);
    this.time = 0;

    this.reduced = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;   // NFR-7

    this.resize();
  }

  setLevel(level) { this.level = level; }
  get phase() { return phaseAt(this.shownLevel); }

  /* ------------------------------------------------------------- 크기 */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.w = w; this.h = h;
    this.ctx = fitCanvas(this.canvas, w, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.base.width = Math.round(w * dpr);
    this.base.height = Math.round(h * dpr);
    this.bctx = this.base.getContext('2d');
    this.bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.seedStars();
    this.seedLeaves();
    this.seedClouds();
    this.bakedLevel = -99;      // 다시 구워야 한다
  }

  /* ------------------------------------------------------------- 별 */
  seedStars() {
    const target = clamp(Math.round((this.w * this.h) / 5200), 90, 460);
    this.stars = [];
    this.brightStars = [];
    for (let i = 0; i < target; i++) {
      // 위쪽 하늘일수록 촘촘하게 (제곱 분포)
      const y = Math.pow(Math.random(), 1.5) * this.h * 0.92;
      const s = {
        x: Math.random() * this.w,
        y,
        r: rand(0.35, 1.5),
        base: rand(0.35, 1),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.4, 1.8),
        layer: Math.random(),          // 시차용 깊이
        rank: Math.random(),           // 이 별이 몇 번째 시각부터 보이는지
      };
      // 크고 밝은 별 일부만 프레임마다 깜빡이게 해서 비용을 아낀다
      if (s.r > 1.05 && this.brightStars.length < 70) this.brightStars.push(s);
      else this.stars.push(s);
    }
  }

  /* ------------------------------------------------------------- 낙엽 */
  seedLeaves() {
    const n = this.reduced ? 5 : clamp(Math.round(this.w / 105), 8, 20);
    this.leaves = [];
    for (let i = 0; i < n; i++) this.leaves.push(this.newLeaf(true));
  }

  newLeaf(anywhere = false) {
    return {
      x: rand(-40, this.w + 40),
      y: anywhere ? rand(-this.h * 0.2, this.h) : rand(-120, -20),
      size: rand(5, 12),
      vy: rand(14, 34),
      sway: rand(16, 42),
      swaySpeed: rand(0.5, 1.3),
      phase: rand(0, Math.PI * 2),
      spin: rand(-1.2, 1.2),
      rot: rand(0, Math.PI * 2),
      tint: randInt(0, 2),
      alpha: rand(0.20, 0.52),
    };
  }

  /* 구름 — 지평선 위를 아주 느리게 지나는 옅은 띠 */
  seedClouds() {
    const n = this.reduced ? 2 : 4;
    this.clouds = [];
    for (let i = 0; i < n; i++) {
      this.clouds.push({
        x: rand(-0.2, 1.2),
        y: rand(0.42, 0.78),
        w: rand(0.22, 0.5),
        h: rand(0.02, 0.055),
        vx: rand(0.004, 0.014) * (Math.random() < 0.5 ? -1 : 1),
        alpha: rand(0.05, 0.13),
      });
    }
  }

  /* 능선 — 하늘과 땅을 가르는 선. 두 겹으로 두어 원근이 생긴다.
     매번 계산하면 아까우니 씨앗에서 한 번만 만들고 base 에 함께 굽는다. */
  ridgeLine(seed, points, amp, base) {
    const pts = [];
    let v = seed;
    const rnd = () => { v = (v * 9301 + 49297) % 233280; return v / 233280; };
    for (let i = 0; i <= points; i++) {
      const t = i / points;
      const bump = Math.sin(t * Math.PI * 3 + seed) * 0.35 + rnd() * 0.65;
      pts.push([t * this.w, this.h * base - bump * amp]);
    }
    return pts;
  }

  /* ----------------------------------------------- 하늘·별·안개 굽기 */
  bake() {
    const p = this.phase;
    const c = this.bctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);

    /* 4-스톱 세로 그라데이션 (FR-5.1) */
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, p.sky[0]);
    g.addColorStop(0.38, p.sky[1]);
    g.addColorStop(0.72, p.sky[2]);
    g.addColorStop(1.00, p.sky[3]);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    /* 은하수 비슷한 옅은 띠 — 밤이 깊어질수록 드러난다 */
    if (p.star > 0.55) {
      c.save();
      c.globalAlpha = (p.star - 0.55) * 0.5;
      c.translate(w * 0.62, h * 0.30);
      c.rotate(-0.5);
      const band = c.createLinearGradient(0, -h * 0.42, 0, h * 0.42);
      band.addColorStop(0, rgba(p.starTint, 0));
      band.addColorStop(0.5, rgba(p.starTint, 0.09));
      band.addColorStop(1, rgba(p.starTint, 0));
      c.fillStyle = band;
      c.fillRect(-w, -h * 0.42, w * 2, h * 0.84);
      c.restore();
    }

    /* 잔잔한 별들 (FR-5.2) */
    c.fillStyle = p.starTint;
    for (const s of this.stars) {
      if (s.rank > p.star) continue;               // 아직 돋지 않은 별
      c.globalAlpha = s.base * p.star * 0.75;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    /* 지평선 능선 — 먼 산이 두 겹으로 겹쳐 하늘에 깊이를 준다 */
    const drawRidge = (base, amp, seed, tint, alpha) => {
      const pts = this.ridgeLine(seed, 26, amp, base);
      c.beginPath();
      c.moveTo(0, h);
      c.lineTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        c.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      c.lineTo(w, h);
      c.closePath();
      c.fillStyle = rgba(tint, alpha);
      c.fill();
    };
    drawRidge(0.965, h * 0.075, 7, shade(p.ridge, -0.55), 0.5);
    drawRidge(1.0, h * 0.055, 91, shade(p.ridge, -0.75), 0.68);

    /* 지평선 안개 (FR-5.6) */
    const haze = c.createLinearGradient(0, h * 0.62, 0, h);
    haze.addColorStop(0, 'rgba(0,0,0,0)');
    haze.addColorStop(1, p.haze);
    c.fillStyle = haze;
    c.fillRect(0, h * 0.62, w, h * 0.38);

    this.bakedLevel = this.shownLevel;
  }

  /* ------------------------------------------------------------ 갱신 */
  update(dt) {
    this.time += dt;

    // 레벨 변화를 천천히 따라가서 하늘이 서서히 물든다
    const speed = this.reduced ? 4 : 0.9;
    this.shownLevel += (this.level - this.shownLevel) * Math.min(1, dt * speed);
    if (Math.abs(this.level - this.shownLevel) < 0.004) this.shownLevel = this.level;
    if (Math.abs(this.shownLevel - this.bakedLevel) > 0.05) this.bake();

    for (const cl of this.clouds) {
      cl.x += cl.vx * dt;
      if (cl.x > 1.35) cl.x = -0.35;
      if (cl.x < -0.35) cl.x = 1.35;
    }

    for (const l of this.leaves) {
      l.y += l.vy * dt;
      l.phase += l.swaySpeed * dt;
      l.rot += l.spin * dt;
      if (l.y > this.h + 40) Object.assign(l, this.newLeaf(false));
    }

    if (!this.reduced) {
      this.meteorTimer -= dt;
      if (this.meteorTimer <= 0) {
        this.meteorTimer = rand(9, 26);
        this.spawnMeteor();
      }
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const m = this.meteors[i];
        m.life += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.life > m.max) this.meteors.splice(i, 1);
      }
    }
  }

  spawnMeteor() {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = rand(520, 900);
    const ang = rand(0.35, 0.62);
    this.meteors.push({
      x: dir > 0 ? rand(-80, this.w * 0.55) : rand(this.w * 0.45, this.w + 80),
      y: rand(-40, this.h * 0.4),
      vx: Math.cos(ang) * speed * dir,
      vy: Math.sin(ang) * speed,
      len: rand(70, 180),
      life: 0,
      max: rand(0.5, 0.95),
    });
  }

  /* ------------------------------------------------------------ 그리기 */
  draw() {
    const c = this.ctx, w = this.w, h = this.h;
    const p = this.phase;

    c.clearRect(0, 0, w, h);
    c.drawImage(this.base, 0, 0, w, h);

    this.drawClouds(c, p);
    this.drawMoon(c, p);

    /* 깜빡이는 밝은 별 (FR-5.2) */
    for (const s of this.brightStars) {
      if (s.rank > p.star) continue;
      const tw = 0.55 + 0.45 * Math.sin(this.time * s.speed + s.phase);
      const a = s.base * p.star * tw;
      const r = s.r * (0.85 + tw * 0.4);
      c.globalAlpha = a;
      c.fillStyle = p.starTint;
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.fill();
      // 십자 광채
      c.globalAlpha = a * 0.35;
      c.fillRect(s.x - r * 3.4, s.y - 0.4, r * 6.8, 0.8);
      c.fillRect(s.x - 0.4, s.y - r * 3.4, 0.8, r * 6.8);
    }
    c.globalAlpha = 1;

    this.drawMeteors(c);
    this.drawLeaves(c, p);
  }

  /* 구름 — 별빛을 살짝 가리며 지나간다 (FR-5.4 결) */
  drawClouds(c, p) {
    const warm = mixHex(p.sky[2], p.starTint, 0.28);
    for (const cl of this.clouds) {
      const x = cl.x * this.w, y = cl.y * this.h;
      const rw = cl.w * this.w, rh = cl.h * this.h;
      const g = c.createRadialGradient(x, y, 0, x, y, Math.max(rw, rh));
      g.addColorStop(0, rgba(warm, cl.alpha));
      g.addColorStop(0.55, rgba(warm, cl.alpha * 0.45));
      g.addColorStop(1, rgba(warm, 0));
      c.save();
      c.translate(x, y);
      c.scale(1, rh / Math.max(rw, rh));
      c.translate(-x, -y);
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, Math.max(rw, rh), 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  /* 달 (FR-5.3) */
  drawMoon(c, p) {
    const w = this.w, h = this.h;
    const mx = w * 0.79;
    const my = h * p.moon.y;
    const r = Math.min(w, h) * p.moon.r;
    if (p.moon.alpha <= 0.02) return;

    c.save();
    const halo = c.createRadialGradient(mx, my, r * 0.6, mx, my, r * 7);
    halo.addColorStop(0, rgba(p.moon.tint, 0.18 * p.moon.alpha));
    halo.addColorStop(0.35, rgba(p.moon.tint, 0.05 * p.moon.alpha));
    halo.addColorStop(1, rgba(p.moon.tint, 0));
    c.fillStyle = halo;
    c.beginPath();
    c.arc(mx, my, r * 7, 0, Math.PI * 2);
    c.fill();

    const disc = c.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r);
    disc.addColorStop(0, rgba('#ffffff', 0.95 * p.moon.alpha));
    disc.addColorStop(0.6, rgba(p.moon.tint, 0.85 * p.moon.alpha));
    disc.addColorStop(1, rgba(p.moon.tint, 0.55 * p.moon.alpha));
    c.fillStyle = disc;
    c.beginPath();
    c.arc(mx, my, r, 0, Math.PI * 2);
    c.fill();

    // 바다(어두운 무늬) 몇 점
    c.globalAlpha = 0.10 * p.moon.alpha;
    c.fillStyle = '#8a7f6a';
    for (const [dx, dy, dr] of [[-0.30, -0.15, 0.26], [0.22, 0.20, 0.20], [0.05, -0.38, 0.14]]) {
      c.beginPath();
      c.arc(mx + r * dx, my + r * dy, r * dr, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /* 유성 (FR-5.5) */
  drawMeteors(c) {
    for (const m of this.meteors) {
      const k = m.life / m.max;
      const a = Math.sin(Math.PI * k) * 0.85;
      const n = Math.hypot(m.vx, m.vy) || 1;
      const tx = m.x - (m.vx / n) * m.len;
      const ty = m.y - (m.vy / n) * m.len;
      const g = c.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.4, `rgba(200,225,255,${a * 0.35})`);
      g.addColorStop(1, 'rgba(200,225,255,0)');
      c.strokeStyle = g;
      c.lineWidth = 1.8;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(m.x, m.y);
      c.stroke();
    }
  }

  /* 낙엽 (FR-5.4) */
  drawLeaves(c, p) {
    for (const l of this.leaves) {
      const x = l.x + Math.sin(l.phase) * l.sway;
      const tilt = Math.sin(l.phase * 0.7);
      c.save();
      c.translate(x, l.y);
      c.rotate(l.rot);
      c.scale(1, 0.45 + Math.abs(tilt) * 0.55);     // 팔랑이며 뒤집히는 느낌
      c.globalAlpha = l.alpha;
      c.fillStyle = p.leafTint[l.tint % p.leafTint.length];
      c.beginPath();
      c.moveTo(0, -l.size);
      c.quadraticCurveTo(l.size * 0.8, -l.size * 0.2, 0, l.size);
      c.quadraticCurveTo(-l.size * 0.8, -l.size * 0.2, 0, -l.size);
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
  }
}
