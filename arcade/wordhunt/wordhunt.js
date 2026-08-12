'use strict';

// ── Difficulty constants ──────────────────────────────────────────────────────
const COLS            = 10;
const ROWS            = 10;
// Words per round (index = round-1, last value repeated beyond array)
const WORDS_PER_ROUND = [6, 7, 7, 8, 8, 9, 9, 10];
// Starting timer seconds per round
const ROUND_TIME      = [60, 55, 50, 46, 42, 38, 34, 30];
const TIME_PER_LETTER = 3;     // seconds added per letter when a word is found
const MAX_TIMER       = 90;    // hard cap on timer
const SCORE_PER_LETTER = 50;   // points per letter of found word

// Cycle colours assigned to found words (grid highlight + word chip)
const FOUND_COLORS = [
  '#00ff88', '#ff3366', '#ffcc00', '#00ccff',
  '#ff9900', '#cc33ff', '#33ffcc', '#ff6699',
];

const DIRECTIONS = [
  { dr:  0, dc:  1 }, // →
  { dr:  0, dc: -1 }, // ←
  { dr:  1, dc:  0 }, // ↓
  { dr: -1, dc:  0 }, // ↑
  { dr:  1, dc:  1 }, // ↘
  { dr:  1, dc: -1 }, // ↙
  { dr: -1, dc:  1 }, // ↗
  { dr: -1, dc: -1 }, // ↖
];

// ── Word pool ─────────────────────────────────────────────────────────────────
// 4-7 letter words, avoids obscure or offensive vocabulary
const WORD_POOL = [
  'APPLE','BLAST','CHAIN','DANCE','EAGLE','FLAME','GRAPE',
  'HEART','IMAGE','JEWEL','KNIFE','LASER','MAGIC','NEON',
  'OCEAN','PLANE','QUEST','RADAR','SPACE','TIGER','ULTRA',
  'VAPOR','WATER','XENON','YACHT','ZEBRA','BRAVE','CHAOS',
  'DELTA','EMBER','FROST','GHOST','HASTE','IONIC','JOKER',
  'KARMA','LUNAR','NOVA','ORBIT','PIXEL','QUARK','RAVEN',
  'STORM','TURBO','UNITY','VENOM','WARP','AMBER','BOOST',
  'CLASH','DRIFT','ELITE','FORCE','GLIDE','HYPER','INPUT',
  'JOLTS','KNOCK','LEVEL','MORPH','NERVE','OMEGA','POWER',
  'QUICK','REALM','SHARP','TOWER','VITAL','WORLD','PHASE',
  'SONIC','GLOW','FLUX','BOLT','GATE','JADE','KING',
  'LURE','MAZE','RUSH','SPIN','VOLT','ARCH','BANK',
  'CAVE','DOME','EDGE','FALL','GRID','HEAP','JUMP',
  'KILO','LINK','MINE','NODE','SLAB','TRAP','WAVE',
  'ARCADE','BATTLE','CASTLE','DANGER','ENGINE','FILTER',
  'GOLDEN','HUNTER','IMPACT','JUNGLE','KNIGHT','LAUNCH',
  'MIGHTY','NIMBLE','ORIGIN','PATROL','ROCKET','SIGNAL',
  'TRAVEL','VISION','WINNER','SHIELD','PLASMA','NEBULA',
  'ENERGY','BLAZER','COBALT','DAGGER','FRENZY','GOBLIN',
  'HELIUM','IGNITE','JOCKEY','MANTLE','NEUTRON','GOBLET',
  'PRISM','FLARE','SWARM','CLOAK','RIVET','HORDE',
  'GLOOM','BRUNT','FLECK','QUILL','SCALP','TROVE',
  'PLUME','KNACK','GRASP','CINCH','BRISK','STUNT',
];

// ── State ─────────────────────────────────────────────────────────────────────
let canvas, ctx;
let grid        = [];         // ROWS×COLS 2-D array of letters
let placedWords = [];         // [{word, row, col, dir}]  — successfully placed
let targetWords = [];         // string[] parallel to placedWords
let foundIndices = new Set(); // set of placedWords indices already found
let foundColors  = {};        // placedWord index → FOUND_COLORS index

