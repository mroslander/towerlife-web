/**
 * blockazoid.js — Tetris-clone arcade game
 *
 * Stack falling blocks to clear lines.  The auto-drop speed accelerates
 * continuously — survive as long as possible and rack up a high score.
 *
 * Depends on (loaded via index.html):
 *   save.js · towerlife.js · audio.js · achievements.js · ui.js
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  DIFFICULTY CONSTANTS  — adjust these to tune the game
  // ══════════════════════════════════════════════════════════════════════
  const DROP_MS_START  = 800;         // auto-drop interval at game start (ms)
  const DROP_MS_MIN    = 80;          // fastest auto-drop interval (ms)
  const DROP_HALF_SECS = 25;          // seconds until drop interval halves
  const LOCK_DELAY_MS  = 450;         // ms before piece locks after landing
  const FLASH_DUR_MS   = 260;         // ms for line-clear flash animation

  // ══════════════════════════════════════════════════════════════════════
  //  GRID / CANVAS
  // ══════════════════════════════════════════════════════════════════════
  const COLS    = 10;
  const ROWS    = 20;
  const CELL    = 24;             // px per cell
  const BOARD_W = COLS * CELL;    // 240
  const BOARD_H = ROWS * CELL;    // 480
  const GAP     = 8;
  const PAN_W   = 72;
  const CW      = BOARD_W + GAP + PAN_W;  // 320
  const CH      = BOARD_H;                // 480

  // ══════════════════════════════════════════════════════════════════════
  //  PIECE DEFINITIONS  (7 tetrominoes, 4 rotations each, stored as 4×4 grids)
  // ══════════════════════════════════════════════════════════════════════
  const PIECE_DATA = [
    // 0: I  – cyan
    { color: '#00eeff', dark: '#005566', grids: [
      [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
      [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    ]},
    // 1: O  – yellow
    { color: '#ffcc00', dark: '#7a5e00', grids: [
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
    ]},
    // 2: T  – purple
    { color: '#cc33ff', dark: '#5a1177', grids: [
      [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]],
      [[0,1,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]],
    ]},
    // 3: S  – green
    { color: '#33ff99', dark: '#0f6640', grids: [
      [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,0,0]],
      [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,0,0]],
    ]},
    // 4: Z  – red
    { color: '#ff3366', dark: '#780021', grids: [
      [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
      [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
    ]},
    // 5: J  – blue
    { color: '#3399ff', dark: '#0d3f77', grids: [
      [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,1,0],[0,0,1,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[1,1,0,0],[0,0,0,0]],
    ]},
    // 6: L  – orange
    { color: '#ff9900', dark: '#7a3d00', grids: [
      [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,1,0],[1,0,0,0],[0,0,0,0]],
      [[1,1,0,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
    ]},
  ];

  // ══════════════════════════════════════════════════════════════════════
  //  CANVAS + DOM REFS
  // ══════════════════════════════════════════════════════════════════════
  const canvas = document.getElementById('game-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = CW;
  canvas.height = CH;

  const elScore      = document.getElementById('score');
  const elHigh       = document.getElementById('high-score');
  const elFinalScore = document.getElementById('final-score');
  const elFinalHigh  = document.getElementById('final-high');
  const elFinalLines = document.getElementById('final-lines');
  const elFinalTime  = document.getElementById('final-time');
  const overlayStart = document.getElementById('overlay-start');
  const overlayPause = document.getElementById('overlay-pause');
  const overlayOver  = document.getElementById('overlay-over');

  // ══════════════════════════════════════════════════════════════════════
  //  GAME STATE
  // ══════════════════════════════════════════════════════════════════════
  let board;         // ROWS × COLS — cell = piece type (0-6) or -1 (empty)
  let curPiece;      // { type, rot, row, col }
  let nextType;      // upcoming piece type
  let holdType;      // held piece type, or -1
  let holdUsed;      // can only hold once per spawned piece

  let score, highScore, linesCleared;
  let gameElapsed;
  let running, paused;
  let rafId, lastTs;
  let dropTimer;     // ms accumulator for auto-drop
  let lockTimer;     // ms countdown before piece locks; -1 = not active
  let flashRows;     // array of full row indices being animated, or null
  let flashTimer;    // countdown ms for flash animation
  const particles = [];

  // 7-bag randomiser
  const bag = [];

  function refillBag() {
    const tmp = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 6; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [tmp[i], tmp[j]] = [tmp[j], tmp[i]];
    }
    bag.push(...tmp);
  }

  function nextFromBag() {
    if (bag.length < 4) refillBag();
    return bag.shift();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PIECE HELPERS
  // ══════════════════════════════════════════════════════════════════════
  function getCells(type, rot) {
    const g = PIECE_DATA[type].grids[rot];
    const out = [];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++)
        if (g[r][c]) out.push([r, c]);
    return out;
  }

  function pieceCells(p) {
    return getCells(p.type, p.rot).map(([dr, dc]) => [p.row + dr, p.col + dc]);
  }

  function isValid(p) {
    for (const [r, c] of pieceCells(p)) {
      if (c < 0 || c >= COLS || r >= ROWS) return false;
      if (r >= 0 && board[r][c] !== -1) return false;
    }
    return true;
  }

  function calcGhost() {
    const g = { ...curPiece };
    while (isValid({ ...g, row: g.row + 1 })) g.row++;
    return g;
  }

  function isOnGround() {
    return !isValid({ ...curPiece, row: curPiece.row + 1 });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  GAME ACTIONS
  // ══════════════════════════════════════════════════════════════════════
  function spawnPiece(type) {
    const p = { type, rot: 0, row: -1, col: 3 };
    if (!isValid(p)) { doGameOver(); return false; }
    curPiece  = p;
    holdUsed  = false;
    lockTimer = -1;
    dropTimer = 0;
    return true;
  }

  function spawnNext() {
    const type = nextType;
    nextType = nextFromBag();
    return spawnPiece(type);
  }

  function tryMove(drow, dcol) {
    const p = { ...curPiece, row: curPiece.row + drow, col: curPiece.col + dcol };
    if (!isValid(p)) return false;
    curPiece = p;
    return true;
  }

  function tryRotate(dir) {
    const newRot = (curPiece.rot + dir + 4) % 4;
    for (const kick of [0, 1, -1, 2, -2]) {
      const p = { ...curPiece, rot: newRot, col: curPiece.col + kick };
      if (isValid(p)) { curPiece = p; return true; }
    }
    return false;
  }

  function hardDrop() {
    let dropped = 0;
    while (tryMove(1, 0)) dropped++;
    score += dropped * 2;
    GameAudio.beep({ frequency: 110, duration: 0.07, type: 'square', volume: 0.18 });
    lockTimer = 0;  // lock immediately on next tick
  }

  function doHold() {
    if (holdUsed) return;
    holdUsed = true;
    const prev = holdType;
    holdType = curPiece.type;
    if (prev === -1) {
      spawnNext();
    } else {
      spawnPiece(prev);
    }
    GameAudio.beep({ frequency: 300, duration: 0.05, type: 'square', volume: 0.12 });
  }

  function checkLockState() {
    if (isOnGround()) {
      lockTimer = LOCK_DELAY_MS;  // reset on every move while grounded
    } else {
      lockTimer = -1;
    }
  }

  function lockPiece() {
    for (const [r, c] of pieceCells(curPiece)) {
      if (r >= 0) board[r][c] = curPiece.type;
    }
    lockTimer = -1;
    GameAudio.beep({ frequency: 150, duration: 0.07, type: 'square', volume: 0.16 });

    const full = [];
    for (let r = 0; r < ROWS; r++) {
      if (board[r].every(v => v !== -1)) full.push(r);
    }

    if (full.length > 0) {
      flashRows  = full;
      flashTimer = FLASH_DUR_MS;
      if (full.length >= 4) { GameAudio.score(); }
      else                  { GameAudio.eat(); }
    } else {
      spawnNext();
    }
  }

  function resolveFlash() {
    const n     = flashRows.length;
    const level = Math.floor(linesCleared / 10) + 1;

    // Capture row contents for particles before removing
    const rowData = flashRows.map(r => board[r].slice());

    score        += [0, 100, 300, 500, 800][n] * level;
    linesCleared += n;

    // Remove full rows (descending order so indices stay valid)
    const sorted = [...flashRows].sort((a, b) => b - a);
    for (const r of sorted) board.splice(r, 1);
    for (let i = 0; i < n; i++) board.unshift(new Array(COLS).fill(-1));

    spawnLineParticles(flashRows, rowData);
    flashRows = null;
    updateHUD();
    spawnNext();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PARTICLES
  // ══════════════════════════════════════════════════════════════════════
  function spawnLineParticles(rows, rowData) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      for (let c = 0; c < COLS; c++) {
        const t     = rowData[i][c];
        const color = t >= 0 ? PIECE_DATA[t].color : '#ffffff';
        for (let k = 0; k < 3; k++) {
          const angle = Math.random() * Math.PI * 2;
          const spd   = 1.5 + Math.random() * 3;
          particles.push({
            x: c * CELL + CELL / 2, y: r * CELL + CELL / 2,
            vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 1.5,
            life: 1, decay: 0.025 + Math.random() * 0.03,
            radius: 1.5 + Math.random() * 2, color,
          });
        }
      }
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.12;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  INPUT
  // ══════════════════════════════════════════════════════════════════════
  let touchStart  = null;
  let touchMovedX = 0;

  canvas.addEventListener('pointerdown', e => {
    if (!running || paused) return;
    touchStart  = { x: e.clientX, y: e.clientY };
    touchMovedX = 0;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!running || paused || !touchStart || flashRows) return;
    const dx = e.clientX - touchStart.x;
    if (Math.abs(dx - touchMovedX) >= CELL) {
      const step = Math.sign(dx - touchMovedX);
      if (tryMove(0, step)) {
        touchMovedX += step * CELL;
        checkLockState();
        GameAudio.beep({ frequency: 220, duration: 0.03, type: 'square', volume: 0.07 });
      } else {
        touchMovedX = dx;  // stop re-triggering blocked direction
      }
    }
  });

  canvas.addEventListener('pointerup', e => {
    if (!running || paused || !touchStart) return;
    const dx   = e.clientX - touchStart.x;
    const dy   = e.clientY - touchStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (!flashRows) {
      if (dist < 12 && Math.abs(touchMovedX) < CELL) {
        // Tap = rotate clockwise
        tryRotate(1);
        checkLockState();
        GameAudio.beep({ frequency: 330, duration: 0.04, type: 'square', volume: 0.11 });
      } else if (dy > 50 && Math.abs(dx) < 60) {
        // Swipe down = hard drop
        hardDrop();
      }
    }
    touchStart  = null;
    touchMovedX = 0;
  });

  document.addEventListener('keydown', e => {
    if (!running) {
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); doStart(); }
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (paused) doResume(); else doPause();
      return;
    }
    if (paused || flashRows) return;

    switch (e.code) {
      case 'ArrowLeft':
        e.preventDefault();
        tryMove(0, -1); checkLockState();
        GameAudio.beep({ frequency: 220, duration: 0.03, type: 'square', volume: 0.07 });
        break;
      case 'ArrowRight':
        e.preventDefault();
        tryMove(0, 1); checkLockState();
        GameAudio.beep({ frequency: 220, duration: 0.03, type: 'square', volume: 0.07 });
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (tryMove(1, 0)) { score += 1; checkLockState(); updateHUD(); }
        break;
      case 'ArrowUp':
      case 'KeyZ':
        e.preventDefault();
        tryRotate(1); checkLockState();
        GameAudio.beep({ frequency: 330, duration: 0.04, type: 'square', volume: 0.11 });
        break;
      case 'KeyX':
        e.preventDefault();
        tryRotate(-1); checkLockState();
        GameAudio.beep({ frequency: 330, duration: 0.04, type: 'square', volume: 0.11 });
        break;
      case 'Space':
        e.preventDefault();
        hardDrop();
        break;
      case 'KeyC':
      case 'ShiftLeft':
      case 'ShiftRight':
        e.preventDefault();
        doHold();
        break;
    }
  });

  document.getElementById('btn-start').addEventListener('click', doStart);
  document.getElementById('btn-restart').addEventListener('click', doStart);
  document.getElementById('btn-resume').addEventListener('click', doResume);
  document.getElementById('btn-pause').addEventListener('click', () => {
    if (paused) doResume(); else doPause();
  });
  document.getElementById('btn-mute').addEventListener('click', () => {
    GameAudio.setMuted(!GameAudio.isMuted());
    document.getElementById('btn-mute').textContent = GameAudio.isMuted() ? '🔇' : '🔊';
  });
  overlayStart.addEventListener('click', e => { if (e.target === overlayStart) doStart(); });
  overlayPause.addEventListener('click', e => { if (e.target === overlayPause) doResume(); });
  overlayOver.addEventListener('click',  e => { if (e.target === overlayOver)  doStart(); });

  // ══════════════════════════════════════════════════════════════════════
  //  HUD
  // ══════════════════════════════════════════════════════════════════════
  function formatSurvived(secs) {
    const s = Math.floor(secs);
    return s < 60 ? s + 's' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHUD() {
    elScore.textContent = score;
    elHigh.textContent  = highScore;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  GAME CONTROL
  // ══════════════════════════════════════════════════════════════════════
  function doStart() {
    if (!TowerLife.Credits.consume(doStart)) return;
    score        = 0;
    linesCleared = 0;
    gameElapsed  = 0;
    dropTimer    = 0;
    lockTimer    = -1;
    flashRows    = null;
    holdType     = -1;
    holdUsed     = false;
    particles.length = 0;
    bag.length = 0;

    highScore = Save.load('blockazoid_hi', 0);
    board = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));

    nextType = nextFromBag();
    spawnNext();

    updateHUD();

    overlayStart.classList.add('hidden');
    overlayPause.classList.add('hidden');
    overlayOver.classList.add('hidden');
    document.getElementById('btn-pause').disabled = false;

    running = true;
    paused  = false;
    lastTs  = performance.now();
    rafId   = requestAnimationFrame(loop);
  }

  function doPause() {
    if (!running || paused) return;
    paused = true;
    overlayPause.classList.remove('hidden');
  }

  function doResume() {
    if (!running || !paused) return;
    paused = false;
    overlayPause.classList.add('hidden');
    lastTs = performance.now();
  }

  function doGameOver() {
    running = false;
    cancelAnimationFrame(rafId);

    if (score > highScore) { highScore = score; Save.save('blockazoid_hi', highScore); }

    if (score >= 1000)        Achievements.unlock('bz_1k',   '1 000 Points');
    if (score >= 5000)        Achievements.unlock('bz_5k',   '5 000 Points');
    if (score >= 10000)       Achievements.unlock('bz_10k',  '10 000 Points');
    if (linesCleared >= 20)   Achievements.unlock('bz_20l',  '20 Lines Cleared');
    if (linesCleared >= 50)   Achievements.unlock('bz_50l',  '50 Lines Cleared');
    if (gameElapsed >= 120)   Achievements.unlock('bz_2min', '2 Minute Survivor');

    elFinalScore.textContent = score;
    elFinalHigh.textContent  = highScore;
    elFinalLines.textContent = linesCleared;
    elFinalTime.textContent  = formatSurvived(gameElapsed);

    overlayOver.classList.remove('hidden');
    document.getElementById('btn-pause').disabled = true;
    GameAudio.die();
    TowerLife.onGameOver(score, { highScore, linesCleared });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  GAME LOOP
  // ══════════════════════════════════════════════════════════════════════
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(ts - lastTs, 100);
    lastTs = ts;

    if (!paused) {
      gameElapsed += dt / 1000;

      if (flashRows) {
        flashTimer -= dt;
        if (flashTimer <= 0) resolveFlash();
      } else {
        // Auto-drop
        const dropInterval = Math.max(
          DROP_MS_MIN,
          DROP_MS_START * Math.pow(0.5, gameElapsed / DROP_HALF_SECS)
        );
        dropTimer += dt;
        if (dropTimer >= dropInterval) {
          dropTimer -= dropInterval;
          if (!tryMove(1, 0) && lockTimer < 0) {
            lockTimer = LOCK_DELAY_MS;
          }
        }

        // Lock delay countdown
        if (lockTimer >= 0) {
          lockTimer -= dt;
          if (lockTimer <= 0) lockPiece();
        }
      }

      updateParticles();
      updateHUD();
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  RENDERING
  // ══════════════════════════════════════════════════════════════════════
  function draw() {
    // Full background
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, CW, CH);

    // Board background
    ctx.fillStyle = '#0c0c1e';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    // Grid lines
    ctx.strokeStyle = '#13132b';
    ctx.lineWidth   = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(BOARD_W, r * CELL); ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, BOARD_H); ctx.stroke();
    }

    // Ghost piece
    if (!flashRows && curPiece) {
      const ghost = calcGhost();
      ctx.globalAlpha = 0.14;
      for (const [r, c] of pieceCells(ghost)) {
        if (r >= 0) drawCell(r, c, curPiece.type);
      }
      ctx.globalAlpha = 1;
    }

    // Board contents + flash animation
    const flashSet = flashRows ? new Set(flashRows) : null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = board[r][c];
        if (t === -1) continue;

        if (flashSet && flashSet.has(r)) {
          const phase = 1 - flashTimer / FLASH_DUR_MS;
          if (Math.floor(phase * 7) % 2 === 0) {
            ctx.fillStyle   = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur  = 14;
            ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
            ctx.shadowBlur = 0;
          } else {
            drawCell(r, c, t);
          }
        } else {
          drawCell(r, c, t);
        }
      }
    }

    // Current falling piece (blink near lock)
    if (!flashRows && curPiece) {
      const blink = (lockTimer >= 0 && lockTimer < 300)
        ? 0.55 + 0.45 * Math.sin(Date.now() / 50)
        : 1;
      ctx.globalAlpha = blink;
      for (const [r, c] of pieceCells(curPiece)) {
        if (r >= 0) drawCell(r, c, curPiece.type);
      }
      ctx.globalAlpha = 1;
    }

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    drawPanel();
  }

  function drawCell(r, c, type) {
    const color = PIECE_DATA[type].color;
    const dark  = PIECE_DATA[type].dark;
    const x = c * CELL + 1;
    const y = r * CELL + 1;
    const s = CELL - 2;

    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 5;
    ctx.fillRect(x, y, s, s);
    ctx.shadowBlur = 0;

    // Top + left bevel highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, s, 3);
    ctx.fillRect(x, y, 3, s);

    // Bottom + right bevel shadow
    ctx.fillStyle = dark;
    ctx.fillRect(x,         y + s - 3, s, 3);
    ctx.fillRect(x + s - 3, y,         3, s);
  }

  function drawPreviewPiece(type, cx, cy, cellSz, alpha) {
    const cells = getCells(type, 0);
    const minR  = Math.min(...cells.map(([r]) => r));
    const maxR  = Math.max(...cells.map(([r]) => r));
    const minC  = Math.min(...cells.map(([, c]) => c));
    const maxC  = Math.max(...cells.map(([, c]) => c));
    const ox    = cx - ((maxC - minC + 1) * cellSz) / 2;
    const oy    = cy - ((maxR - minR + 1) * cellSz) / 2;
    const color = PIECE_DATA[type].color;

    ctx.globalAlpha = alpha;
    for (const [dr, dc] of cells) {
      const px = ox + (dc - minC) * cellSz;
      const py = oy + (dr - minR) * cellSz;
      ctx.fillStyle   = color;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 4;
      ctx.fillRect(px, py, cellSz - 1, cellSz - 1);
      ctx.shadowBlur = 0;
      ctx.fillStyle  = 'rgba(255,255,255,0.22)';
      ctx.fillRect(px + 1, py + 1, (cellSz - 2) * 0.45, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawPanel() {
    const px  = BOARD_W + GAP;
    const mid = px + PAN_W / 2;

    // Panel background + left border
    ctx.fillStyle   = '#0c0c1e';
    ctx.fillRect(px, 0, PAN_W, CH);
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, CH); ctx.stroke();

    ctx.textAlign = 'center';

    // ── NEXT ──────────────────────────────────────────────────
    ctx.fillStyle = '#2a2a50';
    ctx.font      = '9px "Courier New"';
    ctx.fillText('NEXT', mid, 16);

    if (nextType !== undefined) {
      drawPreviewPiece(nextType, mid, 52, 13, 1);
    }

    // ── HOLD ──────────────────────────────────────────────────
    ctx.fillStyle = '#2a2a50';
    ctx.font      = '9px "Courier New"';
    ctx.fillText('HOLD', mid, 102);

    if (holdType >= 0) {
      drawPreviewPiece(holdType, mid, 138, 13, holdUsed ? 0.32 : 1);
    } else {
      ctx.strokeStyle = '#1a1a38';
      ctx.lineWidth   = 1;
      ctx.strokeRect(px + 6, 110, PAN_W - 12, 48);
    }

    // ── Separator ─────────────────────────────────────────────
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(px + 6, 175); ctx.lineTo(px + PAN_W - 6, 175);
    ctx.stroke();

    // ── LINES ─────────────────────────────────────────────────
    ctx.fillStyle = '#2a2a50';
    ctx.font      = '9px "Courier New"';
    ctx.fillText('LINES', mid, 196);

    ctx.fillStyle = '#33ff99';
    ctx.font      = 'bold 18px "Courier New"';
    ctx.fillText(linesCleared, mid, 218);

    // ── LEVEL ─────────────────────────────────────────────────
    ctx.fillStyle = '#2a2a50';
    ctx.font      = '9px "Courier New"';
    ctx.fillText('LEVEL', mid, 248);

    ctx.fillStyle = '#cc33ff';
    ctx.font      = 'bold 18px "Courier New"';
    ctx.fillText(Math.floor(linesCleared / 10) + 1, mid, 270);

    ctx.textAlign = 'left';  // reset
  }

})();
