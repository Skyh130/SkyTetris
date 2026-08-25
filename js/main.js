/* =========================================================================
 *  main.js — 부팅. DOM 을 모아 게임에 넘기고 루프를 돌린다.
 * ========================================================================= */

(function boot() {
  const $ = (id) => document.getElementById(id);

  const els = {
    sky: $('sky'),
    board: $('board'),
    field: $('field'),
    hold: $('hold'),
    next: $('next'),
    overlay: $('overlay'),
    toasts: $('toasts'),
    score: $('score'),
    best: $('best'),
    level: $('level'),
    lines: $('lines'),
    phase: $('phase'),
    phaseSub: $('phase-sub'),
    finalScore: $('final-score'),
    finalLines: $('final-lines'),
    finalLevel: $('final-level'),
    finalPhase: $('final-phase'),
    newBest: $('new-best'),
    live: $('live'),
    night: $('night'),
    nightFill: $('night-fill'),
    holdEmpty: $('hold-empty'),
    pauseLore: $('pause-lore'),
    holdText: $('hold-text'),
    nextText: $('next-text'),
  };

  const missing = Object.entries(els).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('필요한 요소를 찾지 못했습니다:', missing.join(', '));
    return;
  }

  const game = new Game(els);
  new Input(game);

  // 음소거 버튼의 초기 표시를 저장된 설정에 맞춘다 (FR-7.3)
  const muteBtn = document.querySelector('[data-action="mute"]');
  if (muteBtn && Sfx.muted) {
    muteBtn.classList.add('off');
    muteBtn.setAttribute('aria-pressed', 'true');
    muteBtn.querySelector('.label').textContent = '소리 꺼짐';
  }

  // 탭이 가려지면 알아서 멈춘다
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') game.togglePause();
  });

  game.run();

  // 콘솔에서 들여다볼 수 있게
  window.glassNight = game;
})();
