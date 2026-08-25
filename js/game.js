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
    this.dying = null;        // 게임이 끝날 때 아래에서부터 부서지는 연출
    this.pending = [];        // 연출 중에 눌린 조작을 잠시 모아 두는 곳
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

    // CSS 의 @media (max-width: 860px) 와 같은 기준을 써야 경계에서 어긋나지 않는다
    const compact = window.matchMedia
      ? window.matchMedia('(max-width: 860px)').matches
      : window.innerWidth <= 860;
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
    const next = clamp(cell, 12, 40);
    if (next !== this.cell) Glass.invalidate();      // 크기가 바뀌면 다시 굽는다
    this.cell = next;

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
    this.dying = null;
    this.pending.length = 0;
    this.dropTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.softDropping = false;
    this.shake = 0;
    this._deathSounded = false;
    this.sky.setLevel(1);
    this.sky.shownLevel = 1;
    this.engine.spawn();
    this.state = 'playing';
    this.hideOverlay();
    this.syncHud();
    this.say('시작. 해거름, 아직 서쪽이 붉다');
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
    this._deathSounded = false;
    this.start();
  }

  /* 끝나는 순간을 한 프레임에 지우지 않는다.
     쌓인 유리알이 아래에서부터 차례로 부서지고 나서 결과를 보여 준다. */
  startDeath() {
    if (this.state === 'dying' || this.state === 'gameover') return;
    this.state = 'dying';
    this.dying = { t: 0, row: CONFIG.TOTAL_ROWS - 1 };
    this.engine.piece = null;
    this.clearing = null;
    this.pending.length = 0;
    this.els.toasts.replaceChildren();
    Sfx.gameOver();
    this._deathSounded = true;
  }

  updateDying(dt) {
    const d = this.dying;
    if (!d) return this.gameOver();
    d.t += dt * 1000;
    const step = 42;                       // 한 줄이 부서지는 간격
    while (d.row >= CONFIG.BUFFER && d.t >= (CONFIG.TOTAL_ROWS - 1 - d.row) * step) {
      const y = d.row;
      for (let x = 0; x < CONFIG.COLS; x++) {
        const key = this.engine.board[y][x];
        if (!key) continue;
        this.fx.shatter((x + 0.5) * this.cell,
          (y - CONFIG.BUFFER + 0.5) * this.cell, this.cell, key, 0.7);
        this.engine.board[y][x] = null;
      }
      d.row--;
    }
    if (d.row < CONFIG.BUFFER && d.t > (CONFIG.TOTAL_ROWS - CONFIG.BUFFER) * step + 260) {
      this.dying = null;
      this.gameOver();
    }
  }

  gameOver() {
    this.state = 'gameover';
    this.dying = null;
    if (!this._deathSounded) Sfx.gameOver();
    if (this.engine.score > this.best) {
      this.best = this.engine.score;
      localStorage.setItem(STORAGE_KEY, String(this.best));
      this.newBest = true;
    } else this.newBest = false;
    this.syncHud();
    this.say(`게임 종료. 점수 ${this.engine.score.toLocaleString('ko-KR')}점, `
      + `${this.engine.lines}줄, 레벨 ${this.engine.level}`);
    this.showOverlay('gameover');
  }

  /* --------------------------------------------------------- 플레이어 조작 */
  get canControl() { return this.state === 'playing' && this.engine.piece; }

  /* 줄이 부서지는 380ms 동안 누른 키를 버리면 손이 걸린다.
     짧은 동안만 모아 두었다가 다음 조각이 나올 때 그대로 적용한다. */
  remember(action) {
    this.pending.push({ action, at: performance.now() });
    if (this.pending.length > 4) this.pending.shift();
  }

  applyPending() {
    if (!this.pending.length) return;
    const now = performance.now();
    const keepFor = CONFIG.CLEAR_ANIM + 220;  // 연출이 끝날 때까지는 살아 있어야 한다
    const queued = this.pending.filter((p) => now - p.at < keepFor);
    this.pending.length = 0;
    for (const { action } of queued) {
      if (action === 'left') this.moveH(-1);
      else if (action === 'right') this.moveH(1);
      else if (action === 'cw') this.rotate(1);
      else if (action === 'ccw') this.rotate(-1);
      else if (action === 'hold') this.hold();
    }
  }

  moveH(dir) {
    if (this.state === 'clearing') return this.remember(dir < 0 ? 'left' : 'right');
    if (!this.canControl) return;
    if (this.engine.move(dir, 0)) {
      Sfx.move();
      this.touchLock();
    }
  }

  rotate(dir) {
    if (this.state === 'clearing') return this.remember(dir > 0 ? 'cw' : 'ccw');
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
        // 조각이 실제로 지나온 구간(출발점 → 착지점)에 잔상을 남긴다
        const from = (y - CONFIG.BUFFER) * this.cell;
        this.fx.streak(x * this.cell, from, this.cell, dist * this.cell, p.key);
      }
      this.engine.move(0, dist);
      this.engine.addDropScore(dist, true);
    }
    Sfx.hardDrop();
    this.shake = Math.min(9, 3 + dist * 0.35);
    this.lockNow();
  }

  hold() {
    if (this.state === 'clearing') return this.remember('hold');
    if (!this.canControl) return;
    if (this.engine.swapHold()) {
      Sfx.hold();
      this.lockTimer = 0;
      this.lockResets = 0;
      if (this.engine.gameOver) this.startDeath();
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
    if (this.input) this.input.update();        // DAS/ARR 자동 반복
    this.sky.update(dt);
    this.fx.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 34);

    if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'clearing') this.updateClearing(dt);
    else if (this.state === 'dying') this.updateDying(dt);
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
      if (this.engine.gameOver) return this.startDeath();
      if (!this.engine.spawn()) return this.startDeath();
    }
    this.syncHud();
  }

  updateClearing(dt) {
    const c = this.clearing;
    // 상태와 데이터가 어긋난 채로 들어오면 조용히 제자리로 돌린다
    if (!c) { this.state = this.engine.piece ? 'playing' : 'ready'; return; }
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

      // 바닥을 통째로 비웠다 — 이 게임에서 가장 드물고 아름다운 순간
      if (this.engine.isBoardEmpty()) {
        const bonus = this.engine.awardPerfectClear(c.rows.length);
        Sfx.perfectClear();
        this.banner('하늘이 전부 열렸다', `퍼펙트 클리어 · +${bonus.toLocaleString('ko-KR')}`);
        this.say(`퍼펙트 클리어. 보너스 ${bonus.toLocaleString('ko-KR')}점`);
        for (let i = 0; i < 26; i++) {
          this.fx.spark(rand(0, CONFIG.COLS) * this.cell,
            rand(CONFIG.ROWS * 0.35, CONFIG.ROWS) * this.cell,
            this.cell * 1.6, PIECE_KEYS[randInt(0, 6)]);
        }
        this.shake = Math.max(this.shake, 5);
      }
      if (this.engine.gameOver) return this.startDeath();
      if (!this.engine.spawn()) return this.startDeath();
      this.state = 'playing';
      this.applyPending();
      this.syncHud();
    }
  }

  onLevelUp() {
    Sfx.levelUp();
    this.sky.setLevel(this.engine.level);
    const p = phaseAt(this.engine.level);
    this.banner(p.name, p.subtitle);            // FR-5.7
    this.say(`레벨 ${this.engine.level}. 밤이 깊어졌다 — ${p.name}, ${p.subtitle}`);
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
    const text = lines.join(' · ');
    this.toast(text, result.cleared >= 4 || result.tspin ? 'big' : '');
    this.say(`${text}. 점수 ${this.engine.score.toLocaleString('ko-KR')}점`);
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

    // 밤이 얼마나 깊었는지 — 마지막 시각(서리 새벽)까지를 100%로 본다
    const last = NIGHT_PHASES[NIGHT_PHASES.length - 1].at;
    const depth = clamp((e.level - 1) / (last - 1), 0, 1);
    this.els.nightFill.style.width = (depth * 100).toFixed(1) + '%';
    this.els.night.setAttribute('aria-label',
      `밤의 깊이 ${Math.round(depth * 100)}퍼센트 — ${p.name}`);
    this.els.holdEmpty.hidden = !!this.engine.hold;

    // 화면을 못 보는 사람에게도 판이 어떻게 돌아가는지 전한다
    const held = this.engine.hold ? PIECES[this.engine.hold].name : '없음';
    this.els.holdText.textContent = `보관 중: ${held}`;
    this.els.nextText.textContent = '다음 순서: '
      + this.engine.queue.slice(0, this.nextCount || CONFIG.NEXT_COUNT)
        .map((k) => PIECES[k].name).join(', ');
  }

  /* 지금 무슨 일이 일어났는지 한 줄로 알린다 (role="status") */
  say(text) {
    if (!text || !this.els.live) return;
    this.els.live.textContent = text;
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
          variant: (x * 3 + y * 5) % 3,     // 칸마다 빛이 닿는 자리를 달리한다
        });
      }
    }

    if (clearRows && !this.clearing.shattered) this.drawSweep(ctx, clearRows, s, w);

    if (e.piece && (this.state === 'playing' || this.state === 'paused')) {
      const gy = e.ghostY();
      const ghost = e.piece.clone();
      ghost.y = gy;
      Glass.piece(ctx, ghost, 0, 0, s, { ghost: true, alpha: 1 });   // FR-1.5
      Glass.piece(ctx, e.piece, 0, 0, s, { bright: true, alpha: 1 });

      // 곧 굳는다는 신호 — 바닥에 닿아 있는 동안 알이 서서히 달아오른다
      const settle = e.collides(e.piece, 0, 1)
        ? clamp(this.lockTimer / CONFIG.LOCK_DELAY, 0, 1) : 0;
      if (settle > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = settle * settle * 0.34;
        Glass.piece(ctx, e.piece, 0, 0, s, { bright: true, alpha: 1 });
        ctx.restore();
      }
    }

    this.fx.draw(ctx);
    this.drawDanger(ctx, w, h);
    ctx.restore();
  }

  /* 부서지기 직전, 지워질 줄 위로 빛 한 줄기가 훑고 지나간다. */
  drawSweep(ctx, rows, s, w) {
    const k = clamp(this.clearing.t / (CONFIG.CLEAR_ANIM * 0.42), 0, 1);
    const head = k * (w + s * 3) - s * 1.5;   // 등속이라야 눈에 남는다
    const tail = s * 3.2;                     // 뒤로 끌리는 꼬리
    const fade = 1 - k * 0.25;
    const g = ctx.createLinearGradient(head - tail, 0, head + s * 0.5, 0);
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, `rgba(190,225,255,${0.22 * fade})`);
    g.addColorStop(0.88, `rgba(255,255,255,${0.62 * fade})`);
    g.addColorStop(0.97, `rgba(255,255,255,${0.95 * fade})`);
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    for (const y of rows) {
      ctx.fillRect(head - tail, (y - CONFIG.BUFFER) * s, tail + s * 0.5, s);
    }
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
    if (kind === 'paused' && this.els.pauseLore) {
      this.els.pauseLore.textContent = PAUSE_LINES[randInt(0, PAUSE_LINES.length - 1)];
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