let score     = 0;
let highScore = 0;
let round     = 1;
let timeLeft  = 60;
let maxTime   = 60;           // starting time for current round (for bar calc)
let gameState = 'idle';       // 'idle' | 'playing' | 'gameover'
let muted     = false;

// Selection state
let selStart       = null;    // {row, col}  where swipe began
let selDir         = null;    // {dr, dc}    locked direction (null until 2nd cell)
let selCells       = [];      // [{row, col}] cells in current swipe
let invalidFlash   = 0;       // frames remaining for red-flash on wrong word
let roundClearFlash = 0;      // frames remaining for green-flash on round clear

// Cell colour map  "row,col" → FOUND_COLORS index
let cellColors = {};

let lastTimestamp = null;

// ── Entry point ───────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  highScore = Save.load('wordhunt_high', 0);
  document.getElementById('high').textContent = highScore;

  setupCanvas();
  window.addEventListener('resize', setupCanvas);

  // Touch — on the canvas itself so we can preventDefault
  canvas.addEventListener('touchstart',  onPointerDown,   { passive: false });
  canvas.addEventListener('touchmove',   onPointerMove,   { passive: false });
  canvas.addEventListener('touchend',    onPointerUp,     { passive: false });
  canvas.addEventListener('touchcancel', onPointerCancel, { passive: false });
  // Mouse — move/up on window so dragging outside canvas still registers
  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup',   onPointerUp);

  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.getElementById('btn-mute').addEventListener('click', () => {
    muted = !muted;
    document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
  });

  // Space / Enter also starts / restarts
  window.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (gameState === 'idle')     startGame();
      if (gameState === 'gameover') startGame();
    }
  });

  TowerLife.onMessage(msg => {
    if (msg.type === 'MUTE') { muted = !!msg.muted; }
  });

  requestAnimationFrame(loop);
});

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function setupCanvas() {
  // Square canvas, leave room for HUD (~48px), timer bar (~18px),
  // word list panel (~108px), gaps + padding (~20px)
  const avail = Math.min(
    window.innerWidth  - 16,
    window.innerHeight - 200,
    440
  );
  const size = Math.max(avail, 240);
  canvas.width  = size;
  canvas.height = size;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  if (grid.length) drawGrid();
}

// ── Grid building ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWords(count) {
  return shuffle(WORD_POOL).slice(0, count);
}

function canPlace(g, word, startRow, startCol, dir) {
  for (let i = 0; i < word.length; i++) {
    const r = startRow + dir.dr * i;
    const c = startCol + dir.dc * i;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
    if (g[r][c] !== '' && g[r][c] !== word[i]) return false;
  }
  return true;
}

function buildGrid(words) {
  const g      = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
  const placed = [];
  const alpha  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  for (const word of words) {
    let ok = false;
    const dirs = shuffle(DIRECTIONS);
    outer:
    for (const dir of dirs) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const row = Math.floor(Math.random() * ROWS);
        const col = Math.floor(Math.random() * COLS);
        if (canPlace(g, word, row, col, dir)) {
          for (let i = 0; i < word.length; i++) {
            g[row + dir.dr * i][col + dir.dc * i] = word[i];
          }
          placed.push({ word, row, col, dir });
          ok = true;
          break outer;
        }
      }
    }
    if (!ok) console.warn('[WordHunt] Could not place:', word);
  }

  // Fill empty cells with random letters
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (g[r][c] === '')
        g[r][c] = alpha[Math.floor(Math.random() * alpha.length)];

  return { grid: g, placed };
}

// ── Game flow ─────────────────────────────────────────────────────────────────
function startGame() {
  if (!TowerLife.Credits.consume(startGame)) return;

  score          = 0;
  round          = 1;
  gameState      = 'playing';
  lastTimestamp  = null;
  invalidFlash   = 0;
  roundClearFlash = 0;
  selStart       = null;
  selDir         = null;
  selCells       = [];

  hideOverlay('start');
  hideOverlay('over');

  TowerLife.onGameReady('wordhunt');
  beginRound();
}

