/* =========================================================================
 *  fuzz.js — 적대적 테스트 (docs/QUALITY.md C2)
 *
 *  '정상적인 플레이'가 아니라 사람이 실제로 저지르는 짓을 흉내 낸다.
 *  연출 도중 창 크기를 바꾸고, 죽는 순간 재시작을 연타하고,
 *  저장된 값이 망가져 있고, 오디오가 막혀 있는 환경.
 *
 *  실행:  node tests/fuzz.js
 * ========================================================================= */
const path = require('path');
const { execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) { /* 전역에서 찾는다 */ }
  return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}
const { chromium } = loadPlaywright();
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

const results = [];
const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  /* ---------------------------------------------- 1. 무작위 난동 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('[난동] ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('[난동] ' + m.text()); });
    await page.goto(INDEX);
    await page.waitForTimeout(400);

    const report = await page.evaluate(async () => {
      const g = window.glassNight;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyZ', 'KeyX',
        'Space', 'KeyC', 'KeyP', 'Escape', 'KeyR', 'KeyM', 'Enter'];
      const states = new Set();
      let steps = 0;
      const t0 = performance.now();

      while (performance.now() - t0 < 11000) {
        const roll = Math.random();
        if (roll < 0.72) {
          const k = keys[Math.floor(Math.random() * keys.length)];
          window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
          if (Math.random() < 0.85) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
        } else if (roll < 0.80) {
          g.layout();                                   // 연출 중 크기 변경
        } else if (roll < 0.86) {
          document.dispatchEvent(new Event('visibilitychange'));
        } else if (roll < 0.92) {
          const b = document.querySelectorAll('[data-action]');
          b[Math.floor(Math.random() * b.length)].dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true }));
        } else if (roll < 0.96) {
          window.dispatchEvent(new Event('blur'));
        } else if (Math.random() < 0.5) {
          // 삭제 연출과 소멸 연출도 난동 한복판에 섞어 넣는다
          const e = g.engine;
          if (g.state === 'playing' && e.piece) {
            for (let x = 1; x < 10; x++) e.board[21][x] = 'J';
            e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
            g.lockNow();
          }
        } else {
          g.startDeath();
        }
        states.add(g.state);
        steps++;
        await wait(Math.random() < 0.25 ? 0 : 8);
      }
      // 난동 뒤에도 정상으로 돌아오는가
      g.restart();
      await wait(200);
      return {
        steps,
        visited: [...states],
        recovered: g.state === 'playing' && !!g.engine.piece,
        cell: g.cell,
        score: g.engine.score,
        particles: g.fx.count,
      };
    });
    ok('무작위 난동 뒤에도 정상 복귀', report.recovered,
      `${report.steps}회 조작, 거쳐 간 상태: ${report.visited.join('/')}`);
    ok('난동 중 파티클이 상한을 넘지 않음', report.particles <= 400, `${report.particles}개`);
    await ctx.close();
  }

  /* ---------------------------------------------- 2. 저장된 값이 망가진 경우 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('[저장값] ' + e.message));
    await page.addInitScript(() => {
      localStorage.setItem('glassnight.best', '아니오');      // 숫자가 아님
      localStorage.setItem('glassnight.muted', 'maybe');       // 0/1 이 아님
    });
    await page.goto(INDEX);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      best: window.glassNight.best,
      bestShown: document.getElementById('best').textContent,
      muted: Sfx.muted,
    }));
    ok('망가진 저장값을 만나도 0 으로 시작', r.best === 0 && r.bestShown === '0',
      JSON.stringify(r));
    await ctx.close();
  }

  /* ---------------------------------------------- 3. 저장소 자체가 막힌 경우 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('[저장소차단] ' + e.message));
    await page.addInitScript(() => {
      const boom = () => { throw new DOMException('차단됨', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { return { getItem: boom, setItem: boom, removeItem: boom }; },
      });
    });
    await page.goto(INDEX);
    await page.waitForTimeout(500);
    const alive = await page.evaluate(async () => {
      if (!window.glassNight) return { booted: false };
      window.glassNight.start();
      window.glassNight.engine.score = 999;
      window.glassNight.gameOver();
      await new Promise((r) => setTimeout(r, 150));
      return { booted: true, state: window.glassNight.state };
    });
    ok('localStorage 가 막혀 있어도 게임이 돌아간다',
      alive.booted && alive.state === 'gameover', JSON.stringify(alive));
    await ctx.close();
  }

  /* ---------------------------------------------- 4. 오디오가 막힌 경우 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('[오디오차단] ' + e.message));
    await page.addInitScript(() => {
      delete window.AudioContext;
      delete window.webkitAudioContext;
    });
    await page.goto(INDEX);
    await page.waitForTimeout(400);
    const r = await page.evaluate(async () => {
      const g = window.glassNight;
      g.start();
      for (let i = 0; i < 12; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        await new Promise((r2) => setTimeout(r2, 30));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
      return { state: g.state, pieces: g.engine.stats.pieces };
    });
    ok('AudioContext 가 없어도 게임이 돌아간다', r.pieces > 3, JSON.stringify(r));
    await ctx.close();
  }

  /* ---------------------------------------------- 5. 극단적인 창 크기 */
  {
    const sizes = [[240, 400], [320, 480], [1920, 400], [400, 1200], [3000, 1400]];
    for (const [w, h] of sizes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${w}x${h}] ` + e.message));
      await page.goto(INDEX);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const g = window.glassNight;
        g.start();
        const b = document.getElementById('board').getBoundingClientRect();
        return {
          cell: g.cell,
          w: b.width, h: b.height,
          inside: b.width > 0 && b.height > 0
            && b.right <= window.innerWidth + 2 && b.bottom <= window.innerHeight + 2,
          hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      ok(`${w}×${h} 에서 판이 화면 안에 들어간다`, r.inside && !r.hOverflow,
        `칸 ${r.cell}px, 판 ${Math.round(r.w)}×${Math.round(r.h)}`);
      await ctx.close();
    }
  }

  /* ---------------------------------------------- 6. 연출 한복판의 개입 */
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('[연출개입] ' + e.message));
    await page.goto(INDEX);
    await page.waitForTimeout(300);
    const r = await page.evaluate(async () => {
      const g = window.glassNight;
      const wait = (ms) => new Promise((r2) => setTimeout(r2, ms));
      const issues = [];
      const setupClear = () => {
        g.restart();
        const e = g.engine;
        for (let x = 1; x < 10; x++) e.board[21][x] = 'J';
        e.piece = new Piece('I'); e.piece.rot = 1; e.piece.x = -2; e.piece.y = 18;
        g.lockNow();
      };
      // (a) 삭제 연출 한복판에 크기 변경
      setupClear(); await wait(60); g.layout(); await wait(CONFIG.CLEAR_ANIM + 200);
      if (g.state !== 'playing') issues.push('삭제 중 크기 변경 후 ' + g.state);
      // (b) 삭제 연출 한복판에 재시작
      setupClear(); await wait(60); g.restart(); await wait(120);
      if (g.state !== 'playing') issues.push('삭제 중 재시작 후 ' + g.state);
      if (g.clearing) issues.push('재시작 후에도 삭제 연출이 남음');
      // (c) 소멸 연출 한복판에 크기 변경 + 일시정지
      g.startDeath(); await wait(80); g.layout(); g.togglePause(); await wait(80);
      g.togglePause(); await wait(1500);
      if (g.state !== 'gameover') issues.push('소멸 중 개입 후 ' + g.state);
      // (d) 게임 오버 화면에서 게임 키 연타
      for (const c of ['ArrowLeft', 'Space', 'KeyC', 'ArrowUp', 'KeyP']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
      }
      await wait(80);
      if (g.state !== 'gameover') issues.push('게임 오버 화면에서 키로 상태가 바뀜: ' + g.state);
      // (e) 되살아나는지
      g.restart(); await wait(150);
      if (g.state !== 'playing') issues.push('마지막 재시작 실패: ' + g.state);
      return { issues };
    });
    ok('연출 한복판에 끼어들어도 무너지지 않는다', r.issues.length === 0,
      r.issues.join(' | ') || '개입 5종 모두 정상');
    await ctx.close();
  }

  await browser.close();

  ok('예외 0건', errors.length === 0,
    errors.length ? errors.slice(0, 5).join(' | ') : '콘솔 깨끗함');

  console.log('\n\x1b[36m적대적 테스트\x1b[0m\n');
  let fail = 0;
  for (const r of results) {
    if (!r.pass) fail++;
    console.log(` ${r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name}`);
    if (r.detail) console.log(`      \x1b[90m${r.detail}\x1b[0m`);
  }
  console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${results.length - fail} / ${results.length} 통과\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
