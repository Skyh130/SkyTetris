/* =========================================================================
 *  game.js — 게임 루프 · 상태 기계 · 연출 (PRD §8.4)
 *
 *    READY ──시작──> PLAYING ──일시정지──> PAUSED ──재개──> PLAYING
 *                       │                                     │
 *                       ├──줄 삭제──> CLEARING ────────────────┘
 *                       └──스폰 실패──> GAMEOVER ──R──> READY
 * ========================================================================= */

const STORAGE_KEY = 'glassnight.best';

class Game {
  constructor(els) {
    this.els = els;
    this.engine = new Engine();
    this.sky = new Sky(els.sky);
    this.fx = new Particles();

    this.ctx = null;
    this.holdCtx = null;
    this.nextCtx = null;
    this.cell = 24;

    this.state = 'ready';
    this.dropTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.softDropping = false;
    this.clearing = null;
    this.shake = 0;
    this.time = 0;
    this.lastFrame = 0;

    this.best = Number(localStorage.getItem(STORAGE_KEY) || 0) || 0;
    this.layout();
    this.syncHud();
    this.showOverlay('ready');

    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 120));
  }

  /* ------------------------------------------------------------- 레이아웃 */
  layout() {
    this.sky.resize();

    const compact = window.innerWidth < 860;
    this.compact = compact;
    const availW = compact
      ? window.innerWidth - 28
      : window.innerWidth - 400;

    // 좁은 화면에서는 제목·트레이·터치 버튼이 차지하는 높이를 실제로 재서 뺀다.
    let availH;
    if (compact) {
      const bar = document.querySelector('.title-bar');
      const pad = document.querySelector('.touchpad');
      const chrome = (bar && bar.offsetParent !== null ? bar.offsetHeight : 0)
        + (pad ? pad.offsetHeight : 0);
      availH = window.innerHeight - chrome - 108;   // 트레이 + 여백
    } else {
      availH = window.innerHeight - 96;
    }

    const cell = Math.floor(Math.min(availH / CONFIG.ROWS, availW / CONFIG.COLS));
    this.cell = clamp(cell, 12, 40);

    const w = this.cell * CONFIG.COLS;
    const h = this.cell * CONFIG.ROWS;
    this.ctx = fitCanvas(this.els.board, w, h);
    this.els.field.style.width = w + 'px';

    // 넥스트는 넓은 화면에선 세로로, 좁은 화면에선 가로로 늘어놓는다
    this.nextCount = compact ? 3 : CONFIG.NEXT_COUNT;
    if (compact) {
      // 홀드 · 넥스트 · 기록이 한 줄에 들어가야 하므로 남는 폭에서 역산한다
      const trayRoom = window.innerWidth - 262;      // 홀드 + 기록 + 여백을 뺀 나머지
      const sw = Math.round(clamp(
        Math.min(this.cell * 2.3, trayRoom / this.nextCount), 28, 54));
      const sh = Math.round(sw * 0.78);
      this.holdCtx = fitCanvas(this.els.hold, sw, sh);
      this.nextCtx = fitCanvas(this.els.next, sw * this.nextCount, sh);
    } else {
      const ps = Math.round(clamp(this.cell * 3.4, 56, 104));
      this.holdCtx = fitCanvas(this.els.hold, ps, Math.round(ps * 0.72));
      this.nextCtx = fitCanvas(this.els.next,
        ps, Math.round(ps * 0.62 * CONFIG.NEXT_COUNT));
    }

    this.draw();
  }

  /* --------------------------------------------------------------- 상태 */
  start() {
    this.engine.reset();
    this.fx.clear();
    this.clearing = null;
    this.dropTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.softDropping = false;
    this.shake = 0;
    this.sky.setLevel(1);
    this.sky.shownLevel = 1;
    this.engine.spawn();
    this.state = 'playing';
    this.hideOverlay();
    this.syncHud();
    Sfx.resume();
  }

  togglePause() {
    if (this.state === 'playing' || this.state === 'clearing') {
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.showOverlay('paused');
    } else if (this.state === 'paused') {
      this.state = this.pausedFrom || 'playing';
      this.hideOverlay();
    }
  }

  restart() {
    if (this.state === 'ready') this.start();
    else { this.state = 'ready'; this.start(); }
  }

  gameOver() {
    this.state = 'gameover';
    Sfx.gameOver();
    if (this.engine.score > this.best) {
      this.best = this.engine.score;
      localStorage.setItem(STORAGE_KEY, String(this.best));
      this.newBest = true;
    } else this.newBest = false;
    this.syncHud();
    this.showOverlay('gameover');
  }

  /* --------------------------------------------------------- 플레이어 조작 */
  get canControl() { return this.state === 'playing' && this.engine.piece; }

  moveH(dir) {
    if (!this.canControl) return;
    if (this.engine.move(dir, 0)) {
      Sfx.move();
      this.touchLock();
    }
  }

  rotate(dir) {
    if (!this.canControl) return;
    if (this.engine.rotate(dir)) {
      Sfx.rotate();
      this.touchLock();
    }
  }

  setSoftDrop(on) { this.softDropping = on && this.state === 'playing'; }

  hardDrop() {
    if (!this.canControl) return;
    const p = this.engine.piece;
    const dist = this.engine.dropDistance();
    if (dist > 0) {
      // 낙하 잔상 (FR-4.6)
      const cols = new Map();
      for (const [x, y] of p.blocks()) {
        cols.set(x, Math.max(cols.get(x) ?? -99, y));
      }
      for (const [x, y] of cols) {
        const top = (y - CONFIG.BUFFER + 1) * this.cell;
        this.fx.streak(x * this.cell, top - dist * this.cell,
          this.cell, dist * this.cell, p.key);
      }
      this.engine.move(0, dist);
      this.engine.addDropScore(dist, true);
    }
    Sfx.hardDrop();
    this.shake = Math.min(9, 3 + dist * 0.35);
    this.lockNow();
  }

  hold() {
    if (!this.canControl) return;
    if (this.engine.swapHold()) {
      Sfx.hold();
      this.lockTimer = 0;
      this.lockResets = 0;
      if (this.engine.gameOver) this.gameOver();
      this.syncHud();
    }
  }

  /* 바닥에 닿은 상태에서 움직이면 락 딜레이를 되돌린다 (FR-1.6) */
  touchLock() {
    if (this.engine.collides(this.engine.piece, 0, 1)
      && this.lockResets < CONFIG.LOCK_RESET_LIMIT) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  /* --------------------------------------------------------------- 갱신 */
  update(dt) {
    this.time += dt;
    if (this.input) this.input.update(dt);      // DAS/ARR 자동 반복
    this.sky.update(dt);
    this.fx.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 34);

    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'clearing') this.updateClearing(dt);
  }

  updatePlaying(dt) {
    const p = this.engine.piece;
    if (!p) return;

    let interval = gravityFor(this.engine.level);
    if (this.softDropping) {
      interval = Math.max(16, interval / CONFIG.SOFT_DROP_FACTOR);
    }

    this.dropTimer += dt * 1000;
    while (this.dropTimer >= interval) {
      this.dropTimer -= interval;
      if (this.engine.collides(this.engine.piece, 0, 1)) break;
      this.engine.move(0, 1);
      if (this.softDropping) this.engine.addDropScore(1, false);
    }

    if (this.engine.collides(this.engine.piece, 0, 1)) {
      this.lockTimer += dt * 1000;
      if (this.lockTimer >= CONFIG.LOCK_DELAY) this.lockNow();
    } else {
      this.lockTimer = 0;
    }
  }

  lockNow() {
    const p = this.engine.piece;
    const key = p.key;
    const result = this.engine.lockPiece();
    this.lockTimer = 0;
    this.lockResets = 0;
    this.dropTimer = 0;

    // 착지 반짝임 + 충격파
    for (const [x, y] of result.cells) {
      if (y < CONFIG.BUFFER) continue;
      this.fx.spark(
        (x + 0.5) * this.cell, (y - CONFIG.BUFFER) * this.cell, this.cell, key);
    }
    const bottom = Math.max(...result.cells.map(([, y]) => y));
    const cx = result.cells.reduce((a, [x]) => a + x, 0) / result.cells.length;
    this.fx.shockwave((cx + 0.5) * this.cell,
      (bottom - CONFIG.BUFFER + 1) * this.cell, this.cell * 1.6, key);

    if (result.cleared > 0) {
      Sfx.clear(result.cleared, result.tspin, result.b2b);
      this.announce(result);
      this.clearing = { rows: result.rows, t: 0, shattered: false, level: result.levelUp };
      this.state = 'clearing';
      if (result.levelUp) this.onLevelUp();
    } else {
      Sfx.lock();
      if (result.tspin) this.announce(result);
      if (this.engine.gameOver) return this.gameOver();
      if (!this.engine.spawn()) return this.gameOver();
    }
    this.syncHud();
  }

  updateClearing(dt) {
    const c = this.clearing;
    c.t += dt * 1000;
    const half = CONFIG.CLEAR_ANIM * 0.42;

    if (!c.shattered && c.t >= half) {
      c.shattered = true;
      for (const y of c.rows) {
        for (let x = 0; x < CONFIG.COLS; x++) {
          const key = this.engine.board[y][x];
          if (!key) continue;
          this.fx.shatter(
            (x + 0.5) * this.cell,
            (y - CONFIG.BUFFER + 0.5) * this.cell,
            this.cell, key, 1);
        }
      }
      this.shake = Math.max(this.shake, 2 + c.rows.length * 1.6);
    }

    if (c.t >= CONFIG.CLEAR_ANIM) {
      this.engine.removeRows(c.rows);
      this.clearing = null;
      if (this.engine.gameOver) return this.gameOver();
      if (!this.engine.spawn()) return this.gameOver();
      this.state = 'playing';
      this.syncHud();
    }
  }

  onLevelUp() {
    Sfx.levelUp();
    this.sky.setLevel(this.engine.level);
    const p = phaseAt(this.engine.level);
    this.banner(p.name, p.subtitle);            // FR-5.7
  }

  /* --------------------------------------------------------------- 연출 */
  announce(result) {
    const lines = [];
    if (result.label) lines.push(result.label);
    const flavour = CLEAR_LINES[result.cleared];
    if (result.tspin) lines.push(CLEAR_LINES.tspin[0]);
    else if (flavour) lines.push(flavour[randInt(0, flavour.length - 1)]);
    if (result.b2b) lines.push(CLEAR_LINES.b2b[0]);
    if (result.combo > 0) lines.push(`${result.combo} 콤보`);
    this.toast(lines.join(' · '), result.cleared >= 4 || result.tspin ? 'big' : '');
  }

  toast(text, cls = '') {
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = text;
    this.els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  banner(title, subtitle) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML = `<strong></strong><span></span>`;
    el.querySelector('strong').textContent = title;
    el.querySelector('span').textContent = subtitle;
    this.els.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  /* ----------------------------------------------------------------- HUD */
  syncHud() {
    const e = this.engine;
    const p = phaseAt(e.level);
    this.els.score.textContent = e.score.toLocaleString('ko-KR');
    this.els.best.textContent = Math.max(this.best, e.score).toLocaleString('ko-KR');
    this.els.level.textContent = e.level;
    this.els.lines.textContent = e.lines;
    this.els.phase.textContent = p.name;
    this.els.phaseSub.textContent = p.subtitle;
  }

  /* -------------------------------------------------------------- 그리기 */
  draw() {
    if (!this.ctx) return;
    this.sky.draw();
    this.drawBoard();
    this.drawHold();
    this.drawNext();
  }

  drawBoard() {
    const ctx = this.ctx;
    const s = this.cell;
    const w = s * CONFIG.COLS, h = s * CONFIG.ROWS;
    const e = this.engine;

    ctx.clearRect(0, 0, w, h);            // 배경은 비워 둔다 — 하늘이 비쳐야 한다

    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate(rand(-this.shake, this.shake) * 0.5,
        rand(-this.shake, this.shake) * 0.5);
    }

    this.drawWell(ctx, w, h, s);

    const clearRows = this.clearing ? this.clearing.rows : null;
    const flash = this.clearing
      ? clamp(this.clearing.t / (CONFIG.CLEAR_ANIM * 0.42), 0, 1) : 0;

    /* 굳은 유리알 (FR-4.3: 조작 중인 조각보다 옅게) */
    for (let y = CONFIG.BUFFER; y < CONFIG.TOTAL_ROWS; y++) {
      const clearingRow = clearRows && clearRows.includes(y);
      if (clearingRow && this.clearing.shattered) continue;   // 이미 부서졌다
      for (let x = 0; x < CONFIG.COLS; x++) {
        const key = e.board[y][x];
        if (!key) continue;
        Glass.cell(ctx, x * s, (y - CONFIG.BUFFER) * s, s, key, {
          alpha: 0.94,
          flash: clearingRow ? flash : 0,
        });
      }
    }

    if (e.piece && (this.state === 'playing' || this.state === 'paused')) {
      const gy = e.ghostY();
      const ghost = e.piece.clone();
      ghost.y = gy;
      Glass.piece(ctx, ghost, 0, 0, s, { ghost: true, alpha: 1 });   // FR-1.5
      Glass.piece(ctx, e.piece, 0, 0, s, { bright: true, alpha: 1 });
    }

    this.fx.draw(ctx);
    this.drawDanger(ctx, w, h);
    ctx.restore();
  }

  /* 우물 — 격자와 테두리. 채우지 않아 하늘이 그대로 비친다. */
  drawWell(ctx, w, h, s) {
    ctx.save();
    ctx.strokeStyle = 'rgba(190,210,255,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < CONFIG.COLS; x++) {
      ctx.moveTo(Math.round(x * s) + 0.5, 0);
      ctx.lineTo(Math.round(x * s) + 0.5, h);
    }
    for (let y = 1; y < CONFIG.ROWS; y++) {
      ctx.moveTo(0, Math.round(y * s) + 0.5);
      ctx.lineTo(w, Math.round(y * s) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* 스택이 천장에 가까워지면 위쪽이 붉게 물든다 */
  drawDanger(ctx, w, h) {
    const top = this.engine.stackTop();
    const depth = top - CONFIG.BUFFER;
    if (depth > 5) return;
    const k = clamp(1 - depth / 5, 0, 1) * 0.5;
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 4);
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.3);
    g.addColorStop(0, `rgba(255,90,90,${k * pulse * 0.5})`);
    g.addColorStop(1, 'rgba(255,90,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.3);
  }

  drawHold() {
    const ctx = this.holdCtx;
    if (!ctx) return;
    const cw = parseFloat(this.els.hold.style.width);
    const ch = parseFloat(this.els.hold.style.height);
    ctx.clearRect(0, 0, cw, ch);
    if (!this.engine.hold) return;
    Glass.preview(ctx, this.engine.hold, 4, 4, cw - 8, ch - 8, {
      alpha: this.engine.holdUsed ? 0.35 : 1,
    });
  }

  drawNext() {
    const ctx = this.nextCtx;
    if (!ctx) return;
    const cw = parseFloat(this.els.next.style.width);
    const ch = parseFloat(this.els.next.style.height);
    ctx.clearRect(0, 0, cw, ch);
    const n = this.nextCount;
    this.engine.queue.slice(0, n).forEach((key, i) => {
      const alpha = i === 0 ? 1 : Math.max(0.4, 0.8 - i * 0.11);
      if (this.compact) {
        const slot = cw / n;
        Glass.preview(ctx, key, i * slot + 3, 3, slot - 6, ch - 6, { alpha });
      } else {
        const slot = ch / n;
        Glass.preview(ctx, key, 4, i * slot + 3, cw - 8, slot - 6, { alpha });
      }
    });
  }

  /* ------------------------------------------------------------ 오버레이 */
  showOverlay(kind) {
    // 떠 있던 문구는 걷어낸다 — 반투명 오버레이 뒤로 비쳐 글자가 겹친다
    this.els.toasts.replaceChildren();
    const o = this.els.overlay;
    o.dataset.kind = kind;
    o.classList.add('on');
    for (const el of o.querySelectorAll('[data-screen]')) {
      el.hidden = el.dataset.screen !== kind;
    }
    if (kind === 'gameover') {
      const e = this.engine;
      this.els.finalScore.textContent = e.score.toLocaleString('ko-KR');
      this.els.finalLines.textContent = e.lines;
      this.els.finalLevel.textContent = e.level;
      this.els.finalPhase.textContent = phaseAt(e.level).name;
      this.els.newBest.hidden = !this.newBest;
    }
  }

  hideOverlay() {
    this.els.overlay.classList.remove('on');
    this.els.overlay.dataset.kind = '';
  }

  /* --------------------------------------------------------------- 루프 */
  loop(now) {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0);
    this.lastFrame = now;
    this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  run() {
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }
}
