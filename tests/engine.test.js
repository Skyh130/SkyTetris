/* =========================================================================
 *  engine.test.js — 코어 규칙 검증 (PRD §9 AC-2 ~ AC-7)
 *  실행:  node tests/engine.test.js
 *  engine.js 는 DOM에 의존하지 않으므로 그대로 Node에서 돌릴 수 있다.
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math });
for (const f of ['js/config.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
// 브라우저의 클래식 스크립트와 같은 방식으로 전역 렉시컬 스코프를 공유한다.
// vm 컨텍스트에서는 그 값들이 global 객체의 속성이 아니므로 한 번 옮겨 준다.
vm.runInContext(
  'Object.assign(globalThis, { Engine, Piece, Bag, CONFIG, PIECE_KEYS, PIECES, gravityFor });',
  ctx);
const { Engine, Piece, Bag, CONFIG, PIECE_KEYS } = ctx;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name} ${extra}`); }
}
function group(t) { console.log(`\n\x1b[36m${t}\x1b[0m`); }

/* 보드 채우기 도우미 */
const fillRow = (e, y, except = []) => {
  for (let x = 0; x < CONFIG.COLS; x++) if (!except.includes(x)) e.board[y][x] = 'I';
};

/* ---------------------------------------------------- AC-3: 7-bag */
group('AC-3 · 7-bag 랜덤');
{
  const bag = new Bag();
  const draws = [];
  for (let i = 0; i < 7 * 200; i++) draws.push(bag.next());

  let bagsOk = true;
  for (let i = 0; i < draws.length; i += 7) {
    if (new Set(draws.slice(i, i + 7)).size !== 7) bagsOk = false;
  }
  check('주머니 하나마다 일곱 조각이 정확히 한 번씩', bagsOk);

  let maxRun = 1, run = 1;
  for (let i = 1; i < draws.length; i++) {
    run = draws[i] === draws[i - 1] ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
  }
  check('같은 조각이 3연속 이상 나오지 않는다', maxRun <= 2, `(최대 ${maxRun}연속)`);

  const counts = {};
  for (const d of draws) counts[d] = (counts[d] || 0) + 1;
  check('일곱 조각의 등장 횟수가 모두 같다',
    PIECE_KEYS.every((k) => counts[k] === 200));
}

/* ------------------------------------------------ AC-2: SRS 월킥 */
group('AC-2 · SRS 회전과 월킥');
{
  const e = new Engine();
  e.piece = new Piece('T'); e.piece.x = 3; e.piece.y = 10;
  e.board[11][5] = 'Z';                       // 제자리 회전을 막는 방해물
  const ok = e.rotate(1);
  check('T: 제자리 회전이 막히면 킥으로 밀려나며 회전한다',
    ok && e.piece.rot === 1 && e.piece.x === 2, `(rot=${e.piece.rot}, x=${e.piece.x})`);
}
{
  const e = new Engine();
  e.piece = new Piece('I'); e.piece.x = 3; e.piece.y = 10;
  e.board[13][5] = 'Z';
  const ok = e.rotate(1);
  check('I: 전용 킥 테이블이 적용된다 (-2칸 이동)',
    ok && e.piece.rot === 1 && e.piece.x === 1, `(rot=${e.piece.rot}, x=${e.piece.x})`);
}
{
  const e = new Engine();
  e.piece = new Piece('T'); e.piece.x = 0; e.piece.y = 10;
  e.rotate(-1);
  check('회전 후 조각이 항상 필드 안에 있다',
    e.piece.blocks().every(([x]) => x >= 0 && x < CONFIG.COLS));
}
{
  const e = new Engine();
  e.piece = new Piece('O'); const before = { ...e.piece };
  e.rotate(1);
  check('달빛알(O)은 회전해도 형태가 바뀌지 않는다',
    e.piece.rot === before.rot && e.piece.x === before.x);
}
{
  const e = new Engine();
  for (const k of PIECE_KEYS) {
    e.piece = new Piece(k);
    for (let i = 0; i < 4; i++) e.rotate(1);
    if (e.piece.rot !== 0) { check(`${k}: 네 번 회전하면 원래 상태`, false); break; }
  }
  check('모든 조각이 네 번 회전하면 원래 상태로 돌아온다', true);
}

/* -------------------------------------------------- AC-5: 고스트 */
group('AC-5 · 고스트 위치');
{
  const e = new Engine();
  e.spawn('T');
  const gy = e.ghostY();
  const p = e.piece.clone(); p.y = gy;
  const restsOnFloor = !e.collides(p, 0, 0) && e.collides(p, 0, 1);
  check('고스트는 더 내려갈 수 없는 정확한 착지 위치다', restsOnFloor);

  const e2 = new Engine();
  fillRow(e2, 21); fillRow(e2, 20, [4]);
  e2.spawn('T');
  const g2 = e2.ghostY();
  const q = e2.piece.clone(); q.y = g2;
  check('울퉁불퉁한 바닥에서도 착지 위치가 정확하다',
    !e2.collides(q, 0, 0) && e2.collides(q, 0, 1));
}

/* ---------------------------------------------------- AC-4: 홀드 */
group('AC-4 · 홀드');
{
  const e = new Engine();
  e.spawn();
  const first = e.piece.key;
  check('첫 홀드 성공', e.swapHold() === true && e.hold === first);
  check('같은 조각에서 두 번째 홀드는 거부된다', e.swapHold() === false);
  const held = e.hold;
  e.piece.y = 18;                 // 스폰 영역이 아니라 바닥 근처에서 굳힌다
  e.lockPiece(); e.spawn();
  check('새 조각이 나오면 홀드가 다시 열린다', e.holdUsed === false);
  e.swapHold();
  check('두 번째 홀드는 보관 중이던 조각과 맞바꾼다',
    e.piece.key === held, `(기대 ${held}, 실제 ${e.piece.key})`);
}

