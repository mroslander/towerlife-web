/**
 * area51.js — "Area 51%" — Stix/Qix-clone
 *
 * Move along the border and claim territory by drawing lines through empty
 * space. Bouncing enemy balls patrol the unclaimed area — if they hit your
 * trail you lose a life. Claim the target % to advance levels.
 *
 * Depends on (loaded via <script> tags in index.html):
 *   save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────
  const CELL = 6;              // px per grid cell
  const COLS = 60;             // grid columns
  const ROWS = 60;             // grid rows
  const CW   = COLS * CELL;   // canvas width  = 360
  const CH   = ROWS * CELL;   // canvas height = 360

  const PLAYER_SPEED     = 22; // cells per second (movement rate)
  const PLAYER_LIVES     = 3;
  const INVUL_DURATION   = 2.0; // seconds of invulnerability after dying

  // Level scaling
  const LEVEL_TARGET_BASE = 75; // % to fill on level 1
  const LEVEL_TARGET_INC  = 2;  // extra % per level (capped at 90)
  const LEVEL_BALL_BASE   = 2;  // balls on level 1
  const LEVEL_BALL_INC    = 1;  // extra ball per level (capped at 6)
  const BALL_SPEED_BASE   = 65; // px/s on level 1
  const BALL_SPEED_INC    = 14; // px/s added per level
  const BALL_RADIUS       = 5;  // px

  // Scoring
  const PTS_PER_CELL    = 10;  // points per newly filled cell
  const PTS_LEVEL_BONUS = 500; // bonus for completing a level

  // Cell states
  const EMPTY  = 0;
  const BORDER = 1; // permanent boundary (outer edge + completed trails)
  const FILLED = 2; // claimed interior
  const TRAIL  = 3; // player's current in-progress path

  // ── State ──────────────────────────────────────────────────────
  let canvas, ctx;
  let grid;          // Uint8Array(COLS * ROWS)
  let player;        // { gx, gy, drawing }
  let balls;         // [{ x, y, vx, vy }]
  let holdDir;       // { dx, dy } | null — currently held direction
  let state;         // 'start' | 'playing' | 'paused' | 'over'
  let score, highScore, lives, level;
  let filledCells, totalInner, levelTarget;
  let playerMoveAcc; // time accumulator for discrete cell movement
  let invulTimer;    // seconds of remaining invulnerability
  let lastTime, animId;
  let levelUpPending; // true while waiting for level-up transition

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    canvas.width  = CW;
    canvas.height = CH;

    highScore = Save.load('area51_high', 0);
    UI.setScore('high-score', highScore);

    // Render a preview of the empty field on the start screen
    grid  = new Uint8Array(COLS * ROWS);
    balls = [];
    initBorder();
    render();

    bindKeyboard();
    bindJoystick();
    bindButtons();
    TowerLife.onMessage(handleUnityMessage);

    enterState('start');
    TowerLife.onGameReady('area51');

    // Expose method for Unity to call directly
    window.setJoystickInput = applyJoystickInput;
  }

  // ── Grid init ──────────────────────────────────────────────────
  function initBorder() {
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const onEdge = gx === 0 || gx === COLS - 1 || gy === 0 || gy === ROWS - 1;
        grid[gy * COLS + gx] = onEdge ? BORDER : EMPTY;
      }
    }
    totalInner   = (COLS - 2) * (ROWS - 2);
    filledCells  = 0;
  }

  function setupLevel() {
    initBorder();
    levelTarget = Math.min(LEVEL_TARGET_BASE + (level - 1) * LEVEL_TARGET_INC, 90);

    // Player starts at top border, centred
    player = { gx: Math.floor(COLS / 2), gy: 0, drawing: false };
    playerMoveAcc = 0;
    invulTimer    = 0;
    holdDir       = null;
    levelUpPending = false;

    const numBalls = Math.min(LEVEL_BALL_BASE + (level - 1) * LEVEL_BALL_INC, 6);
    const speed    = BALL_SPEED_BASE + (level - 1) * BALL_SPEED_INC;
    const margin   = CELL * 10;
    balls = [];
    for (let i = 0; i < numBalls; i++) {
      const angle = (Math.PI * 2 * i / numBalls) + Math.random() * 0.4;
      balls.push({
        x:  margin + Math.random() * (CW - margin * 2),
        y:  margin + Math.random() * (CH - margin * 2),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      });
    }

    updateHUD();
  }

  // ── Lifecycle ─────────────────────────────────────────────────
  function startGame() {
    if (!TowerLife.Credits.consume(startGame)) return;
    score = 0;
    lives = PLAYER_LIVES;
    level = 1;
    UI.setScore('score', 0);
    setupLevel();
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(gameLoop);
    enterState('playing');
  }

  function loseLife() {
    if (invulTimer > 0) return;
    lives--;
    updateHUD();
    GameAudio.die();

    // Clear the current trail
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === TRAIL) grid[i] = EMPTY;
    }

    // Reset player to centre of top border
    player.gx      = Math.floor(COLS / 2);
    player.gy      = 0;
    player.drawing = false;
    holdDir        = null;
    playerMoveAcc  = 0;
    invulTimer     = INVUL_DURATION;

    if (lives <= 0) {
      endGame();
    }
  }

  function endGame() {
    cancelAnimationFrame(animId);
    animId = null;
    TowerLife.onGameOver(score, { highScore });
    UI.setScore('final-score', score);
    UI.setScore('final-high', highScore);
    enterState('over');
    render();
  }

  function advanceLevel() {
    score += PTS_LEVEL_BONUS;
    level++;
    UI.setScore('score', score);
    TowerLife.sendScore(score);
    GameAudio.score();
    setupLevel();
    lastTime = null;
    animId = requestAnimationFrame(gameLoop);
  }

  // ── Game loop ──────────────────────────────────────────────────
  function gameLoop(ts) {
    if (state !== 'playing') return;
    if (!lastTime) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05); // cap at 50 ms
    lastTime = ts;

    update(dt);
    render();
    animId = requestAnimationFrame(gameLoop);
  }

  function update(dt) {
    if (invulTimer > 0) invulTimer = Math.max(0, invulTimer - dt);
    if (!levelUpPending) {
      movePlayer(dt);
      moveBalls(dt);
      if (invulTimer === 0) checkCollisions();
    }
  }

  // ── Player movement ────────────────────────────────────────────
  function movePlayer(dt) {
    if (!holdDir) { playerMoveAcc = 0; return; }

    playerMoveAcc += dt;
    const step = 1 / PLAYER_SPEED;

    while (playerMoveAcc >= step) {
      playerMoveAcc -= step;
      stepPlayer(holdDir.dx, holdDir.dy);
    }
  }

  function stepPlayer(dx, dy) {
    const nx = player.gx + dx;
    const ny = player.gy + dy;
    if (!inGrid(nx, ny)) return;

    const cell = getCell(nx, ny);

    // Stepping into own trail = instant death
    if (cell === TRAIL) {
      loseLife();
      return;
    }

    player.gx = nx;
    player.gy = ny;

    if (isSolid(nx, ny)) {
      // Arrived back on solid ground — close the shape if we were drawing
      if (player.drawing) {
        completeFill();
        player.drawing = false;
      }
    } else {
      // Moving into empty space — leave trail
      setCell(nx, ny, TRAIL);
      player.drawing = true;
    }
  }

  // ── Fill algorithm ─────────────────────────────────────────────
  function completeFill() {
    // 1. Convert TRAIL → BORDER
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === TRAIL) grid[i] = BORDER;
    }

    // 2. BFS from each ball's grid cell through EMPTY cells → mark "outside"
    const outside = new Uint8Array(COLS * ROWS);
    const queue   = [];

    for (const ball of balls) {
      const bgx = Math.floor(ball.x / CELL);
      const bgy = Math.floor(ball.y / CELL);
      const bi  = bgy * COLS + bgx;
      if (inGrid(bgx, bgy) && grid[bi] === EMPTY && !outside[bi]) {
        outside[bi] = 1;
        queue.push(bi);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const ci = queue[head++];
      const gx = ci % COLS;
      const gy = (ci / COLS) | 0;
      if (gx > 0)       { const ni = ci - 1;    if (grid[ni] === EMPTY && !outside[ni]) { outside[ni] = 1; queue.push(ni); } }
      if (gx < COLS-1)  { const ni = ci + 1;    if (grid[ni] === EMPTY && !outside[ni]) { outside[ni] = 1; queue.push(ni); } }
      if (gy > 0)       { const ni = ci - COLS; if (grid[ni] === EMPTY && !outside[ni]) { outside[ni] = 1; queue.push(ni); } }
      if (gy < ROWS-1)  { const ni = ci + COLS; if (grid[ni] === EMPTY && !outside[ni]) { outside[ni] = 1; queue.push(ni); } }
    }

    // 3. Fill all EMPTY cells not reachable from any ball
    let claimed = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === EMPTY && !outside[i]) {
        grid[i] = FILLED;
        claimed++;
      }
    }

    // 4. Recount total filled cells
    filledCells = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === FILLED) filledCells++;
    }

    // 5. Relocate balls that ended up inside solid cells
    for (const ball of balls) {
      const bgx = Math.floor(ball.x / CELL);
      const bgy = Math.floor(ball.y / CELL);
      if (!inGrid(bgx, bgy) || getCell(bgx, bgy) !== EMPTY) {
        relocateBall(ball);
      }
    }

    // 6. Award points
    if (claimed > 0) {
      const pts = claimed * PTS_PER_CELL;
      score += pts;
      UI.setScore('score', score);
      TowerLife.sendScore(score);
      GameAudio.eat();

      if (score > highScore) {
        highScore = score;
        Save.save('area51_high', highScore);
        UI.setScore('high-score', highScore);
      }
    }

    updateHUD();
    checkAchievements();

    // 7. Level complete?
    const pct = (filledCells / totalInner) * 100;
    if (pct >= levelTarget && !levelUpPending) {
      levelUpPending = true;
      cancelAnimationFrame(animId);
      animId = null;

      const banner = document.getElementById('level-banner');
      if (banner) {
        banner.textContent = `LEVEL ${level + 1}!`;
        banner.classList.remove('show');
        void banner.offsetWidth; // reflow to restart animation
        banner.classList.add('show');
      }

      setTimeout(() => {
        advanceLevel();
        enterState('playing');
      }, 1400);
    }
  }

  function relocateBall(ball) {
    // Pick a random EMPTY inner cell
    const empties = [];
    for (let gy = 1; gy < ROWS - 1; gy++) {
      for (let gx = 1; gx < COLS - 1; gx++) {
        if (getCell(gx, gy) === EMPTY) empties.push({ gx, gy });
      }
    }
    if (empties.length > 0) {
      const c  = empties[Math.floor(Math.random() * empties.length)];
      ball.x   = c.gx * CELL + CELL / 2;
      ball.y   = c.gy * CELL + CELL / 2;
    }
  }

  // ── Ball movement ──────────────────────────────────────────────
  function moveBalls(dt) {
    for (const ball of balls) {
      // X axis
      const nx = ball.x + ball.vx * dt;
      if (!ballBlocked(nx, ball.y)) {
        ball.x = nx;
      } else {
        ball.vx = -ball.vx;
        const nx2 = ball.x + ball.vx * dt;
        if (!ballBlocked(nx2, ball.y)) ball.x = nx2;
      }

      // Y axis
      const ny = ball.y + ball.vy * dt;
      if (!ballBlocked(ball.x, ny)) {
        ball.y = ny;
      } else {
        ball.vy = -ball.vy;
        const ny2 = ball.y + ball.vy * dt;
        if (!ballBlocked(ball.x, ny2)) ball.y = ny2;
      }
    }
  }

  function ballBlocked(bx, by) {
    const r = BALL_RADIUS - 0.5;
    const testPoints = [
      [bx - r, by],
      [bx + r, by],
      [bx,     by - r],
      [bx,     by + r],
    ];
    for (const [tx, ty] of testPoints) {
      const gx = Math.floor(tx / CELL);
      const gy = Math.floor(ty / CELL);
      if (!inGrid(gx, gy) || isSolid(gx, gy)) return true;
    }
    return false;
  }

  // ── Collision: ball vs trail & player ──────────────────────────
  function checkCollisions() {
    for (const ball of balls) {
      // Check nearby grid cells for TRAIL
      const r   = BALL_RADIUS + CELL * 0.6;
      const gx0 = Math.max(0, Math.floor((ball.x - r) / CELL));
      const gx1 = Math.min(COLS - 1, Math.floor((ball.x + r) / CELL));
      const gy0 = Math.max(0, Math.floor((ball.y - r) / CELL));
      const gy1 = Math.min(ROWS - 1, Math.floor((ball.y + r) / CELL));

      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          if (getCell(gx, gy) !== TRAIL) continue;
          const cx = gx * CELL + CELL / 2;
          const cy = gy * CELL + CELL / 2;
          if (Math.hypot(ball.x - cx, ball.y - cy) < BALL_RADIUS + CELL * 0.55) {
            loseLife();
            return;
          }
        }
      }

      // Ball vs player position
      const plCX = player.gx * CELL + CELL / 2;
      const plCY = player.gy * CELL + CELL / 2;
      if (Math.hypot(ball.x - plCX, ball.y - plCY) < BALL_RADIUS + CELL * 0.6) {
        loseLife();
        return;
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────
  function render() {
    ctx.clearRect(0, 0, CW, CH);

    // Black background (EMPTY cells stay black)
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CW, CH);

    // Draw non-empty cells
    for (let i = 0; i < grid.length; i++) {
      const cell = grid[i];
      if (cell === EMPTY) continue;
      const gx = i % COLS;
      const gy = (i / COLS) | 0;
      const x  = gx * CELL;
      const y  = gy * CELL;

      if (cell === BORDER) {
        ctx.fillStyle = '#00ddcc';
        ctx.fillRect(x, y, CELL, CELL);
      } else if (cell === FILLED) {
        // Darker teal fill with a subtle lighter inner square
        ctx.fillStyle = '#003344';
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillStyle = '#005566';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      } else if (cell === TRAIL) {
        ctx.fillStyle = '#ffee00';
        ctx.fillRect(x, y, CELL, CELL);
      }
    }

    // Subtle dot grid overlay on EMPTY area
    ctx.fillStyle = '#151515';
    for (let gy = 1; gy < ROWS - 1; gy++) {
      for (let gx = 1; gx < COLS - 1; gx++) {
        if (getCell(gx, gy) === EMPTY) {
          ctx.fillRect(gx * CELL + CELL / 2 - 0.5, gy * CELL + CELL / 2 - 0.5, 1, 1);
        }
      }
    }

    // Draw balls
    for (const ball of balls) {
      ctx.save();
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur  = 14;
      ctx.fillStyle   = '#ff3333';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      // Specular highlight
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = 'rgba(255,180,180,0.6)';
      ctx.beginPath();
      ctx.arc(ball.x - 1.5, ball.y - 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw player (flashes during invulnerability)
    if (player) {
      const flash = invulTimer > 0 && Math.floor(invulTimer * 9) % 2 === 0;
      if (!flash) {
        const px = player.gx * CELL + CELL / 2;
        const py = player.gy * CELL + CELL / 2;
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur  = 12;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, CELL / 2 + 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = '#00aaff';
      ctx.beginPath();
      ctx.arc(px, py, CELL / 2 - 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      }
    }
  }

  // ── HUD ────────────────────────────────────────────────────────
  function updateHUD() {
    const pct = totalInner > 0 ? Math.floor((filledCells / totalInner) * 100) : 0;
    UI.setScore('score', score);

    const livesEl = document.getElementById('lives-val');
    if (livesEl) {
      livesEl.textContent =
        '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, PLAYER_LIVES - lives));
    }
    const pctEl = document.getElementById('pct-val');
    if (pctEl) pctEl.textContent = `${pct}%`;

    const targetEl = document.getElementById('target-val');
    if (targetEl) targetEl.textContent = `${levelTarget}%`;

    const lvlEl = document.getElementById('level-val');
    if (lvlEl) lvlEl.textContent = level;
  }

  // ── Achievements ───────────────────────────────────────────────
  function checkAchievements() {
    const pct = totalInner > 0 ? (filledCells / totalInner) * 100 : 0;
    if (pct >= 50) Achievements.unlock('a51_50pct',  '50% Claimed!');
    if (pct >= 75) Achievements.unlock('a51_75pct',  '75% Claimed!');
    if (pct >= 90) Achievements.unlock('a51_90pct',  '90% Claimed!');
    if (score  >= 1000) Achievements.unlock('a51_1k',   '1000 Points!');
    if (score  >= 5000) Achievements.unlock('a51_5k',   '5000 Points!');
    if (level  >= 3)    Achievements.unlock('a51_lvl3', 'Level 3!');
    if (level  >= 5)    Achievements.unlock('a51_lvl5', 'Level 5!');
  }

  // ── Grid helpers ───────────────────────────────────────────────
  function getCell(gx, gy)    { return grid[gy * COLS + gx]; }
  function setCell(gx, gy, v) { grid[gy * COLS + gx] = v; }
  function inGrid(gx, gy)     { return gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS; }
  function isSolid(gx, gy)    { const c = getCell(gx, gy); return c === BORDER || c === FILLED; }

  // ── Keyboard input ─────────────────────────────────────────────
  const KEY_DIR = {
    ArrowUp:    { dx:  0, dy: -1 },
    ArrowDown:  { dx:  0, dy:  1 },
    ArrowLeft:  { dx: -1, dy:  0 },
    ArrowRight: { dx:  1, dy:  0 },
    w: { dx:  0, dy: -1 },
    s: { dx:  0, dy:  1 },
    a: { dx: -1, dy:  0 },
    d: { dx:  1, dy:  0 },
  };

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const d = KEY_DIR[e.key];
      if (d) {
        e.preventDefault();
        holdDir = d;
        if (state === 'start' || state === 'over') startGame();
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

    document.addEventListener('keyup', (e) => {
      const d = KEY_DIR[e.key];
      if (d && holdDir && holdDir.dx === d.dx && holdDir.dy === d.dy) {
        holdDir = null;
      }
    });
  }

  // ── Virtual joystick ───────────────────────────────────────────
  function bindJoystick() {
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    if (!base || !knob) return;

    const MAX_R   = 30;   // max knob displacement from centre (px)
    const DEAD_R  = 10;   // dead zone radius (px)
    let active    = false;
    let originX   = 0;
    let originY   = 0;

    function pointerStart(clientX, clientY) {
      const rect = base.getBoundingClientRect();
      originX = rect.left + rect.width  / 2;
      originY = rect.top  + rect.height / 2;
      active  = true;
      pointerMove(clientX, clientY);
      if (state === 'start' || state === 'over') startGame();
    }

    function pointerMove(clientX, clientY) {
      if (!active) return;
      const dx   = clientX - originX;
      const dy   = clientY - originY;
      const dist = Math.hypot(dx, dy);

      // Clamp knob visual position
      const clamp = Math.min(dist, MAX_R) / Math.max(dist, 1);
      knob.style.transform =
        `translate(calc(-50% + ${dx * clamp}px), calc(-50% + ${dy * clamp}px))`;

      // Update held direction
      if (dist < DEAD_R) {
        holdDir = null;
        return;
      }
      const ax = Math.abs(dx), ay = Math.abs(dy);
      holdDir = ax > ay
        ? (dx > 0 ? { dx: 1, dy: 0 } : { dx: -1, dy:  0 })
        : (dy > 0 ? { dx: 0, dy: 1 } : { dx:  0, dy: -1 });
    }

    function pointerEnd() {
      if (!active) return;
      active  = false;
      holdDir = null;
      knob.style.transform = 'translate(-50%, -50%)';
    }

    // Touch events
    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      pointerStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    base.addEventListener('touchmove', (e) => {
      e.preventDefault();
      pointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    base.addEventListener('touchend',   (e) => { e.preventDefault(); pointerEnd(); }, { passive: false });
    base.addEventListener('touchcancel',(e) => { e.preventDefault(); pointerEnd(); }, { passive: false });

    // Mouse events (for desktop testing)
    base.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pointerStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (active) pointerMove(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', pointerEnd);
  }

  // Called by Unity's EvaluateJavaScript or the JOYSTICK message
  function applyJoystickInput(x, y) {
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ax < 0.3 && ay < 0.3) { holdDir = null; return; }
    holdDir = ax > ay
      ? (x > 0 ? { dx: 1, dy: 0 } : { dx: -1, dy:  0 })
      : (y > 0 ? { dx: 0, dy: 1 } : { dx:  0, dy: -1 });
  }

  // ── Buttons ────────────────────────────────────────────────────
  function bindButtons() {
    const map = {
      'btn-start':   () => startGame(),
      'btn-restart': () => startGame(),
      'btn-resume':  () => { if (state === 'paused')  togglePause(); },
      'btn-pause':   () => { if (state === 'playing') togglePause(); },
    };
    for (const [id, fn] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    }

    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
      btnMute.addEventListener('click', () => {
        const muted = !GameAudio.isMuted();
        GameAudio.setMuted(muted);
        btnMute.textContent = muted ? '🔇' : '🔊';
        btnMute.title       = muted ? 'Unmute' : 'Mute';
        btnMute.classList.toggle('muted', muted);
      });
    }
  }

  // ── Pause ──────────────────────────────────────────────────────
  function togglePause() {
    if (state === 'playing') {
      cancelAnimationFrame(animId);
      animId   = null;
      holdDir  = null;
      lastTime = null;
      enterState('paused');
    } else if (state === 'paused') {
      animId = requestAnimationFrame(gameLoop);
      enterState('playing');
    }
  }

  // ── Unity bridge ───────────────────────────────────────────────
  function handleUnityMessage(msg) {
    switch (msg.type) {
      case 'PAUSE':    if (state === 'playing') togglePause(); break;
      case 'RESUME':   if (state === 'paused')  togglePause(); break;
      case 'MUTE':     GameAudio.setMuted(msg.muted); break;
      case 'JOYSTICK':
        if (msg.x !== undefined) applyJoystickInput(msg.x, msg.y || 0);
        break;
    }
  }

  // ── State machine ──────────────────────────────────────────────
  function enterState(s) {
    state = s;
    UI.hideOverlay('overlay-start');
    UI.hideOverlay('overlay-pause');
    UI.hideOverlay('overlay-over');
    const pauseBtn = document.getElementById('btn-pause');
    if (s === 'start')  UI.showOverlay('overlay-start');
    if (s === 'paused') UI.showOverlay('overlay-pause');
    if (s === 'over')   UI.showOverlay('overlay-over');
    if (pauseBtn) pauseBtn.disabled = (s !== 'playing' && s !== 'paused');
  }

  // ── Bootstrap ──────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', init);
})();
