'use strict';

// ── Difficulty / scoring constants ────────────────────────────────────────────
const COLS         = 9;
const ROWS         = 9;
const NUM_COLORS   = 3;     // pink · cyan · yellow

// Score formula: n * n * SCORE_MULT   (n = tiles removed in one move)
const SCORE_MULT   = 10;

// Bonus when the entire board is cleared
const CLEAR_BONUS  = 2000;

// Animation lengths (frames ≈ 60 fps)
const FLASH_FRAMES  = 16;   // removed tiles flash before vanishing
const SETTLE_FRAMES = 8;    // brief pause after the grid settles

// Visual
const TILE_PAD    = 3;      // gap between tile and cell edge (px)
const TILE_RADIUS = 7;      // corner radius (px)
const POP_LIFE    = 55;     // score-pop lives this many frames

const TILE_COLORS = [
  { base: '#ff3366', light: '#ff7799', shadow: 'rgba(255,51,102,0.55)'  },
  { base: '#00ccff', light: '#66eeff', shadow: 'rgba(0,204,255,0.55)'   },
  { base: '#ffcc00', light: '#ffe566', shadow: 'rgba(255,204,0,0.55)'   },
];

const BG_COLOR    = '#080e16';
const EMPTY_COLOR = '#0d1520';

// ── State ─────────────────────────────────────────────────────────────────────
let canvas, ctx;
let grid      = [];           // [ROWS][COLS]  value: 0|1|2 or -1 (empty)
let score     = 0;
let highScore = 0;
let gameState = 'idle';       // 'idle' | 'playing' | 'gameover'
let muted     = false;

// Selection
let selGroup = null;          // [{r,c}] currently highlighted group
let selSet   = null;          // Set<"r,c"> for O(1) lookup

// Removal animation
let phase      = 'idle';      // 'idle' | 'flashing' | 'settling'
let phaseTimer = 0;
let flashGroup = null;        // [{r,c}] currently flashing
let flashSet   = null;        // Set<"r,c">

// Floating score pop-ups
let scorePops = [];           // [{x,y,text,life,big}]

let lastTs         = null;
let lastTouchEndMs = 0;       // ghost-click suppression

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  highScore = Save.load('remover_high', 0);
  document.getElementById('high').textContent = highScore;

  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  // Touch — touchend for responsiveness, preventDefault to block ghost click
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    lastTouchEndMs = Date.now();
    const t = e.changedTouches[0];
    handleTap(t.clientX, t.clientY);
  }, { passive: false });

  // Mouse click (guard against ghost clicks on touch devices)
  canvas.addEventListener('click', e => {
    if (Date.now() - lastTouchEndMs < 600) return;
    handleTap(e.clientX, e.clientY);
  });

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.getElementById('btn-mute').addEventListener('click', () => {
    muted = !muted;
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  window.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (gameState === 'idle' || gameState === 'gameover') startGame();
    }
  });

  TowerLife.onMessage(msg => {
    if (msg.type === 'MUTE') muted = !!msg.muted;
  });

  requestAnimationFrame(loop);
});

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function setupCanvas() {
  const avail = Math.min(window.innerWidth - 16, window.innerHeight - 130, 430);
  const size  = Math.max(avail, 252);
  canvas.width  = size;
  canvas.height = size;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  draw();
}

const cellSize = () => canvas.width / COLS;

// ── Game flow ─────────────────────────────────────────────────────────────────
function startGame() {
  if (!TowerLife.Credits.consume(startGame)) return;

  score      = 0;
  selGroup   = null;
  selSet     = null;
  phase      = 'idle';
  phaseTimer = 0;
  flashGroup = null;
  flashSet   = null;
  scorePops  = [];
  gameState  = 'playing';

  hideOverlay('start');
  hideOverlay('over');

  initGrid();
  TowerLife.onGameReady('remover');
  updateHUD();
}

function initGrid() {
  grid = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => Math.floor(Math.random() * NUM_COLORS))
  );
}

// ── Core logic ────────────────────────────────────────────────────────────────

