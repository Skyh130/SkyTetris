/* =========================================================================
 *  acceptance.js — PRD §9 수용 기준 AC-1 ~ AC-13 을 실제 브라우저에서 확인
 *
 *  실행:  node tests/acceptance.js            (스크린샷 없이)
 *         node tests/acceptance.js ./shots    (스크린샷을 해당 폴더에 저장)
 *
 *  Playwright 가 있어야 한다. 없으면 규칙 테스트(tests/engine.test.js)만으로도
 *  AC-2 ~ AC-7 은 확인할 수 있다.
 * ========================================================================= */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* 아래에서 전역을 찾는다 */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright'));
  } catch (_) {
    console.error('Playwright 를 찾지 못했습니다.  npm i -D playwright  후 다시 실행하세요.');
    process.exit(2);
  }
}

const { chromium } = loadPlaywright();
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (id, title, cond, detail = '') =>
  results.push({ id, title, pass: !!cond, detail });

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const external = [];

  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} ${m.text()}`); });
    page.on('request', (r) => { if (!r.url().startsWith('file://')) external.push(r.url()); });
  };

  /* ------------------------------------------------- 데스크톱 세션 */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  watch(page, '[desktop]');
  await page.goto(INDEX);
  await page.waitForTimeout(600);

  /* AC-1 — 서버 없이 file:// 로 실행된다 */
  const booted = await page.evaluate(() => !!window.glassNight && window.glassNight.state === 'ready');
  ok('AC-1', 'file:// 로 열어도 서버 없이 실행된다', booted);
  await shot(page, 'ac01-ready');

  await page.click('[data-action="start"]');
  await page.waitForTimeout(250);

  /* AC-2 — SRS 월킥 */
  const kick = await page.evaluate(() => {
    const e = window.glassNight.engine;
    e.board.forEach((r) => r.fill(null));
    e.piece = new Piece('T'); e.piece.x = 3; e.piece.y = 10;
    e.board[11][5] = 'Z';
    const okT = e.rotate(1) && e.piece.rot === 1 && e.piece.x === 2;

    e.board.forEach((r) => r.fill(null));
    e.piece = new Piece('I'); e.piece.x = 3; e.piece.y = 10;
    e.board[13][5] = 'Z';
    const okI = e.rotate(1) && e.piece.rot === 1 && e.piece.x === 1;
    e.board.forEach((r) => r.fill(null));
    return { okT, okI };
  });
  ok('AC-2', 'SRS 월킥이 동작한다 (T · I 전용 표)', kick.okT && kick.okI, JSON.stringify(kick));

  /* AC-3 — 7-bag */
  const bag = await page.evaluate(() => {
    const b = new Bag(); const d = [];
    for (let i = 0; i < 700; i++) d.push(b.next());
    let maxRun = 1, run = 1, bagsOk = true;
    for (let i = 1; i < d.length; i++) { run = d[i] === d[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
    for (let i = 0; i < d.length; i += 7) if (new Set(d.slice(i, i + 7)).size !== 7) bagsOk = false;
    return { maxRun, bagsOk };
  });
  ok('AC-3', '같은 조각이 연속 4개 이상 나오지 않는다', bag.bagsOk && bag.maxRun <= 2, `최대 ${bag.maxRun}연속`);

  /* AC-4 — 홀드는 조각당 1회 */
  const hold = await page.evaluate(() => {
    const g = window.glassNight, e = g.engine;
    e.board.forEach((r) => r.fill(null));
    e.hold = null; e.holdUsed = false; e.gameOver = false;
    e.spawn();
    const first = e.swapHold();
    const second = e.swapHold();
    return { first, second };
  });
  ok('AC-4', '홀드가 조각당 한 번만 동작한다', hold.first === true && hold.second === false);

  /* AC-5 — 고스트가 실제 착지 위치와 일치 */
  const ghost = await page.evaluate(() => {
    const e = window.glassNight.engine;
    e.board.forEach((r) => r.fill(null));
    for (let x = 0; x < 10; x++) { e.board[21][x] = x === 4 ? null : 'I'; e.board[20][x] = x < 3 ? 'I' : null; }
    e.spawn('T');
    const g = e.ghostY();
    const q = e.piece.clone(); q.y = g;
    return !e.collides(q, 0, 0) && e.collides(q, 0, 1);
  });
  ok('AC-5', '고스트가 실제 착지 위치와 일치한다', ghost);

  /* AC-6 — 4줄 삭제 점수 + AC-10 파티클 */
  const tetris = await page.evaluate(async () => {
    const g = window.glassNight, e = g.engine;
    e.reset(); g.fx.clear(); g.clearing = null; g.state = 'playing';
    e.level = 1; e.score = 0;
    for (let y = 18; y <= 21; y++) for (let x = 1; x < 10; x++) e.board[y][x] = 'J';
    e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
    g.lockNow();
    const scoreAfter = e.score;
    await new Promise((r) => setTimeout(r, 220));       // 파편이 튀는 시점
    return { scoreAfter, state: g.state, particles: g.fx.count, lines: e.lines };
  });
  ok('AC-6', '4줄 동시 삭제 = 800 × 레벨', tetris.scoreAfter === 800, `점수 ${tetris.scoreAfter}`);
  ok('AC-10', '줄 삭제 시 파편 파티클이 재생된다', tetris.particles > 0, `입자 ${tetris.particles}개`);
  await shot(page, 'ac10-shatter');

  /* AC-7 — 10줄마다 레벨업, 중력 가속 */
  const level = await page.evaluate(() => {
    const e = window.glassNight.engine;
    e.reset();
    for (let i = 0; i < 10; i++) e.applyScore(1, null);
    return { level: e.level, g1: gravityFor(1), g2: gravityFor(2), g10: gravityFor(10) };
  });
  ok('AC-7', '10줄마다 레벨이 오르고 낙하가 빨라진다',
    level.level === 2 && level.g1 > level.g2 && level.g2 > level.g10,
    `레벨 ${level.level}, ${level.g1}→${level.g2}→${level.g10}ms`);

  /* AC-8 — 레벨에 따라 하늘색이 달라진다 */
  const skyDiff = await page.evaluate(async () => {
    const g = window.glassNight;
    const sample = () => {
      const c = g.sky.canvas;
      const cx = c.getContext('2d');
      const d = cx.getImageData(Math.floor(c.width * 0.15), Math.floor(c.height * 0.8), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const setLv = async (lv) => {
      g.engine.level = lv; g.sky.setLevel(lv); g.sky.shownLevel = lv; g.sky.bake();
      g.sky.draw();
      await new Promise((r) => requestAnimationFrame(r));
      return sample();
    };
    const a = await setLv(1);
    const b = await setLv(12);
    const dist = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    return { a, b, dist };
  });
  ok('AC-8', '레벨이 오르면 하늘색이 눈에 띄게 달라진다', skyDiff.dist > 60,
    `해거름 rgb(${skyDiff.a}) → 자정 rgb(${skyDiff.b}), 차이 ${skyDiff.dist}`);
  await shot(page, 'ac08-midnight');

  /* AC-9 — 굳은 블록이 반투명하다 (뒤 하늘이 비친다) */
  const seeThrough = await page.evaluate(() => {
    const g = window.glassNight, e = g.engine;
    e.board.forEach((r) => r.fill(null));
    e.piece = null; g.clearing = null; g.dying = null; g.state = 'ready';
    e.board[12][4] = 'I';
    g.shake = 0; g.fx.clear();
    g.drawBoard();
    const c = g.els.board;
    const cx = c.getContext('2d');
    const dpr = c.width / parseFloat(c.style.width);
    const px = Math.floor((4 + 0.5) * g.cell * dpr);
    const py = Math.floor((12 - CONFIG.BUFFER + 0.5) * g.cell * dpr);
    const d = cx.getImageData(px, py, 1, 1).data;
    return { alpha: d[3], rgb: [d[0], d[1], d[2]] };
  });
  ok('AC-9', '굳은 블록이 반투명해 하늘이 비친다',
    seeThrough.alpha > 10 && seeThrough.alpha < 235, `블록 중앙 알파 ${seeThrough.alpha}/255`);

  /* AC-11 — 최고 점수와 음소거 설정이 새로고침 뒤에도 남는다 */
  await page.evaluate(() => {
    const g = window.glassNight;
    g.engine.score = 12345;
    g.gameOver();
    if (!Sfx.muted) { Sfx.resume(); Sfx.toggleMute(); }
  });
  await page.waitForTimeout(120);
  await shot(page, 'ac11-gameover');
  await page.reload();
  await page.waitForTimeout(500);
  const persisted = await page.evaluate(() => ({
    best: window.glassNight.best,
    bestText: document.getElementById('best').textContent,
    muted: Sfx.muted,
    muteBtn: document.querySelector('[data-action="mute"] .label').textContent,
  }));
  ok('AC-11', '최고 점수와 음소거 설정이 새로고침 뒤에도 남는다',
    persisted.best === 12345 && persisted.muted === true,
    `최고 ${persisted.bestText} · ${persisted.muteBtn}`);

  /* ------------------------------------------------- 모바일 세션 */
  const mctx = await browser.newContext({
    viewport: { width: 380, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const m = await mctx.newPage();
  watch(m, '[mobile]');
  await m.goto(INDEX);
  await m.waitForTimeout(600);
  await m.tap('[data-action="start"]');
  await m.waitForTimeout(200);
  await m.tap('[data-action="left"]');
  await m.tap('[data-action="cw"]');
  await m.tap('[data-action="hard"]');
  await m.waitForTimeout(300);
  await shot(m, 'ac12-mobile');

  const mob = await m.evaluate(() => {
    const rect = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const tray = rect('.side.left'), right = rect('.side.right');
    const field = rect('.field'), pad = rect('.touchpad'), bar = rect('.title-bar');
    return {
      compact: window.glassNight.compact,
      pieces: window.glassNight.engine.stats.pieces,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      vOverflow: field.bottom > pad.top + 1 || tray.top < bar.bottom - 1,
      trayOverlap: tray.right > right.left + 1,
      inViewport: field.right <= window.innerWidth + 1 && right.right <= window.innerWidth + 1,
      padVisible: getComputedStyle(document.querySelector('.touchpad')).display === 'grid',
    };
  });
  ok('AC-12', '모바일에서 레이아웃이 깨지지 않고 터치로 조작된다',
    mob.compact && !mob.hOverflow && !mob.vOverflow && !mob.trayOverlap
    && mob.inViewport && mob.padVisible && mob.pieces > 1,
    JSON.stringify(mob));

  /* AC-13 — 콘솔 에러 0, 외부 요청 0 */
  ok('AC-13', '콘솔 에러 0건 · 외부 네트워크 요청 0건',
    errors.length === 0 && external.length === 0,
    `에러 ${errors.length}건${errors.length ? ': ' + errors.join(' | ') : ''}, 외부요청 ${external.length}건`);

  await browser.close();

  /* --------------------------------------------------------- 보고 */
  console.log('\n\x1b[36m유리알의 밤 — 수용 기준 점검 (PRD §9)\x1b[0m\n');
  let fail = 0;
  for (const r of results.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) {
    if (!r.pass) fail++;
    const mark = r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(` ${mark} ${r.id}  ${r.title}`);
    if (r.detail) console.log(`      \x1b[90m${r.detail}\x1b[0m`);
  }
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${results.length - fail} / ${results.length} 통과\x1b[0m`);
  if (SHOTS) console.log(`\x1b[90m스크린샷: ${SHOTS}\x1b[0m`);
  console.log();
  process.exit(fail === 0 ? 0 : 1);
})();