function beginRound() {
  const ri       = Math.min(round - 1, WORDS_PER_ROUND.length - 1);
  const ti       = Math.min(round - 1, ROUND_TIME.length - 1);
  const numWords = WORDS_PER_ROUND[ri];
  maxTime        = ROUND_TIME[ti];
  timeLeft       = maxTime;

  foundIndices = new Set();
  foundColors  = {};
  cellColors   = {};
  selCells     = [];
  selStart     = null;
  selDir       = null;

  const words  = pickWords(numWords);
  const result = buildGrid(words);
  grid         = result.grid;
  placedWords  = result.placed;
  targetWords  = result.placed.map(p => p.word);

  updateHUD();
  updateWordList();
}

function onWordFound(idx) {
  const colorIdx = foundIndices.size % FOUND_COLORS.length;
  foundIndices.add(idx);
  foundColors[idx] = colorIdx;

  const { word, row, col, dir } = placedWords[idx];
  for (let i = 0; i < word.length; i++) {
    cellColors[`${row + dir.dr * i},${col + dir.dc * i}`] = colorIdx;
  }

  score    += word.length * SCORE_PER_LETTER;
  timeLeft  = Math.min(timeLeft + word.length * TIME_PER_LETTER, MAX_TIMER);

  TowerLife.sendScore(score);
  checkAchievements();
  updateHUD();
  updateWordList();
  playSound('found');

  if (foundIndices.size === placedWords.length) {
    roundClearFlash = 80;
    playSound('roundclear');
    setTimeout(() => {
      round++;
      beginRound();
    }, 1350);
  }
}

function gameOver() {
  gameState = 'gameover';

  if (score > highScore) {
    highScore = score;
    Save.save('wordhunt_high', highScore);
    document.getElementById('high').textContent = highScore;
  }

  TowerLife.onGameOver(score, { round });

  document.getElementById('final-score').textContent = score;
  document.getElementById('final-high').textContent  = highScore;
  document.getElementById('final-round').textContent = round;

  playSound('gameover');
  showOverlay('over');
}

// ── Achievements ──────────────────────────────────────────────────────────────
function checkAchievements() {
  if (score >= 1000)  Achievements.unlock('wh_1k',   '1 000 Points!');
  if (score >= 5000)  Achievements.unlock('wh_5k',   '5 000 Points!');
  if (score >= 10000) Achievements.unlock('wh_10k',  '10 000 Points!');
  if (round >= 3)     Achievements.unlock('wh_rnd3', 'Round 3!');
  if (round >= 5)     Achievements.unlock('wh_rnd5', 'Round 5!');
  if (round >= 8)     Achievements.unlock('wh_rnd8', 'Round 8!');
}

// ── HUD & word list ───────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById('score').textContent = score;
  document.getElementById('round').textContent = round;

  const secs   = Math.ceil(timeLeft);
  const timeEl = document.getElementById('time-display');
  timeEl.textContent = secs;
  timeEl.classList.toggle('urgent', timeLeft < 10);

  const pct = Math.max(0, Math.min(1, timeLeft / maxTime));
  const bar = document.getElementById('timer-bar');
  bar.style.width           = (pct * 100) + '%';
  bar.style.backgroundColor = timeLeft < 10 ? '#ff3366' : timeLeft < 20 ? '#ffcc00' : '#00ccff';
}

function updateWordList() {
  const container = document.getElementById('word-list');
  container.innerHTML = '';
  targetWords.forEach((word, i) => {
    const isFound = foundIndices.has(i);
    const chip    = document.createElement('span');
    chip.className   = 'word-chip' + (isFound ? ' found' : '');
    chip.textContent = word;
    if (isFound) {
      const color = FOUND_COLORS[foundColors[i]];
      chip.style.color                  = color;
      chip.style.borderColor            = color;
      chip.style.textDecorationColor    = color;
    }
    container.appendChild(chip);
  });
}

