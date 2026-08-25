/* =========================================================================
 *  input.js — 키보드 · 터치 · 화면 버튼 (PRD FR-3)
 * ========================================================================= */

/* 코드 → 동작. 한 동작에 여러 키를 붙일 수 있다. */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'soft', KeyS: 'soft',
  ArrowUp: 'cw', KeyX: 'cw',
  KeyZ: 'ccw', ControlLeft: 'ccw', ControlRight: 'ccw', KeyW: 'ccw',
  Space: 'hard',
  KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
  KeyP: 'pause', Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
  Enter: 'confirm',
};

const NO_SCROLL = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyP',
]);

class Input {
  constructor(game) {
    this.game = game;
    game.input = this;

    this.dir = 0;          // -1 왼쪽, +1 오른쪽, 0 없음
    this.held = { left: false, right: false };
    this.dasTimer = 0;
    this.arrTimer = 0;

    this.bindKeyboard();
    this.bindButtons();
    this.bindTouch();
  }

  /* ------------------------------------------------------------ 키보드 */
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;                        // 자동 반복은 우리가 직접 만든다
      const action = KEYMAP[e.code];
      if (!action) return;
      if (NO_SCROLL.has(e.code)) e.preventDefault();   // FR-3.2
      Sfx.resume();
      this.press(action);
    });

    window.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      this.release(action);
    });

    // 창을 벗어나면 눌린 키를 모두 놓은 것으로 본다
    window.addEventListener('blur', () => {
      this.held.left = this.held.right = false;
      this.dir = 0;
      this.game.setSoftDrop(false);
    });
  }

  press(action) {
    const g = this.game;
    switch (action) {
      case 'left':
        this.held.left = true; this.startMove(-1); break;
      case 'right':
        this.held.right = true; this.startMove(1); break;
      case 'soft':
        g.setSoftDrop(true); break;
      case 'cw': g.rotate(1); break;
      case 'ccw': g.rotate(-1); break;
      case 'hard': g.hardDrop(); break;
      case 'hold': g.hold(); break;
      case 'pause':
        if (g.state === 'ready' || g.state === 'gameover') break;
        g.togglePause(); break;
      case 'restart': g.restart(); break;
      case 'mute': this.toggleMute(); break;
      case 'confirm':
        if (g.state === 'ready') g.start();
        else if (g.state === 'gameover') g.restart();
        else if (g.state === 'paused') g.togglePause();
        break;
    }
  }

  release(action) {
    if (action === 'left') { this.held.left = false; this.reMove(); }
    else if (action === 'right') { this.held.right = false; this.reMove(); }
    else if (action === 'soft') this.game.setSoftDrop(false);
  }

  /* 나중에 누른 방향이 이긴다 — 방향 전환이 즉각적이도록 */
  startMove(dir) {
    this.dir = dir;
    this.dasTimer = 0;
    this.arrTimer = 0;
    this.game.moveH(dir);
  }

  reMove() {
    if (this.held.left && !this.held.right) this.startMove(-1);
    else if (this.held.right && !this.held.left) this.startMove(1);
    else this.dir = 0;
  }

  /* DAS 150ms 뒤 ARR 40ms 간격으로 반복 (FR-3.1) */
  update(dt) {
    if (!this.dir) return;
    const ms = dt * 1000;
    this.dasTimer += ms;
    if (this.dasTimer < CONFIG.DAS) return;
    this.arrTimer += ms;
    while (this.arrTimer >= CONFIG.ARR) {
      this.arrTimer -= CONFIG.ARR;
      this.game.moveH(this.dir);
    }
  }

  toggleMute() {
    Sfx.resume();
    const muted = Sfx.toggleMute();
    const btn = document.querySelector('[data-action="mute"]');
    if (btn) {
      btn.classList.toggle('off', muted);
      btn.setAttribute('aria-pressed', String(muted));
      const label = btn.querySelector('.label');
      if (label) label.textContent = muted ? '소리 꺼짐' : '소리 켜짐';
    }
  }

  /* -------------------------------------------------- 화면 버튼 (공용) */
  bindButtons() {
    for (const btn of document.querySelectorAll('[data-action]')) {
      const action = btn.dataset.action;
      const repeatable = action === 'left' || action === 'right' || action === 'soft';

      const down = (e) => {
        e.preventDefault();
        Sfx.resume();
        btn.classList.add('down');
        if (action === 'start') return this.game.start();
        if (action === 'resume') return this.game.togglePause();
        this.press(action);
      };
      const up = (e) => {
        if (e) e.preventDefault();
        btn.classList.remove('down');
        if (repeatable) this.release(action);
      };

      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', () => { if (repeatable) up(); });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  /* ------------------------------------------------------------- 터치 */
  bindTouch() {
    const el = this.game.els.field;
    let active = false, sx = 0, sy = 0, lastX = 0, lastY = 0, t0 = 0, moved = 0;

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      active = true;
      sx = lastX = e.clientX; sy = lastY = e.clientY;
      t0 = performance.now(); moved = 0;
      Sfx.resume();
    });

    el.addEventListener('pointermove', (e) => {
      if (!active) return;
      e.preventDefault();
      const step = Math.max(18, this.game.cell * 0.9);

      const dx = e.clientX - lastX;
      if (Math.abs(dx) >= step) {
        const n = Math.trunc(dx / step);
        for (let i = 0; i < Math.abs(n); i++) this.game.moveH(Math.sign(n));
        lastX += n * step;
        moved += Math.abs(n);
      }

      const dy = e.clientY - lastY;
      if (dy >= step) {
        this.game.setSoftDrop(true);
        lastY = e.clientY;
        moved++;
      }
    }, { passive: false });

    const end = (e) => {
      if (!active) return;
      active = false;
      this.game.setSoftDrop(false);
      const dt = performance.now() - t0;
      const dx = e.clientX - sx, dy = e.clientY - sy;

      // 아래로 빠르게 튕기면 하드 드롭
      if (dy > 70 && dt < 260 && Math.abs(dx) < Math.abs(dy)) {
        return this.game.hardDrop();
      }
      // 거의 움직이지 않은 짧은 탭은 회전
      if (moved === 0 && dt < 260 && Math.hypot(dx, dy) < 16) {
        if (this.game.state === 'ready') return this.game.start();
        if (this.game.state === 'gameover') return this.game.restart();
        return this.game.rotate(1);
      }
    };

    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      active = false;
      this.game.setSoftDrop(false);
    });
  }
}