// BFS flood-fill: return all cells connected to (sr,sc) with the same colour
function floodFill(sr, sc) {
  const color   = grid[sr][sc];
  if (color < 0) return [];
  const visited = new Set();
  const queue   = [[sr, sc]];
  const result  = [];

  while (queue.length) {
    const [r, c] = queue.shift();
    const key    = r * COLS + c;
    if (visited.has(key)) continue;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    if (grid[r][c] !== color) continue;
    visited.add(key);
    result.push({ r, c });
    queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }
  return result;
}

// Remove cells, apply downward gravity, collapse empty columns leftward
function applyGravityAndShift() {
  // Gravity: compact each column (non-empty tiles sink to bottom)
  for (let c = 0; c < COLS; c++) {
    const tiles = [];
    for (let r = 0; r < ROWS; r++) if (grid[r][c] >= 0) tiles.push(grid[r][c]);
    const empty = ROWS - tiles.length;
    for (let r = 0; r < ROWS; r++) {
      grid[r][c] = r < empty ? -1 : tiles[r - empty];
    }
  }

  // Column shift: remove fully-empty columns, pack remaining left
  const activeCols = [];
  for (let c = 0; c < COLS; c++) {
    let any = false;
    for (let r = 0; r < ROWS; r++) { if (grid[r][c] >= 0) { any = true; break; } }
    if (any) activeCols.push(c);
  }
  const newGrid = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
  activeCols.forEach((oldC, newC) => {
    for (let r = 0; r < ROWS; r++) newGrid[r][newC] = grid[r][oldC];
  });
  grid = newGrid;
}

function countTiles() {
  let n = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] >= 0) n++;
  return n;
}

function hasValidMoves() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] < 0) continue;
      if (c + 1 < COLS && grid[r][c + 1] === grid[r][c]) return true;
      if (r + 1 < ROWS && grid[r + 1][c] === grid[r][c]) return true;
    }
  }
  return false;
}

const calcScore = n => n * n * SCORE_MULT;

// ── Input ─────────────────────────────────────────────────────────────────────
function handleTap(clientX, clientY) {
  if (gameState !== 'playing' || phase !== 'idle') return;

  const rect  = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const px     = (clientX - rect.left) * scaleX;
  const py     = (clientY - rect.top)  * scaleY;
  const cs     = cellSize();
  const c      = Math.floor(px / cs);
  const r      = Math.floor(py / cs);

  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) { clearSel(); return; }
  if (grid[r][c] < 0) { clearSel(); return; }

  const key = `${r},${c}`;

  if (selSet && selSet.has(key)) {
    // Second tap on same group → confirm removal
    beginFlash(selGroup);
    clearSel();
  } else {
    const group = floodFill(r, c);
    if (group.length < 2) {
      // Single isolated tile — can't remove
      playSound('invalid');
      clearSel();
    } else {
      selGroup = group;
      selSet   = new Set(group.map(g => `${g.r},${g.c}`));
    }
  }
}

function clearSel() {
  selGroup = null;
  selSet   = null;
}

function beginFlash(group) {
  flashGroup = group;
  flashSet   = new Set(group.map(g => `${g.r},${g.c}`));
  phase      = 'flashing';
  phaseTimer = FLASH_FRAMES;
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop(ts) {
  if (lastTs !== null && gameState === 'playing') {
    if (phase === 'flashing') {
      phaseTimer--;
      if (phaseTimer <= 0) commitRemoval();
    } else if (phase === 'settling') {
      phaseTimer--;
      if (phaseTimer <= 0) {
        phase = 'idle';
        if (!hasValidMoves()) triggerGameOver();
      }
    }

    // Age score pops
    for (let i = scorePops.length - 1; i >= 0; i--) {
      scorePops[i].life--;
      if (scorePops[i].life <= 0) scorePops.splice(i, 1);
    }
  }
  lastTs = ts;
  draw();
  requestAnimationFrame(loop);
}

function commitRemoval() {
  const group = flashGroup;
  flashGroup  = null;
  flashSet    = null;

  const n   = group.length;
  const pts = calcScore(n);
  score    += pts;

  // Score pop at centroid of removed group
  const cs  = cellSize();
  const cx  = (group.reduce((s, g) => s + g.c, 0) / n + 0.5) * cs;
  const cy  = (group.reduce((s, g) => s + g.r, 0) / n + 0.5) * cs;
  scorePops.push({ x: cx, y: cy, text: `+${pts}`, life: POP_LIFE, big: n >= 10 });

  // Remove tiles and compact
  for (const { r, c } of group) grid[r][c] = -1;
  applyGravityAndShift();

  const remaining = countTiles();

  if (remaining === 0) {
    score += CLEAR_BONUS;
    scorePops.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      text: `CLEAR! +${CLEAR_BONUS}`,
      life: POP_LIFE * 1.5,
      big: true,
    });
    playSound('clear');
  } else {
    playSound('pop', n);
  }

  TowerLife.sendScore(score);
  checkAchievements(n, remaining);
  updateHUD();

  phase      = 'settling';
  phaseTimer = remaining === 0 ? 40 : SETTLE_FRAMES;
}