// ── Input handling ────────────────────────────────────────────────────────────
function getCell(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx   = canvas.width  / rect.width;
  const sy   = canvas.height / rect.height;
  const px   = (clientX - rect.left) * sx;
  const py   = (clientY - rect.top)  * sy;
  const col  = Math.floor(px / (canvas.width  / COLS));
  const row  = Math.floor(py / (canvas.height / ROWS));
  if (col >= 0 && col < COLS && row >= 0 && row < ROWS) return { row, col };
  return null;
}

function evtPos(e) {
  return (e.touches && e.touches.length > 0) ? e.touches[0] : e;
}

function onPointerDown(e) {
  if (gameState !== 'playing' || roundClearFlash > 0) return;
  e.preventDefault();

  // Reset any ongoing invalid flash and previous selection
  invalidFlash = 0;
  selCells     = [];

  const { clientX, clientY } = evtPos(e);
  const cell = getCell(clientX, clientY);
  if (!cell) return;

  selStart = cell;
  selDir   = null;
  selCells = [cell];
}

function onPointerMove(e) {
  if (gameState !== 'playing' || !selStart || invalidFlash > 0) return;
  if (e.type === 'touchmove') e.preventDefault();

  const { clientX, clientY } = evtPos(e);
  const cell = getCell(clientX, clientY);
  if (!cell) return;

  const dr = cell.row - selStart.row;
  const dc = cell.col - selStart.col;

  if (dr === 0 && dc === 0) {
    selCells = [selStart];
    selDir   = null;
    return;
  }

  // Lock in direction once the swipe leaves the start cell
  if (!selDir) {
    const angle   = Math.atan2(dr, dc);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const snapDr  = Math.round(Math.sin(snapped));
    const snapDc  = Math.round(Math.cos(snapped));
    if (snapDr !== 0 || snapDc !== 0) selDir = { dr: snapDr, dc: snapDc };
  }
  if (!selDir) return;

  // Project displacement onto locked direction to get step count
  const dotLen = selDir.dr * selDir.dr + selDir.dc * selDir.dc; // 1 or 2
  const dot    = (dr * selDir.dr + dc * selDir.dc) / dotLen;
  const steps  = Math.max(0, Math.round(dot));

  const cells = [];
  for (let i = 0; i <= steps; i++) {
    const r = selStart.row + selDir.dr * i;
    const c = selStart.col + selDir.dc * i;
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) cells.push({ row: r, col: c });
    else break;
  }
  selCells = cells;
}

function onPointerUp(e) {
  if (gameState !== 'playing' || !selStart) return;
  if (e.type === 'touchend') e.preventDefault();
  validateSelection();
}

function onPointerCancel() {
  selStart = null;
  selDir   = null;
  selCells = [];
}

function validateSelection() {
  const cells = selCells;
  // Release the drag anchor; keep selCells populated for flash display
  selStart = null;
  selDir   = null;

  if (cells.length < 2) { selCells = []; return; }

  // Check each unresolved placed word (forward and reversed)
  for (let i = 0; i < placedWords.length; i++) {
    if (foundIndices.has(i)) continue;
    const { word, row, col, dir } = placedWords[i];
    if (cells.length !== word.length) continue;

    const wordCells = [];
    for (let j = 0; j < word.length; j++)
      wordCells.push({ row: row + dir.dr * j, col: col + dir.dc * j });

    if (cellsMatch(cells, wordCells) || cellsMatch(cells.slice().reverse(), wordCells)) {
      selCells = [];
      onWordFound(i);
      return;
    }
  }

  // No match — red flash (selCells stays populated; cleared by the loop)
  invalidFlash = 24;
  playSound('invalid');
}

function cellsMatch(a, b) {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.row === b[i].row && c.col === b[i].col);
}

// ── Render ────────────────────────────────────────────────────────────────────
const CLR_BG      = '#080e16';
const CLR_CELL    = '#0c1828';
const CLR_BORDER  = '#121f30';
const CLR_LETTER  = '#3a5a7a';
const CLR_SEL_OVL = 'rgba(0,200,255,0.32)';
const CLR_SEL_TXT = '#e8f8ff';
const CLR_INV_OVL = 'rgba(255,50,80,0.38)';
const CLR_INV_TXT = '#ffaabb';

