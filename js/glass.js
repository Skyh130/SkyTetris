/* =========================================================================
 *  glass.js — 유리알 한 칸을 그리는 렌더러 (PRD FR-4)
 *
 *  단색 사각형에 알파만 낮추면 '반투명한 색종이'가 된다.
 *  유리알로 보이려면 최소한 여섯 층이 필요하다.
 *
 *    1) 뒤쪽 발광      알이 스스로 빛을 머금은 느낌
 *    2) 몸통 그라데이션 위는 얇고 아래는 두꺼운 유리의 두께감
 *    3) 안쪽 굴절 테두리 빛이 모서리에서 꺾이며 생기는 밝은 띠
 *    4) 상단 하이라이트 하늘빛이 위에서 닿는 자리
 *    5) 대각 반사 스트릭 표면에 미끄러지는 한 줄기 빛
 *    6) 바깥 윤곽선     알과 배경을 갈라 주는 가장 밝은 선
 * ========================================================================= */

const Glass = {
  /* 같은 알을 매 프레임 처음부터 그리면 그라데이션 객체가 수백 개씩 생긴다.
     모양이 변하지 않는 알(굳은 알 · 조작 중인 알)은 한 번 구워 두고 재사용한다. */
  _cache: new Map(),
  _cacheKey: '',

  _sprite(key, s, bright) {
    const id = `${key}|${s}|${bright ? 1 : 0}`;
    let sp = this._cache.get(id);
    if (sp) return sp;

    const pad = Math.ceil(s * 0.62);              // 발광이 잘리지 않도록 여유
    const side = Math.ceil(s + pad * 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(side * dpr);
    cv.height = Math.ceil(side * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paint(c, pad, pad, s, key, { alpha: 1, bright, flash: 0 });

    sp = { canvas: cv, pad, side };
    if (this._cache.size > 64) this._cache.clear();
    this._cache.set(id, sp);
    return sp;
  },

  /* 칸 크기가 바뀌면 구워 둔 알을 버린다. */
  invalidate() { this._cache.clear(); },

  /* 한 칸.
     px, py : 칸의 좌상단 픽셀 좌표
     s      : 한 칸의 픽셀 크기
     key    : 조각 종류 ('I' | 'O' | ...)
     opt    : { alpha, bright, ghost, flash, pad }                       */
  cell(ctx, px, py, s, key, opt = {}) {
    const P = PIECES[key];
    if (!P) return;

    const alpha = opt.alpha === undefined ? 1 : opt.alpha;
    if (alpha <= 0.01) return;

    // 섬광이 없고 고스트가 아니며 여백이 기본값이면 구워 둔 알을 쓴다
    if (!opt.ghost && !opt.flash && opt.pad === undefined && s >= 6) {
      const sp = this._sprite(key, s, !!opt.bright);
      const prev = ctx.globalAlpha;
      if (alpha < 1) ctx.globalAlpha = prev * alpha;
      ctx.drawImage(sp.canvas, px - sp.pad, py - sp.pad, sp.side, sp.side);
      ctx.globalAlpha = prev;
      return;
    }
    return this._paint(ctx, px, py, s, key, opt);
  },

  _paint(ctx, px, py, s, key, opt = {}) {
    const P = PIECES[key];
    const alpha = opt.alpha === undefined ? 1 : opt.alpha;

    const pad = opt.pad === undefined ? Math.max(0.5, s * 0.045) : opt.pad;
    const x = px + pad, y = py + pad;
    const w = s - pad * 2, h = s - pad * 2;
    const r = Math.max(1.5, s * 0.24);
    if (w <= 0 || h <= 0) return;

    if (opt.ghost) return this._ghost(ctx, x, y, w, h, r, P, alpha);

    const bright = opt.bright ? 1 : 0;      // 조작 중인 조각은 더 진하고 밝게
    const flash = opt.flash || 0;           // 0~1, 줄이 부서지기 직전의 섬광

    ctx.save();

    /* --- 1) 뒤쪽 발광 ------------------------------------------------- */
    ctx.shadowColor = rgba(P.glow, (0.45 + bright * 0.25 + flash * 0.4) * alpha);
    ctx.shadowBlur = s * (0.34 + bright * 0.18 + flash * 0.5);
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = rgba(P.glow, 0.12 * alpha);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    /* --- 2) 몸통 그라데이션 ------------------------------------------- */
    const body = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    // 가운데는 얇게(잘 비치게), 위아래는 두껍게 — 유리알의 두께감
    const top = 0.26 + bright * 0.18 + flash * 0.5;
    const mid = 0.13 + bright * 0.12 + flash * 0.5;
    const bot = 0.38 + bright * 0.20 + flash * 0.5;
    body.addColorStop(0.00, rgba(shade(P.color, 0.45), top * alpha));
    body.addColorStop(0.42, rgba(P.color, mid * alpha));
    body.addColorStop(1.00, rgba(shade(P.color, -0.28), bot * alpha));
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = body;
    ctx.fill();

    /* 이후의 층은 알 안쪽으로만 번지게 자른다 */
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();

    /* --- 3) 안쪽 굴절 테두리 ------------------------------------------ */
    const lw = Math.max(1, s * 0.075);
    ctx.lineWidth = lw;
    ctx.strokeStyle = rgba(shade(P.color, 0.62), (0.46 + bright * 0.24) * alpha);
    roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(1, r - lw / 2));
    ctx.stroke();

    /* --- 4) 상단 하이라이트 ------------------------------------------- */
    const hl = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
    hl.addColorStop(0, rgba('#ffffff', (0.40 + bright * 0.20) * alpha));
    hl.addColorStop(1, rgba('#ffffff', 0));
    ctx.fillStyle = hl;
    ctx.fillRect(x, y, w, h * 0.55);

    /* --- 5) 대각 반사 스트릭 ------------------------------------------ */
    const sx = x + w * 0.16;
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + w * 0.24, y);
    ctx.lineTo(sx + w * 0.40, y);
    ctx.lineTo(sx + w * 0.16, y + h);
    ctx.closePath();
    const st = ctx.createLinearGradient(x, y, x + w, y + h);
    st.addColorStop(0, rgba('#ffffff', (0.36 + bright * 0.18) * alpha));
    st.addColorStop(1, rgba('#ffffff', 0.02 * alpha));
    ctx.fillStyle = st;
    ctx.fill();

    /* 바닥에 고이는 색 — 유리 아래쪽이 더 짙어 보이게 */
    const pool = ctx.createLinearGradient(0, y + h * 0.62, 0, y + h);
    pool.addColorStop(0, rgba(P.glow, 0));
    pool.addColorStop(1, rgba(P.glow, 0.30 * alpha));
    ctx.fillStyle = pool;
    ctx.fillRect(x, y + h * 0.62, w, h * 0.38);

    ctx.restore();   // clip 해제

    /* --- 6) 바깥 윤곽선 ----------------------------------------------- */
    ctx.lineWidth = Math.max(0.75, s * 0.035);
    ctx.strokeStyle = rgba('#ffffff', (0.34 + bright * 0.22 + flash * 0.5) * alpha);
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();

    /* 좌상단 점 하이라이트 — '알'로 보이게 하는 마지막 한 점 */
    if (s > 12) {
      const px2 = x + w * 0.26, py2 = y + h * 0.24, pr = s * 0.10;
      const dot = ctx.createRadialGradient(px2, py2, 0, px2, py2, pr);
      dot.addColorStop(0, rgba('#ffffff', (0.55 + bright * 0.25) * alpha));
      dot.addColorStop(1, rgba('#ffffff', 0));
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(px2, py2, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },

  /* 고스트 — 착지 자리에 남은 자국. 윤곽과 아주 옅은 채움만. (FR-4.4) */
  _ghost(ctx, x, y, w, h, r, P, alpha) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = rgba(P.color, 0.07 * alpha);
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.06);
    ctx.setLineDash([w * 0.26, w * 0.14]);
    ctx.strokeStyle = rgba(P.color, 0.46 * alpha);
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.restore();
  },

  /* 조각 하나를 격자 좌표에 그린다.
     originX/Y 는 격자 (0,0)의 픽셀 위치, hidden 위쪽 버퍼는 잘려 나간다. */
  piece(ctx, piece, originX, originY, s, opt = {}) {
    const yOffset = opt.yOffset || 0;
    for (const [cx, cy] of piece.blocks(0, yOffset)) {
      if (cy < CONFIG.BUFFER) continue;                 // 버퍼 영역은 감춘다
      this.cell(ctx,
        originX + cx * s,
        originY + (cy - CONFIG.BUFFER) * s,
        s, piece.key, opt);
    }
  },

  /* 홀드 / 넥스트 패널용 — 주어진 사각형 안에 조각을 가운데 맞춤 */
  preview(ctx, key, bx, by, bw, bh, opt = {}) {
    const P = PIECES[key];
    const cells = PIECE_ROT[key][0];
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const [x, y] of cells) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const s = Math.min(bw / (cw + 0.6), bh / (ch + 0.6));
    const ox = bx + (bw - cw * s) / 2 - minX * s;
    const oy = by + (bh - ch * s) / 2 - minY * s;
    for (const [x, y] of cells) {
      this.cell(ctx, ox + x * s, oy + y * s, s, key, opt);
    }
    return { s, ox, oy };
  },
};