function triggerGameOver() {
  gameState = 'gameover';
  const remaining = countTiles();

  if (score > highScore) {
    highScore = score;
    Save.save('remover_high', highScore);
    document.getElementById('high').textContent = highScore;
  }

  TowerLife.onGameOver(score, { tilesLeft: remaining });

  document.getElementById('over-title').textContent  = remaining === 0 ? 'BOARD CLEARED!' : 'NO MORE MOVES';
  document.getElementById('final-score').textContent = score;
  document.getElementById('final-high').textContent  = highScore;
  document.getElementById('final-left').textContent  = remaining;

  playSound('gameover');
  showOverlay('over');
}

// ── Achievements ──────────────────────────────────────────────────────────────
function checkAchievements(groupSize, remaining) {
  if (score >= 1000)   Achievements.unlock('rem_1k',    '1 000 Points!');
  if (score >= 5000)   Achievements.unlock('rem_5k',    '5 000 Points!');
  if (score >= 10000)  Achievements.unlock('rem_10k',   '10 000 Points!');
  if (groupSize >= 10) Achievements.unlock('rem_10',    '10-Tile Blast!');
  if (groupSize >= 20) Achievements.unlock('rem_20',    '20-Tile Bomb!');
  if (remaining === 0) Achievements.unlock('rem_clear', 'Clean Sweep!');
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score').textContent      = score;
  document.getElementById('tiles-left').textContent = countTiles();
  document.getElementById('high').textContent       = highScore;
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function draw() {
  const W  = canvas.width;
  const H  = canvas.height;
  const cs = cellSize();

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  if (!grid.length) return;

  const flashFrame = phase === 'flashing' ? phaseTimer : 0;

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const color = grid[r][c];
      const x = c * cs;
      const y = r * cs;
      const tx = x + TILE_PAD;
      const ty = y + TILE_PAD;
      const tw = cs - TILE_PAD * 2;
      const th = cs - TILE_PAD * 2;

      if (color < 0) {
        ctx.fillStyle = EMPTY_COLOR;
        roundRect(ctx, tx, ty, tw, th, TILE_RADIUS);
        ctx.fill();
        continue;
      }

      const key       = `${r},${c}`;
      const isFlash   = flashSet  && flashSet.has(key);
      const isSel     = selSet    && selSet.has(key);
      const tc        = TILE_COLORS[color];

      if (isFlash) {
        // Alternating white/color flash
        ctx.fillStyle = (Math.floor(flashFrame / 3) % 2 === 0) ? '#ffffff' : tc.light;
        roundRect(ctx, tx, ty, tw, th, TILE_RADIUS);
        ctx.fill();
      } else {
        // Glow for selected tiles
        if (isSel) {
          ctx.shadowColor = tc.base;
          ctx.shadowBlur  = 12;
        }
        ctx.fillStyle = isSel ? tc.light : tc.base;
        roundRect(ctx, tx, ty, tw, th, TILE_RADIUS);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Subtle gloss highlight
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        roundRect(ctx, tx + 2, ty + 2, tw - 4, th * 0.38, TILE_RADIUS * 0.6);
        ctx.fill();
      }
    }
  }

  // Draw selected-group score preview badge
  if (selGroup && selGroup.length >= 2 && phase === 'idle') {
    drawSelBadge();
  }

  // Draw floating score pops
  drawScorePops();
}