function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawGrid() {
  if (!grid.length) return;

  const W  = canvas.width;
  const H  = canvas.height;
  const cW = W / COLS;
  const cH = H / ROWS;

  ctx.fillStyle = CLR_BG;
  ctx.fillRect(0, 0, W, H);

  const selSet    = new Set(selCells.map(c => `${c.row},${c.col}`));
  const isInvalid = invalidFlash > 0;
  const isRClear  = roundClearFlash > 0;

  // Pulsing alpha for round-clear overlay
  const rcAlpha = isRClear
    ? (Math.sin(roundClearFlash * 0.18) * 0.5 + 0.5) * 0.28
    : 0;

  const fontSize = Math.max(10, Math.floor(cW * 0.50));
  ctx.font         = `bold ${fontSize}px 'Courier New', Courier, monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x       = c * cW;
      const y       = r * cH;
      const key     = `${r},${c}`;
      const isSel   = selSet.has(key);
      const cIdx    = cellColors[key];
      const isFound = cIdx !== undefined;

      // Base cell
      ctx.fillStyle = CLR_CELL;
      ctx.fillRect(x, y, cW, cH);

      // Found word tint
      if (isFound) {
        ctx.fillStyle = hexAlpha(FOUND_COLORS[cIdx], 0.18);
        ctx.fillRect(x, y, cW, cH);
      }

      // Active selection overlay
      if (isSel) {
        ctx.fillStyle = isInvalid ? CLR_INV_OVL : CLR_SEL_OVL;
        ctx.fillRect(x, y, cW, cH);
      }

      // Round-clear flash overlay
      if (isRClear) {
        ctx.fillStyle = `rgba(0,255,136,${rcAlpha.toFixed(3)})`;
        ctx.fillRect(x, y, cW, cH);
      }

      // Grid lines
      ctx.strokeStyle = CLR_BORDER;
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(x + 0.25, y + 0.25, cW - 0.5, cH - 0.5);

      // Letter colour
      if (isSel) {
        ctx.fillStyle = isInvalid ? CLR_INV_TXT : CLR_SEL_TXT;
      } else if (isFound) {
        ctx.fillStyle = FOUND_COLORS[cIdx];
      } else {
        ctx.fillStyle = CLR_LETTER;
      }

      ctx.fillText(grid[r][c], x + cW * 0.5, y + cH * 0.5);
    }
  }
}

// ── Game loop ─────────────────────────────────────────────────────────────────
function loop(ts) {
  if (lastTimestamp !== null && gameState === 'playing') {
    const dt = Math.min((ts - lastTimestamp) / 1000, 0.1);

    timeLeft -= dt;

    if (invalidFlash > 0) {
      invalidFlash--;
      if (invalidFlash === 0) selCells = [];
    }
    if (roundClearFlash > 0) roundClearFlash--;

    if (timeLeft <= 0) {
      timeLeft = 0;
      gameOver();
    } else {
      updateHUD();
    }
  }
  lastTimestamp = ts;

  if (gameState === 'playing') drawGrid();

  requestAnimationFrame(loop);
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function playSound(type) {
  if (muted) return;
  switch (type) {
    case 'found':
      GameAudio.beep({ frequency: 760,  duration: 0.07, type: 'square',   volume: 0.20 });
      setTimeout(() => GameAudio.beep({ frequency: 1050, duration: 0.09, type: 'square', volume: 0.18 }), 75);
      break;
    case 'roundclear':
      [550, 700, 880, 1100].forEach((f, i) =>
        setTimeout(() => GameAudio.beep({ frequency: f, duration: 0.10, type: 'square', volume: 0.20 }), i * 90));
      break;
    case 'gameover':
      GameAudio.beep({ frequency: 280, duration: 0.16, type: 'sawtooth', volume: 0.24 });
      setTimeout(() => GameAudio.beep({ frequency: 180, duration: 0.35, type: 'sawtooth', volume: 0.20 }), 170);
      break;
    case 'invalid':
      GameAudio.beep({ frequency: 190, duration: 0.12, type: 'sawtooth', volume: 0.12 });
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
