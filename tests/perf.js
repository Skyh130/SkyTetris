/* =========================================================================
 *  perf.js — 감으로 매기지 않기 위한 측정 하네스 (docs/QUALITY.md 의 M 항목)
 *
 *  실행:  node tests/perf.js
 *  측정:  프레임 성능 · 입력 반응성 · DAS/ARR 실측 · 난이도 곡선 ·
 *         폭 320~1920 레이아웃 · 장시간 자동 플레이 안정성 · 글자 겹침
 * ========================================================================= */
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* 전역에서 찾는다 */ }
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(root, 'playwright'));
}
const { chromium } = loadPlaywright();
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const out = {};
const log = (k, v) => { out[k] = v; };

(async () => {
  const browser = await chromium.launch({ args: ['--enable-gpu-rasterization'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(INDEX);
  await page.waitForTimeout(500);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);

  /* --------------------------------------------- 1. 프레임 성능 (부하 상태) */
  const frames = await page.evaluate(async () => {
    const g = window.glassNight;
    // 파편이 가장 많이 튀는 순간을 만든다: 4줄 삭제를 연달아
    const stress = () => {
      const e = g.engine;
      for (let y = 18; y <= 21; y++) for (let x = 1; x < 10; x++) e.board[y][x] = 'J';
      e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
      g.lockNow();
    };
    const times = [];
    let last = performance.now();
    let peak = 0;
    stress();
    await new Promise((done) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        peak = Math.max(peak, g.fx.count);
        if (++n === 40) stress();          // 중간에 한 번 더 터뜨린다
        if (n < 120) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const t = times.slice(3);              // 첫 프레임 튀는 값 제외
    t.sort((a, b) => a - b);
    const avg = t.reduce((a, b) => a + b, 0) / t.length;
    return {
      avgMs: +avg.toFixed(2),
      fps: +(1000 / avg).toFixed(1),
      p95Ms: +t[Math.floor(t.length * 0.95)].toFixed(2),
      worstMs: +t[t.length - 1].toFixed(2),
      peakParticles: peak,
    };
  });
  log('frame', frames);

  /* --------------------------------------------- 2. 입력 반응성 (같은 프레임) */
  const latency = await page.evaluate(async () => {
    const g = window.glassNight;
    g.engine.reset(); g.state = 'playing'; g.engine.spawn('T'); g.clearing = null;
    const before = g.engine.piece.x;
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    const applied = g.engine.piece.x !== before;
    const dt = performance.now() - t0;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    return { appliedImmediately: applied, ms: +dt.toFixed(3) };
  });
  log('inputLatency', latency);

  /* --------------------------------------------- 3. DAS / ARR 실측 */
  const das = await page.evaluate(async () => {
    const g = window.glassNight;
    g.engine.reset(); g.state = 'playing'; g.engine.spawn('T'); g.clearing = null;
    g.engine.piece.x = 4;
    const stamps = [];
    const origin = g.moveH.bind(g);
    g.moveH = (d) => { stamps.push(performance.now()); return origin(d); };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    await new Promise((r) => setTimeout(r, 420));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    g.moveH = origin;
    if (stamps.length < 3) return { samples: stamps.length };
    const firstRepeat = stamps[1] - stamps[0];
    const gaps = [];
    for (let i = 2; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
    const arr = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    return {
      samples: stamps.length,
      dasMs: +firstRepeat.toFixed(1),
      arrMs: arr === null ? null : +arr.toFixed(1),
      dasTarget: CONFIG.DAS, arrTarget: CONFIG.ARR,
    };
  });
  log('dasArr', das);

  /* --------------------------------------------- 4. 연출 중 입력 유실 여부 */
  const buffered = await page.evaluate(async () => {
    const g = window.glassNight, e = g.engine;
    e.reset(); g.fx.clear(); g.state = 'playing'; g.clearing = null;
    for (let x = 1; x < 10; x++) e.board[21][x] = 'J';
    e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
    g.lockNow();                                  // CLEARING 진입
    const stateDuringClear = g.state;
    const xBefore = e.piece ? e.piece.x : null;
    // 연출 도중 좌로 두 칸 누른다
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
    await new Promise((r) => setTimeout(r, CONFIG.CLEAR_ANIM + 160));
    const spawnX = e.piece ? e.piece.x : null;
    const natural = e.piece ? (PIECES[e.piece.key].size === 2 ? 4 : 3) : null;
    return { stateDuringClear, xBefore, spawnX, natural,
      kept: spawnX !== null && natural !== null && spawnX < natural };
  });
  log('inputDuringClear', buffered);

  /* --------------------------------------------- 5. 난이도 곡선 */
  const curve = await page.evaluate(() => {
    const g = [];
    for (let lv = 1; lv <= 21; lv++) g.push(gravityFor(lv));
    let monotone = true;
    const ratios = [];
    for (let i = 1; i < g.length; i++) {
      if (g[i] > g[i - 1]) monotone = false;
      ratios.push(+(g[i] / g[i - 1]).toFixed(3));
    }
    return { monotone, minRatio: Math.min(...ratios), maxDrop: 1 - Math.min(...ratios), gravity: g };
  });
  log('difficulty', curve);

  /* --------------------------------------------- 6. 장시간 자동 플레이 */
  const soak = await page.evaluate(async () => {
    const g = window.glassNight;
    g.restart();
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyZ', 'Space', 'KeyC', 'ArrowDown'];
    let acted = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 9000) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
      acted++;
      await new Promise((r) => setTimeout(r, 12));
      if (g.state === 'gameover') g.restart();
    }
    return { actions: acted, state: g.state, score: g.engine.score,
      lines: g.engine.lines, level: g.engine.level, pieces: g.engine.stats.pieces };
  });
  log('soak', soak);

  /* --------------------------------------------- 6.4 밤의 시각별 색 거리 */
  const phases = await page.evaluate(async () => {
    const g = window.glassNight;
    const sample = (lv) => {
      g.sky.setLevel(lv); g.sky.shownLevel = lv; g.sky.bake(); g.sky.draw();
      const c = g.sky.canvas, cx = c.getContext('2d');
      const pick = (fx, fy) => {
        const d = cx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return { top: pick(0.3, 0.12), mid: pick(0.3, 0.5), low: pick(0.3, 0.82) };
    };
    const ats = NIGHT_PHASES.map((p) => p.at);
    const shots = ats.map(sample);
    const dist = (a, b) => ['top', 'mid', 'low']
      .reduce((s2, k) => s2 + Math.abs(a[k][0]-b[k][0]) + Math.abs(a[k][1]-b[k][1]) + Math.abs(a[k][2]-b[k][2]), 0);
    const gaps = [];
    for (let i = 1; i < shots.length; i++) gaps.push(dist(shots[i - 1], shots[i]));
    return { levels: ats, gaps, minGap: Math.min(...gaps), firstToLast: dist(shots[0], shots[shots.length - 1]) };
  });
  log('phases', phases);

  /* --------------------------------------------- 6.5 견고함 (엣지케이스) */
  const robust = await page.evaluate(async () => {
    const g = window.glassNight;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const notes = [];
    const fail = (m) => notes.push(m);

    // (a) 플레이 도중 창 크기가 바뀌어도 상태가 유지되는가
    g.restart();
    await wait(120);
    const before = g.state;
    g.layout(); g.layout();
    if (g.state !== before) fail('크기 변경 후 상태가 바뀜');
    if (!(g.cell > 0)) fail('크기 변경 후 칸 크기가 이상함');

    // (b) 줄 삭제 연출 중 일시정지 → 재개하면 연출이 이어지는가
    g.restart();
    const e = g.engine;
    for (let x = 1; x < 10; x++) e.board[21][x] = 'J';
    e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
    g.lockNow();
    if (g.state !== 'clearing') fail('줄 삭제 후 clearing 으로 가지 않음');
    g.togglePause();
    if (g.state !== 'paused') fail('연출 중 일시정지 실패');
    await wait(200);
    if (g.state !== 'paused') fail('일시정지가 풀림');
    g.togglePause();
    if (g.state !== 'clearing') fail('재개 후 연출로 돌아오지 않음');
    await wait(CONFIG.CLEAR_ANIM + 220);
    if (g.state !== 'playing') fail('연출이 끝나고 playing 으로 가지 않음: ' + g.state);

    // (c) 소멸 연출 중 재시작 연타
    g.startDeath();
    for (let i = 0; i < 6; i++) { g.restart(); await wait(16); }
    if (g.state !== 'playing') fail('소멸 중 재시작 연타 후 상태: ' + g.state);
    if (g.dying) fail('재시작 후에도 소멸 연출이 남음');

    // (d) 홀드 연타 — 조각당 한 번만
    g.restart(); await wait(60);
    let swaps = 0;
    const key0 = g.engine.piece.key;
    for (let i = 0; i < 8; i++) { const h = g.engine.hold; g.hold(); if (g.engine.hold !== h) swaps++; }
    if (swaps !== 1) fail(`홀드 연타로 ${swaps}회 교체됨 (1회여야 함)`);

    // (e) 탭 숨김/복귀
    g.restart(); await wait(60);
    document.dispatchEvent(new Event('visibilitychange'));
    await wait(40);

    // (f) 준비 화면에서 게임 키를 눌러도 조용히 넘어가는가
    g.state = 'ready';
    for (const c of ['ArrowLeft', 'Space', 'KeyC', 'ArrowUp']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    }
    g.restart();

    return { issues: notes };
  });
  log('robust', robust);

  /* --------------------------------------------- 7. 폭별 레이아웃 */
  const widths = [320, 360, 390, 430, 540, 768, 860, 1024, 1280, 1600, 1920];
  const layout = [];
  for (const w of widths) {
    const h = w < 860 ? 780 : 900;
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`[${w}px] ${e.message}`));
    await p.setViewportSize({ width: w, height: h });
    await p.goto(INDEX);
    await p.waitForTimeout(320);
    await p.click('[data-action="start"]');
    await p.waitForTimeout(160);
    const r = await p.evaluate(() => {
      const R = (s) => { const e = document.querySelector(s); if (!e) return null;
        const b = e.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return null;
        return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
      const field = R('.field'), pad = R('.touchpad'), bar = R('.title-bar');
      const left = R('.side.left'), right = R('.side.right');
      const overlap = (a, b2) => a && b2 && a.l < b2.r - 1 && b2.l < a.r - 1 && a.t < b2.b - 1 && b2.t < a.b - 1;
      // 글자 잘림 검사
      let clipped = 0;
      for (const el of document.querySelectorAll('.stats dd, .stats dt, .title-bar h1, .pad, .chip, .box h2')) {
        if (el.scrollWidth > el.clientWidth + 1) clipped++;
      }
      return {
        w: window.innerWidth,
        hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        vOverflow: document.documentElement.scrollHeight > window.innerHeight + 1,
        fieldOffscreen: !!field && (field.l < -1 || field.r > window.innerWidth + 1
          || field.t < -1 || field.b > window.innerHeight + 1),
        overlapLR: overlap(left, right),
        overlapBar: overlap(bar, left) || overlap(bar, right) || overlap(bar, field),
        overlapPad: overlap(pad, field),
        clipped,
        cell: window.glassNight.cell,
      };
    });
    layout.push(r);
    await p.close();
  }
  log('layout', layout);

  log('errors', errors);
  await browser.close();

  /* --------------------------------------------------------------- 보고 */
  const bad = [];
  if (out.frame.fps < 55) bad.push(`평균 ${out.frame.fps}fps (목표 55+)`);
  if (out.frame.worstMs > 33) bad.push(`최악 프레임 ${out.frame.worstMs}ms (목표 ≤33)`);
  if (!out.inputLatency.appliedImmediately) bad.push('입력이 같은 프레임에 반영되지 않음');
  if (out.dasArr.dasMs && Math.abs(out.dasArr.dasMs - out.dasArr.dasTarget) > out.dasArr.dasTarget * 0.15)
    bad.push(`DAS 실측 ${out.dasArr.dasMs}ms (설정 ${out.dasArr.dasTarget})`);
  if (out.dasArr.arrMs && Math.abs(out.dasArr.arrMs - out.dasArr.arrTarget) > out.dasArr.arrTarget * 0.5)
    bad.push(`ARR 실측 ${out.dasArr.arrMs}ms (설정 ${out.dasArr.arrTarget})`);
  if (!out.inputDuringClear.kept) bad.push('줄 삭제 연출 중 입력이 유실됨');
  if (!out.difficulty.monotone) bad.push('난이도 곡선이 단조 감소가 아님');
  if (out.difficulty.minRatio < 0.7) bad.push(`난이도 절벽 (최소 비율 ${out.difficulty.minRatio})`);
  for (const l of out.layout) {
    const f = [];
    if (l.hOverflow) f.push('가로넘침'); if (l.vOverflow) f.push('세로넘침');
    if (l.fieldOffscreen) f.push('필드이탈'); if (l.overlapLR) f.push('패널겹침');
    if (l.overlapBar) f.push('제목겹침'); if (l.overlapPad) f.push('버튼겹침');
    if (l.clipped) f.push(`글자잘림${l.clipped}`);
    if (f.length) bad.push(`${l.w}px: ${f.join(', ')}`);
  }
  if (out.phases.minGap < 40) bad.push(`이웃한 밤의 시각이 너무 비슷함 (최소 색거리 ${out.phases.minGap})`);
  for (const i of (out.robust ? out.robust.issues : [])) bad.push('견고함: ' + i);
  if (errors.length) bad.push(`예외 ${errors.length}건: ${errors.slice(0, 3).join(' | ')}`);

  console.log('\n\x1b[36m측정 결과\x1b[0m');
  console.log(' 프레임      ', JSON.stringify(out.frame));
  console.log(' 입력반응    ', JSON.stringify(out.inputLatency));
  console.log(' DAS/ARR     ', JSON.stringify(out.dasArr));
  console.log(' 연출중입력  ', JSON.stringify(out.inputDuringClear));
  console.log(' 난이도곡선  ', JSON.stringify({ monotone: out.difficulty.monotone, minRatio: out.difficulty.minRatio }));
  console.log(' 자동플레이  ', JSON.stringify(out.soak));
  console.log(' 밤의 시각   ', JSON.stringify(out.phases));
  console.log(' 견고함      ', out.robust.issues.length ? out.robust.issues.join(' | ') : '문제 없음');
  console.log(' 레이아웃    ', out.layout.map((l) => `${l.w}:${l.cell}`).join(' '));
  console.log(`\n${bad.length ? '\x1b[31m문제 ' + bad.length + '건\x1b[0m' : '\x1b[32m문제 없음\x1b[0m'}`);
  for (const b of bad) console.log('  \x1b[31m·\x1b[0m ' + b);
  console.log();
  process.exit(bad.length ? 1 : 0);
})();
