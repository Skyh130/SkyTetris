/* =========================================================================
 *  engine.js — 순수 게임 로직
 *  DOM도 Canvas도 모른다. 규칙만 안다. (PRD §8.3)
 * ========================================================================= */

/* 조각별 4회전 상태를 미리 계산해 둔다. rot 0 = 스폰 형태. */
const PIECE_ROT = (() => {
  const table = {};
  for (const key of PIECE_KEYS) {
    const { size, cells } = PIECES[key];
    const states = [cells.map(([x, y]) => [x, y])];
    for (let r = 1; r < 4; r++) {
      // 시계 방향 회전: (x, y) -> (size-1-y, x)
      states.push(states[r - 1].map(([x, y]) => [size - 1 - y, x]));
    }
    table[key] = states;
  }
  return table;
})();

/* 7-bag: 일곱 조각이 한 번씩 나온 뒤에야 다음 주머니가 열린다. (FR-1.2) */
class Bag {
  constructor() { this.pool = []; }
  next() {
    if (this.pool.length === 0) {
      this.pool = PIECE_KEYS.slice();
      for (let i = this.pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
      }
    }
    return this.pool.pop();
  }
}

function spawnX(key) {
  const size = PIECES[key].size;
  return size === 2 ? 4 : 3;
}

class Piece {
  constructor(key) {
    this.key = key;
    this.rot = 0;
    this.x = spawnX(key);
    this.y = CONFIG.BUFFER - 1;   // 위 버퍼에서 반쯤 걸친 채로 등장
  }
  get cells() { return PIECE_ROT[this.key][this.rot]; }
  /* 보드 좌표계로 옮긴 실제 칸 목록 */
  blocks(ox = 0, oy = 0, rot = this.rot) {
    return PIECE_ROT[this.key][rot].map(([cx, cy]) => [this.x + ox + cx, this.y + oy + cy]);
  }
  clone() {
    const p = new Piece(this.key);
    p.rot = this.rot; p.x = this.x; p.y = this.y;
    return p;
  }
}

class Engine {
  constructor() { this.reset(); }

  reset() {
    this.board = Array.from({ length: CONFIG.TOTAL_ROWS },
      () => new Array(CONFIG.COLS).fill(null));
    this.bag = new Bag();
    this.queue = [];
    while (this.queue.length < CONFIG.NEXT_COUNT) this.queue.push(this.bag.next());
    this.hold = null;
    this.holdUsed = false;
    this.piece = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.backToBack = false;
    this.gameOver = false;
    this.lastAction = null;   // 'move' | 'rotate' — T-스핀 판정에 쓴다
    this.lastKick = 0;
    this.stats = { pieces: 0, tspins: 0, tetris: 0, maxCombo: 0 };
  }

  /* --------------------------------------------------------------- 충돌 */
  inside(x, y) { return x >= 0 && x < CONFIG.COLS && y < CONFIG.TOTAL_ROWS; }

  occupied(x, y) {
    if (x < 0 || x >= CONFIG.COLS || y >= CONFIG.TOTAL_ROWS) return true;
    if (y < 0) return false;                       // 위쪽은 열려 있다
    return this.board[y][x] !== null;
  }

  collides(piece, ox = 0, oy = 0, rot = piece.rot) {
    return piece.blocks(ox, oy, rot).some(([x, y]) => this.occupied(x, y));
  }

  /* --------------------------------------------------------------- 스폰 */
  spawn(key = null) {
    if (key === null) {
      key = this.queue.shift();
      this.queue.push(this.bag.next());
    }
    this.piece = new Piece(key);
    this.holdUsed = false;
    this.lastAction = null;
    this.stats.pieces++;
    if (this.collides(this.piece)) {      // block-out (FR-1.9)
      this.gameOver = true;
      return false;
    }
    return true;
  }

  /* --------------------------------------------------------------- 이동 */
  move(dx, dy) {
    if (!this.piece || this.gameOver) return false;
    if (this.collides(this.piece, dx, dy)) return false;
    this.piece.x += dx;
    this.piece.y += dy;
    this.lastAction = 'move';
    return true;
  }