function drawSelBadge() {
  const cs  = cellSize();
  const n   = selGroup.length;
  const pts = calcScore(n);
  const cx  = (selGroup.reduce((s, g) => s + g.c, 0) / n + 0.5) * cs;
  const cy  = (selGroup.reduce((s, g) => s + g.r, 0) / n + 0.5) * cs;
  const txt = `${n}  ×  +${pts}`;

  const fontSize = Math.max(11, Math.floor(cs * 0.38));
  ctx.font = `bold ${fontSize}px 'Courier New', Courier, monospace`;

  const tw  = ctx.measureText(txt).width;
  const bw  = tw + 18;
  const bh  = fontSize + 10;
  const bx  = Math.min(Math.max(cx - bw / 2, 4), canvas.width - bw - 4);
  const by  = Math.min(Math.max(cy - bh / 2, 4), canvas.height - bh - 4);

  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  roundRect(ctx, bx, by, bw, bh, 5);
  ctx.fill();

  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, bx + bw / 2, by + bh / 2);
}

function drawScorePops() {
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (const pop of scorePops) {
    const alpha = Math.min(1, pop.life / (POP_LIFE * 0.5));
    const yOff  = (1 - pop.life / POP_LIFE) * 35;
    const fs    = pop.big ? Math.floor(cellSize() * 0.55) : Math.floor(cellSize() * 0.42);

    ctx.globalAlpha = alpha;
    ctx.font        = `bold ${fs}px 'Courier New', Courier, monospace`;

    // Dark outline for readability
    ctx.strokeStyle = '#000000';
    ctx.lineWidth   = 3;
    ctx.strokeText(pop.text, pop.x, pop.y - yOff);

    ctx.fillStyle = pop.big ? '#ffcc00' : '#ffffff';
    ctx.fillText(pop.text, pop.x, pop.y - yOff);
  }
  ctx.globalAlpha = 1;
}

// ── Utility: rounded rectangle path ──────────────────────────────────────────
function roundRect(cx, x, y, w, h, r) {
  cx.beginPath();
  cx.moveTo(x + r, y);
  cx.lineTo(x + w - r, y);
  cx.quadraticCurveTo(x + w, y,     x + w, y + r);
  cx.lineTo(x + w, y + h - r);
  cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  cx.lineTo(x + r, y + h);
  cx.quadraticCurveTo(x,     y + h, x,     y + h - r);
  cx.lineTo(x, y + r);
  cx.quadraticCurveTo(x,     y,     x + r, y);
  cx.closePath();
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playSound(type, n) {
  if (muted) return;
  switch (type) {
    case 'pop': {
      const f = Math.min(260 + (n || 2) * 25, 820);
      GameAudio.beep({ frequency: f,         duration: 0.07, type: 'square',   volume: 0.22 });
      setTimeout(() => GameAudio.beep({ frequency: f * 1.4, duration: 0.06, type: 'square', volume: 0.16 }), 65);
      break;
    }
    case 'clear':
      [350, 500, 700, 900, 1100, 1400].forEach((f, i) =>
        setTimeout(() => GameAudio.beep({ frequency: f, duration: 0.09, type: 'square', volume: 0.20 }), i * 65));
      break;
    case 'gameover':
      GameAudio.beep({ frequency: 280, duration: 0.16, type: 'sawtooth', volume: 0.22 });
      setTimeout(() => GameAudio.beep({ frequency: 180, duration: 0.35, type: 'sawtooth', volume: 0.18 }), 180);
      break;
    case 'invalid':
      GameAudio.beep({ frequency: 200, duration: 0.08, type: 'sawtooth', volume: 0.10 });
      break;
  }
}

// ── Overlay helpers ───────────────────────────────────────────────────────────
function showOverlay(id) {
  const el = document.getElementById('overlay-' + id);
  if (el) el.classList.remove('hidden');
}
function hideOverlay(id) {
  const el = document.getElementById('overlay-' + id);
  if (el) el.classList.add('hidden');
}
