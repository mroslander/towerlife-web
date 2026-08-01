/**
 * snake.js — Snake arcade game
 *
 * Self-contained game logic.  Rendering is done on a plain 2D canvas.
 * All external integrations (score reporting, achievements, save, audio)
 * go through the shared common libraries loaded before this script.
 *
 * Depends on (loaded via <script> tags in index.html):
 *   save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────
  const GRID       = 20;           // cells per axis
  const CELL       = 20;           // px per cell  →  400 × 400 canvas
  const SIZE       = GRID * CELL;

  const TICK_START = 150;          // ms between moves (initial speed)
  const TICK_MIN   = 60;           // ms (max speed)
  const TICK_STEP  = 4;            // ms reduction per food eaten

  const POINTS_PER_FOOD = 10;

  // ── Direction map ──────────────────────────────────────────────
  const KEY_DIR = {
    ArrowUp:    { x:  0, y: -1 },
    ArrowDown:  { x:  0, y:  1 },
    ArrowLeft:  { x: -1, y:  0 },
    ArrowRight: { x:  1, y:  0 },
    w:          { x:  0, y: -1 },
    s:          { x:  0, y:  1 },
    a:          { x: -1, y:  0 },
    d:          { x:  1, y:  0 },
  };

  // ── State ──────────────────────────────────────────────────────
  let canvas, ctx;
  let snake;       // Array<{x, y}>  — head first
  let dir;         // current direction applied this tick
  let nextDir;     // direction queued by input
  let food;        // {x, y}
  let score;
  let highScore;
  let tick;        // current interval ms
  let loopId;      // setInterval handle
  let state;       // 'start' | 'playing' | 'paused' | 'over'

  // ── Initialise ────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    canvas.width  = SIZE;
    canvas.height = SIZE;

    highScore = Save.load('snake_high_score', 0);
    UI.setScore('high-score', highScore);

    bindInput();
    bindTouch();
    bindButtons();

    // Listen for Unity commands (pause / mute)
    TowerLife.onMessage(handleUnityMessage);

    enterState('start');
    TowerLife.onGameReady('snake');
  }

  // ── Game lifecycle ────────────────────────────────────────────
  function startGame() {
    snake   = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    dir     = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score   = 0;
    tick    = TICK_START;

    placeFood();
    UI.setScore('score', 0);

    clearInterval(loopId);
    loopId = setInterval(step, tick);

    enterState('playing');
    render();
  }

  function step() {
    if (state !== 'playing') return;
    dir = nextDir;

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision
    if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
      endGame(); return;
    }
    // Self collision
    for (let i = 0; i < snake.length; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) {
        endGame(); return;
      }
    }

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      collectFood();
    } else {
      snake.pop();
    }

    render();
  }

  function collectFood() {
    score += POINTS_PER_FOOD;
    UI.setScore('score', score);
    TowerLife.sendScore(score);
    GameAudio.eat();
    placeFood();
    checkAchievements();

    // Update high score
    if (score > highScore) {
      highScore = score;
      Save.save('snake_high_score', highScore);
      UI.setScore('high-score', highScore);
      GameAudio.score();
    }

    // Increase speed
    const newTick = Math.max(TICK_MIN, TICK_START - Math.floor(score / POINTS_PER_FOOD) * TICK_STEP);
    if (newTick !== tick) {
      tick = newTick;
      clearInterval(loopId);
      loopId = setInterval(step, tick);
    }
  }

  function endGame() {
    clearInterval(loopId);
    loopId = null;
    GameAudio.die();
    TowerLife.onGameOver(score, { highScore });
    UI.setScore('final-score', score);
    UI.setScore('final-high', highScore);
    enterState('over');
    render(); // draw final frame
  }

  function togglePause() {
    if (state === 'playing') {
      clearInterval(loopId);
      loopId = null;
      enterState('paused');
    } else if (state === 'paused') {
      loopId = setInterval(step, tick);
      enterState('playing');
    }
  }

  // ── Food placement ─────────────────────────────────────────────
  function placeFood() {
    let pos;
    let attempts = 0;
    do {
      pos = {
        x: Math.floor(Math.random() * GRID),
        y: Math.floor(Math.random() * GRID),
      };
      attempts++;
    } while (attempts < 200 && snake.some(s => s.x === pos.x && s.y === pos.y));
    food = pos;
  }

  // ── Achievements ───────────────────────────────────────────────
  function checkAchievements() {
    const len = snake.length;
    if (score >=  10) Achievements.unlock('snake_first_food',  'First Food!');
    if (score >=  50) Achievements.unlock('snake_score_50',    'Score 50');
    if (score >= 100) Achievements.unlock('snake_score_100',   'Score 100');
    if (score >= 200) Achievements.unlock('snake_score_200',   'Score 200');
    if (score >= 500) Achievements.unlock('snake_score_500',   'Score 500');
    if (len   >=  10) Achievements.unlock('snake_length_10',   'Long Snake!');
    if (len   >=  20) Achievements.unlock('snake_length_20',   'Giant Snake!');
  }

  // ── Rendering ──────────────────────────────────────────────────
  function render() {
    const W = SIZE, H = SIZE;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid dots
    ctx.fillStyle = '#161616';
    for (let gx = 0; gx < GRID; gx++) {
      for (let gy = 0; gy < GRID; gy++) {
        ctx.fillRect(gx * CELL + CELL / 2 - 1, gy * CELL + CELL / 2 - 1, 2, 2);
      }
    }

    // Food — red glow
    ctx.save();
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#ff4444';
    ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);
    ctx.restore();

    // Snake
    for (let i = 0; i < snake.length; i++) {
      const seg = snake[i];
      const isHead = i === 0;

      ctx.save();
      if (isHead) {
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur  = 12;
        ctx.fillStyle   = '#00ff88';
      } else {
        const fade = Math.max(0.35, 1 - (i / snake.length) * 0.65);
        ctx.fillStyle = `rgba(0, 210, 110, ${fade})`;
      }

      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
      ctx.restore();
    }

    // Eyes on the head (fun visual touch)
    if (snake.length > 0 && state !== 'over') {
      drawEyes(snake[0], dir);
    }
  }

  function drawEyes(head, d) {
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    // Offset eyes perpendicular to movement direction
    const perp = { x: -d.y, y: d.x };
    const front = 4;
    const side  = 4;

    const e1 = { x: cx + d.x * front + perp.x * side,  y: cy + d.y * front + perp.y * side };
    const e2 = { x: cx + d.x * front - perp.x * side,  y: cy + d.y * front - perp.y * side };

    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(e1.x, e1.y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e2.x, e2.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // ── Input ──────────────────────────────────────────────────────
  function bindInput() {
    document.addEventListener('keydown', (e) => {
      const d = KEY_DIR[e.key];
      if (d) {
        e.preventDefault();
        queueDirection(d);
        // Resume from paused state on directional key
        if (state === 'paused') togglePause();
        return;
      }

      switch (e.key) {
        case 'p': case 'P': case 'Escape':
          if (state === 'playing' || state === 'paused') togglePause();
          break;
        case 'Enter': case ' ':
          if (state === 'start' || state === 'over') startGame();
          break;
      }
    });
  }

  function queueDirection(d) {
    // Prevent 180° reversal
    if (d.x === -dir.x && d.y === -dir.y) return;
    nextDir = d;
    if (state === 'start' || state === 'over') startGame();
  }

  // ── Touch swipe ───────────────────────────────────────────────
  function bindTouch() {
    let origin = null;
    const MIN_SWIPE = 22; // px

    canvas.addEventListener('touchstart', (e) => {
      origin = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      if (!origin) return;
      const dx = e.changedTouches[0].clientX - origin.x;
      const dy = e.changedTouches[0].clientY - origin.y;
      origin = null;

      if (Math.abs(dx) < MIN_SWIPE && Math.abs(dy) < MIN_SWIPE) {
        // Tap → start / pause
        if (state === 'start' || state === 'over') { startGame(); return; }
        if (state === 'playing' || state === 'paused') { togglePause(); return; }
        return;
      }

      const d = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? KEY_DIR.ArrowRight : KEY_DIR.ArrowLeft)
        : (dy > 0 ? KEY_DIR.ArrowDown  : KEY_DIR.ArrowUp);

      queueDirection(d);
      e.preventDefault();
    }, { passive: false });
  }

  // ── Buttons ────────────────────────────────────────────────────
  function bindButtons() {
    const btnStart   = document.getElementById('btn-start');
    const btnRestart = document.getElementById('btn-restart');
    const btnPause   = document.getElementById('btn-pause');
    const btnResume  = document.getElementById('btn-resume');
    const btnMute    = document.getElementById('btn-mute');

    if (btnStart)   btnStart.addEventListener('click', startGame);
    if (btnRestart) btnRestart.addEventListener('click', startGame);
    if (btnPause)   btnPause.addEventListener('click', () => { if (state === 'playing') togglePause(); });
    if (btnResume)  btnResume.addEventListener('click', () => { if (state === 'paused')  togglePause(); });
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        const muted = !GameAudio.isMuted();
        GameAudio.setMuted(muted);
        btnMute.textContent  = muted ? '🔇' : '🔊';
        btnMute.title        = muted ? 'Unmute' : 'Mute';
        btnMute.classList.toggle('muted', muted);
      });
    }
  }

  // ── Unity message handler ──────────────────────────────────────
  function handleUnityMessage(msg) {
    switch (msg.type) {
      case 'PAUSE':  if (state === 'playing') togglePause(); break;
      case 'RESUME': if (state === 'paused')  togglePause(); break;
      case 'MUTE':   GameAudio.setMuted(msg.muted); break;
    }
  }

  // ── State machine ──────────────────────────────────────────────
  function enterState(newState) {
    state = newState;
    UI.hideOverlay('overlay-start');
    UI.hideOverlay('overlay-pause');
    UI.hideOverlay('overlay-over');
    const pauseBtn = document.getElementById('btn-pause');
    if (newState === 'start')  { UI.showOverlay('overlay-start'); }
    if (newState === 'paused') { UI.showOverlay('overlay-pause'); }
    if (newState === 'over')   { UI.showOverlay('overlay-over');  }
    if (pauseBtn) pauseBtn.disabled = (newState !== 'playing' && newState !== 'paused');
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', init);
})();