  /* dir: +1 시계, -1 반시계. SRS 월킥 (FR-1.3) */
  rotate(dir) {
    if (!this.piece || this.gameOver) return false;
    const p = this.piece;
    if (p.key === 'O') return false;                 // 달빛알은 돌지 않는다
    const from = p.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    const table = p.key === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}${to}`] || [[0, 0]];

    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const ox = kx, oy = -ky;                       // 표는 y축이 위로 향한다
      if (!this.collides(p, ox, oy, to)) {
        p.x += ox; p.y += oy; p.rot = to;
        this.lastAction = 'rotate';
        this.lastKick = i;
        return true;
      }
    }
    return false;
  }

  /* --------------------------------------------------------------- 홀드 */
  swapHold() {
    if (!this.piece || this.holdUsed || this.gameOver) return false;
    const current = this.piece.key;
    if (this.hold === null) {
      this.hold = current;
      this.spawn();
    } else {
      const swapped = this.hold;
      this.hold = current;
      this.spawn(swapped);
    }
    this.holdUsed = true;                            // 조각당 1회 (FR-1.4)
    return true;
  }

  /* ------------------------------------------------------------- 고스트 */
  ghostY() {
    if (!this.piece) return 0;
    let d = 0;
    while (!this.collides(this.piece, 0, d + 1)) d++;
    return this.piece.y + d;
  }

  dropDistance() { return this.ghostY() - this.piece.y; }

  /* --------------------------------------------------------- T-스핀 판정 */
  detectTSpin() {
    const p = this.piece;
    if (!p || p.key !== 'T' || this.lastAction !== 'rotate') return null;
    const cx = p.x + 1, cy = p.y + 1;                // 3×3 중심
    const corner = [
      [cx - 1, cy - 1], [cx + 1, cy - 1],            // 0: 좌상, 1: 우상
      [cx - 1, cy + 1], [cx + 1, cy + 1],            // 2: 좌하, 3: 우하
    ].map(([x, y]) => this.occupied(x, y));
    const filled = corner.filter(Boolean).length;
    if (filled < 3) return null;
    // 회전 상태별 '앞면' 두 모서리
    const FRONT = { 0: [0, 1], 1: [1, 3], 2: [2, 3], 3: [0, 2] }[p.rot];
    const frontBoth = corner[FRONT[0]] && corner[FRONT[1]];
    return (frontBoth || this.lastKick === 4) ? 'tspin' : 'mini';
  }

  /* ----------------------------------------------------------------- 락 */
  /* 조각을 보드에 굳히고, 지워질 줄을 찾아 결과를 돌려준다.
     실제로 줄을 없애는 것은 연출이 끝난 뒤 removeRows()가 한다. */
  lockPiece() {
    const p = this.piece;
    const tspin = this.detectTSpin();
    const cells = p.blocks();
    for (const [x, y] of cells) {
      if (y >= 0 && y < CONFIG.TOTAL_ROWS) this.board[y][x] = p.key;
    }

    const full = [];
    for (let y = 0; y < CONFIG.TOTAL_ROWS; y++) {
      if (this.board[y].every((c) => c !== null)) full.push(y);
    }

    const result = {
      key: p.key,
      cells,
      rows: full,
      tspin,
      lockOut: cells.every(([, y]) => y < CONFIG.BUFFER),   // 전부 버퍼 안에서 굳음
      ...this.applyScore(full.length, tspin),
    };
    this.piece = null;
    if (result.lockOut) this.gameOver = true;
    return result;
  }

  /* 점수 · 콤보 · B2B · 레벨 (FR-2) */
  applyScore(cleared, tspin) {
    const lv = this.level;
    let base = 0;
    let label = null;
    let difficult = false;

    if (tspin === 'mini') {
      base = cleared === 0 ? 100 : 200 * cleared;
      label = cleared > 0 ? 'T-스핀 미니' : 'T-스핀 미니';
      difficult = cleared > 0;
    } else if (tspin === 'tspin') {
      base = [400, 800, 1200, 1600][cleared];
      label = cleared > 0 ? `T-스핀 ${cleared}줄` : 'T-스핀';
      difficult = cleared > 0;
    } else if (cleared > 0) {
      base = [0, 100, 300, 500, 800][cleared];
      label = ['', '싱글', '더블', '트리플', '테트리스'][cleared];
      difficult = cleared === 4;
    }

    let b2b = false;
    if (cleared > 0) {
      this.combo++;
      if (difficult && this.backToBack) { base = Math.floor(base * 1.5); b2b = true; }
      this.backToBack = difficult;
      base += 50 * this.combo * 1;                    // 콤보 (FR-2.4)
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      if (cleared === 4) this.stats.tetris++;
    } else {
      this.combo = -1;
      // 줄을 지우지 못한 스핀은 B2B 를 끊지도, 세우지도 않는다 (그대로 둔다)
    }
    if (tspin) this.stats.tspins++;

    const gained = base * lv;
    this.score += gained;

    const prevLevel = this.level;
    this.lines += cleared;
    this.level = Math.floor(this.lines / CONFIG.LINES_PER_LEVEL) + 1;

    return {
      cleared, gained, label, b2b,
      combo: this.combo,
      levelUp: this.level > prevLevel,
    };
  }

  /* 연출이 끝난 뒤 실제로 줄을 걷어낸다. */
  removeRows(rows) {
    if (!rows.length) return;
    const keep = [];
    for (let y = 0; y < CONFIG.TOTAL_ROWS; y++) {
      if (!rows.includes(y)) keep.push(this.board[y]);
    }
    while (keep.length < CONFIG.TOTAL_ROWS) {
      keep.unshift(new Array(CONFIG.COLS).fill(null));
    }
    this.board = keep;
  }

  addDropScore(cells, hard) {
    const pts = cells * (hard ? 2 : 1);
    this.score += pts;
    return pts;
  }

  /* 보드에서 가장 높이 쌓인 칸의 y (연출용) */
  stackTop() {
    for (let y = 0; y < CONFIG.TOTAL_ROWS; y++) {
      if (this.board[y].some((c) => c !== null)) return y;
    }
    return CONFIG.TOTAL_ROWS;
  }
}
