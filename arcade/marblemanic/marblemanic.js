/**
 * marblemanic.js — Bubble Shooter arcade game
 *
 * Shoot coloured marbles upward to match clusters of 3 or more.
 * A continuously burning timer keeps pressure on — it speeds up over time,
 * and every successful cluster pop buys back seconds.  New rows of marbles
 * are pushed in from the top at increasing frequency.
 *
 * Depends on (loaded via index.html):
 *   save.js · towerlife.js · audio.js · achievements.js · ui.js
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  DIFFICULTY CONSTANTS  — adjust these to tune the game
  // ══════════════════════════════════════════════════════════════════════
  const START_TIME      = 35;    // seconds at game start
  const MAX_TIME        = 55;    // timer cannot exceed this
  const BURN_INC        = 0.016; // burn-speed increase per elapsed real second
  const BUMP_PER_MARBLE = 0.40;  // seconds per marble in the matched cluster
  const BUMP_PER_FLOAT  = 0.20;  // seconds per falling floating marble
  const BUMP_MIN        = 1.50;  // minimum time bonus on any successful match
  const NEW_ROW_FIRST   = 22.0;  // seconds before the first new row appears
  const NEW_ROW_DECAY   = 0.80;  // row interval shrinks by this factor each time
  const NEW_ROW_MIN     = 7.0;   // floor on the row-addition interval
  const SLIDE_DUR       = 210;   // ms — next-marble slide-in animation duration

  // ══════════════════════════════════════════════════════════════════════
  //  GRID GEOMETRY
  // ══════════════════════════════════════════════════════════════════════
  const CANVAS_W  = 360;
  const CANVAS_H  = 500;
  // Hex offset grid: even rows have 9 bubbles, odd rows have 8 (shifted right by half)
  const COLS_EVEN = 9;    // columns in even rows (0, 2, 4 …)
  const COLS_ODD  = 8;    // columns in odd  rows (1, 3, 5 …)
  const BUBBLE_R  = 19;
  const COL_SPACE = 40;   // horizontal centre-to-centre spacing
  const ROW_SPACE = 35;   // vertical centre-to-centre (COL_SPACE * sin60° ≈ 34.6)
  const GRID_TOP  = 6;    // y of row-0 bubble centres (after gridOffsetY applied)
  const GRID_ROWS = 11;   // total row slots (rows 0 – 10)
  const INIT_ROWS = 4;    // rows prefilled with marbles at game start

  // ══════════════════════════════════════════════════════════════════════
  //  SHOOTER
  // ══════════════════════════════════════════════════════════════════════
  const SHOOT_SPEED = 13;          // px per frame (~60 fps)
  const SHOOTER_X   = CANVAS_W / 2;
  const SHOOTER_Y   = 455;
  const AIM_MARGIN  = 0.13;        // min radians from horizontal (prevents near-horizontal shots)

  // ══════════════════════════════════════════════════════════════════════
  //  SCORING
  // ══════════════════════════════════════════════════════════════════════
  const PTS_BASE        = 10;  // per marble in matched cluster
  const PTS_BONUS       = 15;  // per marble beyond the 3rd
  const PTS_FLOAT_BONUS = 8;   // per falling floating marble

  // ══════════════════════════════════════════════════════════════════════
  //  MARBLE COLOURS
  // ══════════════════════════════════════════════════════════════════════
  const MARBLE_TYPES = 4;
  const COLORS = [
    '#ff3366', // 0 – red
    '#3399ff', // 1 – blue
    '#33ff99', // 2 – green
    '#ffcc00', // 3 – yellow
    '#cc33ff', // 4 – purple
    '#ff9900', // 5 – orange
  ];

  // ── Canvas ────────────────────────────────────────────────────────────
  const canvas = document.getElementById('game-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  // ── DOM refs ──────────────────────────────────────────────────────────
  const elScore      = document.getElementById('score');
  const elHigh       = document.getElementById('high-score');
  const elTime       = document.getElementById('time-display');
  const elTimerBar   = document.getElementById('timer-bar');
  const elSpeed      = document.getElementById('speed-display');
  const elFinalScore = document.getElementById('final-score');
  const elFinalHigh  = document.getElementById('final-high');
  const elFinalTime  = document.getElementById('final-time');
  const overlayStart = document.getElementById('overlay-start');
  const overlayPause = document.getElementById('overlay-pause');
  const overlayOver  = document.getElementById('overlay-over');

  // ── Game state ────────────────────────────────────────────────────────
  let grid        = [];   // grid[r][c] = colour index (0-5) or -1 (empty)
  let gridOffsetY = 0;    // smooth slide-in animation for new rows (px)
  let score       = 0;
  let highScore   = 0;
  let timeLeft    = START_TIME;
  let burnSpeed   = 1.0;
  let gameElapsed = 0;
  let rowInterval = NEW_ROW_FIRST;  // current spacing between row additions
  let nextRowIn   = NEW_ROW_FIRST;  // countdown to next row addition (seconds)

  let running = false;
  let paused  = false;
  let rafId   = null;
  let lastTs  = 0;

  // Shooter / aim
  let shootColor = 0;
  let nextColor  = 0;
  let aimAngle   = -Math.PI / 2;  // straight up
  let aimActive  = false;

  // Projectile in flight
  let proj = null;  // { x, y, vx, vy, color }

  // Next-marble slide-in animation
  let slideMarble = null;  // { color, t }  t: 0→1

  // Animation state machine
  //   'idle'     – waiting for player to shoot
  //   'flying'   – marble in flight
  //   'popping'  – matched marbles exploding
  //   'floating' – disconnected marbles falling
  let animState  = 'idle';
  let popList    = [];   // [{r, c, color}]  – marbles mid-pop
  let popTimer   = 0;    // ms
  let floatList  = [];   // [{x, y, vy, color}]  – marbles falling off-screen
  let floatTimer = 0;    // ms
  const POP_DUR   = 300;
  const FLOAT_DUR = 360;

  let respawnPending = false;

  const particles = [];

  // ── Grid helpers ──────────────────────────────────────────────────────
  function colsInRow(r)   { return r % 2 === 0 ? COLS_EVEN : COLS_ODD; }
  // Even rows: centres at x = 20, 60, 100 … 340  (left-aligned, span = 360)
  // Odd rows:  centres at x = 40, 80, 120 … 320  (offset right by 20)
  function bubbleCX(r, c) { return r % 2 === 0 ? 20 + c * COL_SPACE : 40 + c * COL_SPACE; }
  function bubbleCY(r)    { return GRID_TOP + r * ROW_SPACE + gridOffsetY; }
  function rnd(n)         { return Math.floor(Math.random() * n); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ── Hex neighbours (6-connected offset grid) ─────────────────────────
  // Even rows shift left relative to odd rows.
  function neighbors(r, c) {
    const even = r % 2 === 0;
    return [
      [r,     c - 1],
      [r,     c + 1],
      even ? [r - 1, c - 1] : [r - 1, c],
      even ? [r - 1, c]     : [r - 1, c + 1],
      even ? [r + 1, c - 1] : [r + 1, c],
      even ? [r + 1, c]     : [r + 1, c + 1],
    ];
  }

  function validCell(r, c) {
    return r >= 0 && r < GRID_ROWS && c >= 0 && c < colsInRow(r);
  }

  // ── Cluster detection (flood fill, same colour) ───────────────────────
  function findCluster(r, c) {
    const color   = grid[r][c];
    if (color < 0) return [];
    const visited = new Set([r * 10 + c]);
    const stack   = [[r, c]];
    const result  = [];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      result.push({ r: cr, c: cc });
      for (const [nr, nc] of neighbors(cr, cc)) {
        const key = nr * 10 + nc;
        if (!visited.has(key) && validCell(nr, nc) && grid[nr][nc] === color) {
          visited.add(key);
          stack.push([nr, nc]);
        }
      }
    }
    return result;
  }

  // ── Floating bubble detection (not connected to row 0) ───────────────
  function findFloating() {
    const attached = new Set();
    const queue    = [];
    for (let c = 0; c < colsInRow(0); c++) {
      if (grid[0][c] !== -1) {
        attached.add(c);   // key = 0 * 10 + c = c
        queue.push([0, c]);
      }
    }
    while (queue.length) {
      const [r, c] = queue.shift();
      for (const [nr, nc] of neighbors(r, c)) {
        const key = nr * 10 + nc;
        if (!attached.has(key) && validCell(nr, nc) && grid[nr][nc] !== -1) {
          attached.add(key);
          queue.push([nr, nc]);
        }
      }
    }
    const floating = [];
    for (let r = 0; r < GRID_ROWS; r++)
      for (let c = 0; c < colsInRow(r); c++)
        if (grid[r][c] !== -1 && !attached.has(r * 10 + c))
          floating.push({ r, c });
    return floating;
  }

  // ── Snap projectile position to nearest valid empty grid cell ─────────
  function hasAdjacentBubble(r, c) {
    for (const [nr, nc] of neighbors(r, c))
      if (validCell(nr, nc) && grid[nr][nc] !== -1) return true;
    return false;
  }

  function snapToGrid(px, py) {
    const rawR = (py - GRID_TOP - gridOffsetY) / ROW_SPACE;
    const candidates = [];

    for (let dr = -1; dr <= 1; dr++) {
      const r    = clamp(Math.round(rawR + dr), 0, GRID_ROWS - 1);
      const cols = colsInRow(r);
      const xOff = r % 2 === 0 ? 20 : 40;
      const rawC = (px - xOff) / COL_SPACE;
      for (let dc = -2; dc <= 2; dc++) {
        const c = clamp(Math.round(rawC + dc), 0, cols - 1);
        if (grid[r][c] !== -1) continue;
        if (r > 0 && !hasAdjacentBubble(r, c)) continue;
        const cx = bubbleCX(r, c);
        const cy = bubbleCY(r);
        candidates.push({ r, c, dist: Math.hypot(cx - px, cy - py) });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0];
  }

  // ── Grid init ─────────────────────────────────────────────────────────
  function initGrid() {
    grid = Array.from({ length: GRID_ROWS }, (_, r) =>
      Array.from({ length: colsInRow(r) }, () => r < INIT_ROWS ? rnd(MARBLE_TYPES) : -1)
    );
    gridOffsetY = 0;
    rowInterval = NEW_ROW_FIRST;
    nextRowIn   = NEW_ROW_FIRST;
  }

  function hasAnyBubble() {
    for (let r = 0; r < GRID_ROWS; r++)
      for (let c = 0; c < colsInRow(r); c++)
        if (grid[r][c] !== -1) return true;
    return false;
  }

  function respawnGrid() {
    for (let r = 0; r < GRID_ROWS; r++)
      grid[r] = Array.from({ length: colsInRow(r) }, () => r < INIT_ROWS ? rnd(MARBLE_TYPES) : -1);
    respawnPending = false;
  }

  // ── Add new row from top (grid slides down) ───────────────────────────
  function addNewRow() {
    // Shift all data one row down; row GRID_ROWS-1 falls off.
    // Column counts alternate (9, 8, 9 …) so remap on each shift:
    //   even(9) → odd(8):  copy cols 0-7, drop col 8
    //   odd(8)  → even(9): copy cols 0-7, new col 8 = empty
    for (let r = GRID_ROWS - 1; r > 0; r--) {
      const prev   = grid[r - 1];
      const tCols  = colsInRow(r);
      const newRow = new Array(tCols).fill(-1);
      const copy   = Math.min(prev.length, tCols); // always 8
      for (let c = 0; c < copy; c++) newRow[c] = prev[c];
      grid[r] = newRow;
    }
    // New top row (always even = 9 cols); bias towards active colours
    const colorsPresent = getActiveColors();
    grid[0] = Array.from({ length: colsInRow(0) }, () =>
      Math.random() < 0.7 && colorsPresent.length >= 2
        ? colorsPresent[rnd(colorsPresent.length)]
        : rnd(MARBLE_TYPES)
    );
    // Animate: grid slides in from above
    gridOffsetY = -ROW_SPACE;
    // Tighten interval
    rowInterval = Math.max(NEW_ROW_MIN, rowInterval * NEW_ROW_DECAY);
    nextRowIn   = rowInterval;
  }

  function getActiveColors() {
    const seen = new Set();
    for (let r = 0; r < GRID_ROWS; r++)
      for (let c = 0; c < colsInRow(r); c++)
        if (grid[r][c] >= 0) seen.add(grid[r][c]);
    return Array.from(seen);
  }

  function getBottomFilledRow() {
    for (let r = GRID_ROWS - 1; r >= 0; r--)
      for (let c = 0; c < colsInRow(r); c++)
        if (grid[r][c] !== -1) return r;
    return -1;
  }

  // ── Aim line (up to one wall bounce) ─────────────────────────────────
  function computeAimLine(angle) {
    const pts  = [{ x: SHOOTER_X, y: SHOOTER_Y }];
    let x  = SHOOTER_X, y  = SHOOTER_Y;
    let vx = Math.cos(angle) * 4, vy = Math.sin(angle) * 4;
    let bounced = false;

    for (let i = 0; i < 700; i++) {
      x += vx; y += vy;

      if (x - BUBBLE_R < 0) {
        x = BUBBLE_R; vx = -vx;
        if (!bounced) { pts.push({ x, y }); bounced = true; }
      }
      if (x + BUBBLE_R > CANVAS_W) {
        x = CANVAS_W - BUBBLE_R; vx = -vx;
        if (!bounced) { pts.push({ x, y }); bounced = true; }
      }

      // Hit ceiling
      if (y - BUBBLE_R <= GRID_TOP + gridOffsetY) {
        pts.push({ x, y: GRID_TOP + gridOffsetY + BUBBLE_R });
        return pts;
      }

      // Hit grid bubble
      if (y < GRID_TOP + gridOffsetY + GRID_ROWS * ROW_SPACE + BUBBLE_R * 2) {
        const rawR = (y - GRID_TOP - gridOffsetY) / ROW_SPACE;
        for (let r = Math.max(0, Math.floor(rawR) - 1); r <= Math.min(GRID_ROWS - 1, Math.ceil(rawR) + 1); r++) {
          for (let c = 0; c < colsInRow(r); c++) {
            if (grid[r][c] < 0) continue;
            if (Math.hypot(x - bubbleCX(r, c), y - bubbleCY(r)) < BUBBLE_R * 2) {
              pts.push({ x, y });
              return pts;
            }
          }
        }
      }

      if (bounced && i > 350) { pts.push({ x, y }); break; }
    }
    return pts;
  }

  // ── Shoot ─────────────────────────────────────────────────────────────
  function shoot() {
    if (animState !== 'idle') return;

    // Snap any in-progress slide instantly so the cannon is correct
    if (slideMarble) slideMarble = null;

    proj = {
      x: SHOOTER_X, y: SHOOTER_Y,
      vx: Math.cos(aimAngle) * SHOOT_SPEED,
      vy: Math.sin(aimAngle) * SHOOT_SPEED,
      color: shootColor,
    };
    animState = 'flying';

    // Advance the marble queue immediately and animate the incoming marble
    slideMarble = { color: nextColor, t: 0 };
    loadNextMarble();  // shootColor = old nextColor (= slideMarble.color), nextColor = new random

    GameAudio.beep({ frequency: 520, duration: 0.05, type: 'square', volume: 0.14 });
  }

  // ── Update flying projectile ──────────────────────────────────────────
  function updateProjectile() {
    proj.x += proj.vx;
    proj.y += proj.vy;

    // Wall bounces
    if (proj.x - BUBBLE_R < 0) {
      proj.x  = BUBBLE_R; proj.vx = -proj.vx;
    }
    if (proj.x + BUBBLE_R > CANVAS_W) {
      proj.x  = CANVAS_W - BUBBLE_R; proj.vx = -proj.vx;
    }

    // Hit ceiling
    if (proj.y - BUBBLE_R <= GRID_TOP + gridOffsetY) {
      proj.y = GRID_TOP + gridOffsetY + BUBBLE_R;
      landProjectile();
      return;
    }

    // Collision with grid bubbles
    const rawR = (proj.y - GRID_TOP - gridOffsetY) / ROW_SPACE;
    const rMin = Math.max(0,             Math.floor(rawR) - 1);
    const rMax = Math.min(GRID_ROWS - 1, Math.ceil(rawR)  + 1);
    for (let r = rMin; r <= rMax; r++) {
      for (let c = 0; c < colsInRow(r); c++) {
        if (grid[r][c] < 0) continue;
        if (Math.hypot(proj.x - bubbleCX(r, c), proj.y - bubbleCY(r)) < BUBBLE_R * 1.92) {
          landProjectile();
          return;
        }
      }
    }
  }

  function landProjectile() {
    const { x: px, y: py, color } = proj;
    proj = null;
    const snap = snapToGrid(px, py);
    if (snap) {
      grid[snap.r][snap.c] = color;
      resolveMatches(snap.r, snap.c);
    } else {
      // No valid slot; queue was already advanced in shoot()
      animState = 'idle';
    }
  }

  // ── Resolve matches after landing ────────────────────────────────────
  function resolveMatches(r, c) {
    const cluster = findCluster(r, c);

    if (cluster.length >= 3) {
      // Capture colours before deletion
      const pops = cluster.map(({ r: pr, c: pc }) => ({
        r: pr, c: pc, color: grid[pr][pc],
      }));

      // Remove cluster from grid
      for (const { r: pr, c: pc } of cluster) grid[pr][pc] = -1;

      // Capture and remove floating bubbles
      const floatingPos = findFloating();
      const floats = floatingPos.map(({ r: fr, c: fc }) => ({
        x: bubbleCX(fr, fc),
        y: bubbleCY(fr),
        vy: -0.5,
        color: grid[fr][fc],
      }));
      for (const { r: fr, c: fc } of floatingPos) grid[fr][fc] = -1;

      // Score
      const n = cluster.length, f = floatingPos.length;
      const pts = Math.round(
        (n * PTS_BASE + Math.max(0, n - 3) * PTS_BONUS + f * PTS_FLOAT_BONUS)
        * (0.5 + burnSpeed * 0.5)
      );
      score += pts;

      // Timer bump
      const bump = Math.max(BUMP_MIN, n * BUMP_PER_MARBLE + f * BUMP_PER_FLOAT);
      timeLeft = Math.min(timeLeft + bump, MAX_TIME);

      // Start pop animation
      popList   = pops;
      popTimer  = POP_DUR;
      floatList = floats;
      animState = 'popping';

      updateHUD();
      spawnParticles(pops);
      GameAudio.eat();
      if (n + f >= 8) GameAudio.score();

      // Flag grid respawn if fully cleared
      if (!hasAnyBubble()) respawnPending = true;

    } else {
      // No match — queue already advanced in shoot()
      animState = 'idle';
    }
  }

  function loadNextMarble() {
    shootColor = nextColor;
    nextColor  = rnd(MARBLE_TYPES);
  }

  // ── New-row countdown ─────────────────────────────────────────────────
  function updateRowTimer(dtSec) {
    nextRowIn -= dtSec;
    if (nextRowIn <= 0) addNewRow();
  }

  // ── Particles ─────────────────────────────────────────────────────────
  function spawnParticles(pops) {
    for (const { r, c, color } of pops) {
      const cx  = bubbleCX(r, c);
      const cy  = bubbleCY(r);
      const col = COLORS[color];
      for (let i = 0; i < 7; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.8 + Math.random() * 3.2;
        particles.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: col,
          life: 1,
          decay: 0.033 + Math.random() * 0.028,
          r: 2 + Math.random() * 3,
        });
      }
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.13;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function updateAimFromPos(px, py) {
    const dy = py - SHOOTER_Y;
    const dx = px - SHOOTER_X;
    if (dy >= 0) return; // only allow upward shots
    let angle = Math.atan2(dy, dx);
    // Clamp to avoid nearly-horizontal shots
    angle = clamp(angle, -(Math.PI - AIM_MARGIN), -AIM_MARGIN);
    aimAngle = angle;
  }

  canvas.addEventListener('pointerdown', e => {
    if (!running || paused) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const pos = getCanvasPos(e);
    updateAimFromPos(pos.x, pos.y);
    aimActive = true;
  });

  canvas.addEventListener('pointermove', e => {
    if (!running || paused || !aimActive) return;
    e.preventDefault();
    updateAimFromPos(getCanvasPos(e).x, getCanvasPos(e).y);
  });

  canvas.addEventListener('pointerup', e => {
    if (!running || paused || !aimActive) return;
    e.preventDefault();
    aimActive = false;
    updateAimFromPos(getCanvasPos(e).x, getCanvasPos(e).y);
    shoot();
  });

  canvas.addEventListener('pointercancel', () => { aimActive = false; });

  document.addEventListener('keydown', e => {
    if (!running) {
      if (e.code === 'Enter' || e.code === 'Space') doStart();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      paused ? doResume() : doPause();
      return;
    }
    if (paused) return;
    if (e.code === 'ArrowLeft')  aimAngle = Math.max(-(Math.PI - AIM_MARGIN), aimAngle - 0.06);
    if (e.code === 'ArrowRight') aimAngle = Math.min(-AIM_MARGIN,             aimAngle + 0.06);
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') shoot();
  });

  // ── HUD ───────────────────────────────────────────────────────────────
  function formatTime(t) {
    return t >= 10 ? Math.ceil(t).toString() : Math.max(0, t).toFixed(1);
  }

  function formatSurvived(secs) {
    const s = Math.floor(secs);
    return s < 60 ? s + 's' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHUD() {
    elScore.textContent = score;
    elHigh.textContent  = highScore;

    const ratio = timeLeft / MAX_TIME;
    elTime.textContent = formatTime(timeLeft);
    elTime.classList.toggle('urgent', timeLeft < 8);
    elTimerBar.style.width      = (Math.max(0, ratio) * 100).toFixed(1) + '%';
    elTimerBar.style.background = ratio > 0.5 ? '#33ff99' : ratio > 0.25 ? '#ffcc00' : '#ff3366';

    const speedFrac = Math.min((burnSpeed - 1) / 2, 1);
    elSpeed.textContent = burnSpeed.toFixed(1) + '\u00d7';
    elSpeed.style.color = speedFrac < 0.25 ? '#33ff99' : speedFrac < 0.6 ? '#ffcc00' : '#ff3366';
  }

  // ── Game control ──────────────────────────────────────────────────────
  function doStart() {
    score          = 0;
    timeLeft       = START_TIME;
    burnSpeed      = 1.0;
    gameElapsed    = 0;
    animState      = 'idle';
    proj           = null;
    slideMarble    = null;
    popList        = []; floatList = [];
    particles.length = 0;
    aimAngle       = -Math.PI / 2;
    aimActive      = false;
    respawnPending = false;

    highScore = Save.load('marblemanic_hi', 0);
    initGrid();
    shootColor = rnd(MARBLE_TYPES);
    nextColor  = rnd(MARBLE_TYPES);
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

    if (score > highScore) { highScore = score; Save.save('marblemanic_hi', highScore); }

    if (score >= 500)       Achievements.unlock('mm_500',  '500 Points');
    if (score >= 2000)      Achievements.unlock('mm_2k',   '2 000 Points');
    if (score >= 5000)      Achievements.unlock('mm_5k',   '5 000 Points');
    if (gameElapsed >= 60)  Achievements.unlock('mm_1min', '1 Minute Survivor');
    if (gameElapsed >= 120) Achievements.unlock('mm_2min', '2 Minute Survivor');

    elFinalScore.textContent = score;
    elFinalHigh.textContent  = highScore;
    elFinalTime.textContent  = formatSurvived(gameElapsed);

    overlayOver.classList.remove('hidden');
    document.getElementById('btn-pause').disabled = true;
    TowerLife.submitScore(score);
  }

  // ── Game loop ─────────────────────────────────────────────────────────
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(ts - lastTs, 80);
    lastTs = ts;

    if (!paused) {
      const dtSec = dt / 1000;
      gameElapsed += dtSec;
      burnSpeed    = 1.0 + gameElapsed * BURN_INC;

      // Burn timer
      timeLeft -= dtSec * burnSpeed;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateHUD();
        draw();
        doGameOver();
        return;
      }

      // Smooth grid-slide animation (new row entering from top)
      if (gridOffsetY < 0) {
        gridOffsetY += dt * 0.115;
        if (gridOffsetY >= 0) gridOffsetY = 0;
      }

      // Slide-in animation for incoming marble
      if (slideMarble) {
        slideMarble.t += dt / SLIDE_DUR;
        if (slideMarble.t >= 1) slideMarble = null;
      }

      // New-row countdown
      updateRowTimer(dtSec);

      // Phase updates
      if (animState === 'flying') {
        updateProjectile();

      } else if (animState === 'popping') {
        popTimer -= dt;
        if (popTimer <= 0) {
          popList = [];
          if (floatList.length > 0) {
            animState  = 'floating';
            floatTimer = FLOAT_DUR;
          } else {
            animState = 'idle';
            if (respawnPending) respawnGrid();
          }
        }

      } else if (animState === 'floating') {
        floatTimer -= dt;
        for (const f of floatList) {
          f.vy += dt * 0.022;  // gravity
          f.y  += f.vy;
        }
        if (floatTimer <= 0) {
          floatList = [];
          animState = 'idle';
          if (respawnPending) respawnGrid();
        }
      }

      updateParticles();
      updateHUD();
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** Draw a marble centred at (0,0). radius defaults to BUBBLE_R-1. */
  function drawMarble(colorIdx, radius) {
    const r     = radius !== undefined ? radius : BUBBLE_R - 1;
    const color = COLORS[colorIdx];

    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 9;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur  = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Specular highlight (top-left ellipse)
    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 0.27, r * 0.35, r * 0.20, -0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawShooter() {
    ctx.save();
    ctx.translate(SHOOTER_X, SHOOTER_Y);

    // Barrel
    ctx.save();
    ctx.rotate(aimAngle + Math.PI / 2);
    const bh = 34, bw = 12;
    const grad = ctx.createLinearGradient(-bw / 2, -bh, bw / 2, 0);
    grad.addColorStop(0, '#4a4a5a');
    grad.addColorStop(1, '#2a2a38');
    ctx.fillStyle   = grad;
    ctx.fillRect(-bw / 2, -bh, bw, bh);
    ctx.strokeStyle = '#667';
    ctx.lineWidth   = 1;
    ctx.strokeRect(-bw / 2, -bh, bw, bh);
    ctx.restore();

    // Base ring
    ctx.fillStyle   = '#1e1e2e';
    ctx.strokeStyle = '#3a3a5a';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Current marble sitting in the barrel (hidden while slide-in is playing)
    if (!slideMarble) drawMarble(shootColor, BUBBLE_R - 3);

    ctx.restore();
  }

  // Marble sliding from the NEXT preview position into the cannon
  function drawSlideMarble() {
    if (!slideMarble) return;
    const t  = Math.min(1, slideMarble.t);
    const et = 1 - Math.pow(1 - t, 3);        // ease-out cubic
    const nx = CANVAS_W - 36;
    const x  = nx + (SHOOTER_X - nx) * et;    // interpolate x from NEXT → SHOOTER
    const r  = (BUBBLE_R - 5) + 2 * et;       // marble grows slightly as it arrives
    ctx.save();
    ctx.translate(x, SHOOTER_Y);
    ctx.globalAlpha = 0.65 + 0.35 * et;
    drawMarble(slideMarble.color, r);
    ctx.restore();
  }

  function drawNextMarble() {
    const nx = CANVAS_W - 36, ny = SHOOTER_Y;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle   = '#444';
    ctx.font        = '8px "Courier New", monospace';
    ctx.textAlign   = 'center';
    ctx.fillText('NEXT', nx, ny - BUBBLE_R - 5);
    ctx.translate(nx, ny);
    drawMarble(nextColor, BUBBLE_R - 5);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha  = Math.max(0, p.life);
      ctx.fillStyle    = p.color;
      ctx.shadowColor  = p.color;
      ctx.shadowBlur   = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function draw() {
    // Background
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Danger tint when bubbles are low on screen
    const bottomRow = getBottomFilledRow();
    if (bottomRow >= GRID_ROWS - 4) {
      const alpha = Math.min(1, (bottomRow - (GRID_ROWS - 5)) / 4) * 0.15;
      ctx.fillStyle = `rgba(255,50,50,${alpha})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Separator line at grid ceiling
    ctx.strokeStyle = '#1a1a35';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(0, GRID_TOP + gridOffsetY);
    ctx.lineTo(CANVAS_W, GRID_TOP + gridOffsetY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Grid: static bubbles
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < colsInRow(r); c++) {
        const color = grid[r][c];
        if (color < 0) continue;
        ctx.save();
        ctx.translate(bubbleCX(r, c), bubbleCY(r));
        drawMarble(color);
        ctx.restore();
      }
    }

    // Pop animation: matched marbles expand & fade out
    if (popList.length) {
      const prog = 1 - popTimer / POP_DUR;
      for (const { r, c, color } of popList) {
        ctx.save();
        ctx.translate(bubbleCX(r, c), bubbleCY(r));
        ctx.globalAlpha = Math.max(0, 1 - prog * 1.25);
        ctx.scale(1 + prog * 0.65, 1 + prog * 0.65);
        drawMarble(color);
        ctx.restore();
      }
    }

    // Float animation: disconnected bubbles fall away
    if (floatList.length) {
      const prog = 1 - floatTimer / FLOAT_DUR;
      for (const f of floatList) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.globalAlpha = Math.max(0, 1 - prog * 1.6);
        drawMarble(f.color);
        ctx.restore();
      }
    }

    // Aim guide line (only when idle)
    if (animState === 'idle') {
      const pts = computeAimLine(aimAngle);
      if (pts.length >= 2) {
        ctx.save();
        ctx.setLineDash([5, 9]);
        ctx.lineDashOffset = -(performance.now() / 75) % 14;
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        // Landing indicator
        const ep = pts[pts.length - 1];
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Shooter, current marble, and slide-in animation
    drawShooter();
    drawSlideMarble();

    // Projectile in flight
    if (proj) {
      ctx.save();
      ctx.translate(proj.x, proj.y);
      drawMarble(proj.color);
      ctx.restore();
    }

    // Next-marble preview
    drawNextMarble();

    // Particle effects
    drawParticles();

    // Separator above shooter area
    ctx.strokeStyle = '#141426';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, SHOOTER_Y - BUBBLE_R - 12);
    ctx.lineTo(CANVAS_W, SHOOTER_Y - BUBBLE_R - 12);
    ctx.stroke();
  }

  // ── Button listeners ──────────────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', doStart);
  document.getElementById('btn-restart').addEventListener('click', doStart);
  document.getElementById('btn-resume').addEventListener('click', doResume);
  document.getElementById('btn-pause').addEventListener('click', () => {
    if (!running) return;
    paused ? doResume() : doPause();
  });
  document.getElementById('btn-mute').addEventListener('click', () => {
    GameAudio.setMuted(!GameAudio.isMuted());
    document.getElementById('btn-mute').textContent = GameAudio.isMuted() ? '🔇' : '🔊';
  });
  overlayStart.addEventListener('click', e => { if (e.target === overlayStart) doStart(); });
  overlayPause.addEventListener('click', e => { if (e.target === overlayPause) doResume(); });
  overlayOver.addEventListener('click',  e => { if (e.target === overlayOver)  doStart(); });

})();