/* -------------------------------------- AC-6 / FR-2: 줄 삭제와 점수 */
group('AC-6 · 줄 삭제와 점수');
{
  const e = new Engine();
  fillRow(e, 21, [0]);
  e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
  // 세로 I 를 0번 열에 떨어뜨려 21행을 완성시킨다
  e.piece.x = -2;
  const blocks = e.piece.blocks();
  check('세로 I 가 0번 열을 차지한다', blocks.every(([x]) => x === 0), JSON.stringify(blocks));
  const r = e.lockPiece();
  check('가득 찬 줄이 감지된다', r.rows.length === 1 && r.rows[0] === 21);
  check('싱글 = 100 × 레벨1', r.gained === 100, `(실제 ${r.gained})`);
  e.removeRows(r.rows);
  check('지운 줄만큼 위 스택이 한 칸 내려앉는다',
    e.board[21][0] === 'I' && e.board[21].slice(1).every((c) => c === null));
  check('맨 윗줄은 빈 줄로 채워진다', e.board[0].every((c) => c === null));
}
{
  const e = new Engine();
  for (let y = 18; y <= 21; y++) fillRow(e, y, [0]);
  e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
  const r = e.lockPiece();
  check('4줄이 한 번에 감지된다', r.cleared === 4);
  check('테트리스 = 800 × 레벨1', r.gained === 800, `(실제 ${r.gained})`);
  check('테트리스는 B2B 를 세운다', e.backToBack === true);
  check('연출 문구가 "테트리스"', r.label === '테트리스');
}
{
  const e = new Engine();
  e.backToBack = true;
  const r = e.applyScore(4, null);
  check('B2B 테트리스 = 800 × 1.5 = 1200', r.gained === 1200, `(실제 ${r.gained})`);
  check('B2B 플래그가 결과에 실린다', r.b2b === true);
}
{
  const e = new Engine();
  e.applyScore(1, null);              // 콤보 0
  const r = e.applyScore(1, null);    // 콤보 1 → +50
  check('콤보 보너스 = 50 × 콤보수', r.gained === 150, `(실제 ${r.gained})`);
  e.applyScore(0, null);
  check('줄을 못 지우면 콤보가 끊긴다', e.combo === -1);
}
{
  const e = new Engine();
  const r = e.applyScore(2, 'tspin');
  check('T-스핀 더블 = 1200', r.gained === 1200, `(실제 ${r.gained})`);
}

/* ------------------------------------------ T-스핀 판정 (FR-2.2) */
group('FR-2.2 · T-스핀 판정');
{
  const e = new Engine();
  e.piece = new Piece('T'); e.piece.x = 3; e.piece.y = 10; e.piece.rot = 0;
  e.lastAction = 'rotate'; e.lastKick = 0;
  const cx = 4, cy = 11;
  e.board[cy - 1][cx - 1] = 'I';   // 좌상 (앞면)
  e.board[cy - 1][cx + 1] = 'I';   // 우상 (앞면)
  e.board[cy + 1][cx - 1] = 'I';   // 좌하
  check('앞 두 모서리가 막히면 정식 T-스핀', e.detectTSpin() === 'tspin');

  const e2 = new Engine();
  e2.piece = new Piece('T'); e2.piece.x = 3; e2.piece.y = 10; e2.piece.rot = 0;
  e2.lastAction = 'rotate'; e2.lastKick = 0;
  e2.board[10][3] = 'I';           // 좌상만
  e2.board[12][3] = 'I'; e2.board[12][5] = 'I';
  check('뒤쪽만 막히면 미니 T-스핀', e2.detectTSpin() === 'mini');

  const e3 = new Engine();
  e3.piece = new Piece('T'); e3.piece.x = 3; e3.piece.y = 10;
  e3.lastAction = 'move';
  e3.board[10][3] = 'I'; e3.board[10][5] = 'I'; e3.board[12][3] = 'I';
  check('회전이 아니라 이동으로 끼워 넣으면 T-스핀이 아니다', e3.detectTSpin() === null);
}

/* ------------------------------------------------ AC-7: 레벨 진행 */
group('AC-7 · 레벨 진행과 중력');
{
  const e = new Engine();
  check('시작 레벨은 1', e.level === 1);
  let levelUpAt = null;
  for (let i = 0; i < 10; i++) {
    const rr = e.applyScore(1, null);
    if (rr.levelUp) levelUpAt = i + 1;
  }
  check('10줄을 지우면 레벨 2', e.level === 2, `(실제 ${e.level})`);
  check('레벨업 플래그는 10번째 줄에서 정확히 한 번 뜬다', levelUpAt === 10, `(실제 ${levelUpAt})`);
  check('레벨이 오르면 낙하 간격이 줄어든다',
    ctx.gravityFor(1) > ctx.gravityFor(5) && ctx.gravityFor(5) > ctx.gravityFor(10));
  check('레벨 표를 넘어가도 값이 유효하다', ctx.gravityFor(999) > 0);
}

/* -------------------------------------------------- 게임 오버 조건 */
group('FR-1.9 · 게임 오버');
{
  const e = new Engine();
  for (let y = 0; y < CONFIG.TOTAL_ROWS; y++) fillRow(e, y);
  check('스폰 자리가 막히면 게임 오버', e.spawn('T') === false && e.gameOver === true);
}

/* --------------------------------------------------------- 결과 */
console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} 통과 / ${fail} 실패\x1b[0m\n`);
process.exit(fail === 0 ? 0 : 1);
