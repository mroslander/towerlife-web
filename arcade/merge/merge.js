/**
 * merge.js — 2048-clone "Merge 2048"
 *
 * Swipe (or arrow keys) to slide all tiles in one direction. Two tiles
 * with the same value merge into their sum. Reach 2048 to win — but you
 * can keep going for an even higher score!
 *
 * Controls:
 *   Touch swipe  : swipe in any direction on the screen
 *   Arrow keys   : ← ↑ → ↓
 *   Unity bridge : window.merge_swipe('left'|'right'|'up'|'down')
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────
  const GAME_ID   = 'merge';
  const COLS      = 4;
  const ROWS      = 4;
  const W         = 360;
  const H         = 380;

  const MARGIN    = 10;                               // px, around the board
  const GAP       = 8;                                // px, between cells
  const BOARD_SZ  = W - 2 * MARGIN;                  // 340
  const CELL_SZ   = (BOARD_SZ - (COLS + 1) * GAP) / COLS;  // 75
  const BOARD_X   = MARGIN;
  const BOARD_Y   = Math.round((H - BOARD_SZ) / 2);  // 20

  const SWIPE_MIN = 30;     // px, minimum distance to register swipe
  const SPAWN_4   = 0.10;   // probability of spawning a 4 instead of 2

  // ── Tile palette — bg fill, text colour, glow colour ──────────────
  const PALETTE = {
    2:    { bg: '#200e08', tx: '#ff7744', gl: '#ff7744' },
    4:    { bg: '#201808', tx: '#ffaa22', gl: '#ffaa22' },
    8:    { bg: '#201e08', tx: '#ffee00', gl: '#ffee00' },
    16:   { bg: '#121e08', tx: '#aaff22', gl: '#88ff00' },
    32:   { bg: '#081e12', tx: '#22ff88', gl: '#00ff88' },
    64:   { bg: '#081e1e', tx: '#00ffee', gl: '#00ffdd' },
    128:  { bg: '#08121e', tx: '#22aaff', gl: '#0088ff' },
    256:  { bg: '#12081e', tx: '#8844ff', gl: '#8844ff' },
    512:  { bg: '#1e081e', tx: '#dd22ff', gl: '#dd00ff' },
    1024: { bg: '#1e0812', tx: '#ff2299', gl: '#ff0088' },
    2048: { bg: '#2a2808', tx: '#ffff44', gl: '#ffff00' },
  };
  const PAL_HUGE = { bg: '#1e1e1e', tx: '#ffffff', gl: '#ffffff' };

  // ── Canvas ────────────────────────────────────────────────────────
  const canvas = document.getElementById('game-canvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = W;
  canvas.height = H;

  // ── Game state ────────────────────────────────────────────────────
  let board    = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  let score    = 0;
  let best     = 0;
  let phase    = 'idle';   // 'idle' | 'playing' | 'won' | 'over'
  let wonEver  = false;    // true once 2048 reached (skip win screen after that)

  // Per-tile animation state
  let tAnim = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ scale: 1, flash: 0 }))
  );

  // Floating score delta animation
  let scorePop = { text: '', t: 0 };

  // Touch tracking
  let tx0 = 0, ty0 = 0;

  // ── Helpers ───────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  // ── Persistence ───────────────────────────────────────────────────
  function persist() {
    const data = Save.load(GAME_ID);
    best = (data && data.best) ? data.best : 0;
  }

  function saveBest() {
    Save.save(GAME_ID, { best });
  }

  // ── Board helpers ─────────────────────────────────────────────────
  function initBoard() {
    board  = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    tAnim  = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({ scale: 1, flash: 0 }))
    );
    score  = 0;
    wonEver = false;
    spawnTile();
    spawnTile();
  }

  function emptySlots() {
    const out = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] === 0) out.push([r, c]);
    return out;
  }

  function spawnTile() {
    const slots = emptySlots();
    if (!slots.length) return;
    const [r, c] = slots[Math.floor(Math.random() * slots.length)];
    board[r][c]  = Math.random() < SPAWN_4 ? 4 : 2;
    tAnim[r][c]  = { scale: 0.05, flash: 0 };  // pop-in animation
  }

  /**
   * Slide an array of values to the left, merging equal adjacent values.
   * Returns the merged row, score gained, and which indices were merge targets.
   */
  function slideLeft(arr) {
    const vals = arr.filter(v => v !== 0);
    let gain = 0;
    const mergedAt = new Set();
    for (let i = 0; i < vals.length - 1; i++) {
      if (vals[i] === vals[i + 1]) {
        vals[i] *= 2;
        gain += vals[i];
        mergedAt.add(i);
        vals.splice(i + 1, 1);
      }
    }
    while (vals.length < COLS) vals.push(0);
    return { out: vals, gain, mergedAt };
  }

  function canMove() {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === 0) return true;
        if (c < COLS - 1 && board[r][c] === board[r][c + 1]) return true;
        if (r < ROWS - 1 && board[r][c] === board[r + 1][c]) return true;
      }
    return false;
  }

  // ── Move logic ────────────────────────────────────────────────────
  function applyMove(dir) {
    if (phase !== 'playing') return;

    let totalGain = 0;
    let changed   = false;
    const hits    = [];   // [r, c] of merge-target tiles

    if (dir === 'left') {
      for (let r = 0; r < ROWS; r++) {
        const { out, gain, mergedAt } = slideLeft([...board[r]]);
        if (out.some((v, i) => v !== board[r][i])) changed = true;
        board[r] = out;
        totalGain += gain;
        mergedAt.forEach(c => hits.push([r, c]));
      }

    } else if (dir === 'right') {
      for (let r = 0; r < ROWS; r++) {
        const { out, gain, mergedAt } = slideLeft([...board[r]].reverse());
        out.reverse();
        if (out.some((v, i) => v !== board[r][i])) changed = true;
        board[r] = out;
        totalGain += gain;
        mergedAt.forEach(i => hits.push([r, COLS - 1 - i]));
      }

    } else if (dir === 'up') {
      for (let c = 0; c < COLS; c++) {
        const col = board.map(row => row[c]);
        const { out, gain, mergedAt } = slideLeft([...col]);
        if (out.some((v, i) => v !== board[i][c])) changed = true;
        out.forEach((v, r) => { board[r][c] = v; });
        totalGain += gain;
        mergedAt.forEach(r => hits.push([r, c]));
      }

    } else { // down
      for (let c = 0; c < COLS; c++) {
        const col = board.map(row => row[c]).reverse();
        const { out, gain, mergedAt } = slideLeft([...col]);
        out.reverse();
        const orig = board.map(row => row[c]);
        if (out.some((v, i) => v !== orig[i])) changed = true;
        out.forEach((v, r) => { board[r][c] = v; });
        totalGain += gain;
        mergedAt.forEach(i => hits.push([ROWS - 1 - i, c]));
      }
    }

    if (!changed) return;

    // Score = highest tile value reached this game
    let maxTile = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] > maxTile) maxTile = board[r][c];
    const prevScore = score;
    score = maxTile;
    if (score > best) { best = score; saveBest(); }
    TowerLife.sendScore(score);
    updateHUD();

    // Animate merged tiles
    hits.forEach(([r, c]) => {
      tAnim[r][c].scale = 1.22;
      tAnim[r][c].flash = 1.0;
    });
    if (hits.length > 0) {
      // Show the new tile value if it's a new record this game
      if (score > prevScore) {
        scorePop = { text: String(score), t: 1.0 };
      }
      GameAudio.beep({ frequency: 660, duration: 0.06, type: 'square', volume: 0.18 });
    } else {
      GameAudio.beep({ frequency: 280, duration: 0.04, type: 'square', volume: 0.08 });
    }

    spawnTile();

    // Check 2048 win (first time only)
    if (!wonEver) {
      outer: for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (board[r][c] >= 2048) {
            wonEver = true;
            onWin();
            break outer;
          }
    }

    if (!canMove()) onGameOver();

    checkAchievements();
  }

  // ── Win / Game-over ───────────────────────────────────────────────
  function onWin() {
    phase = 'won';
    $('win-score').textContent = score;
    showOverlay('overlay-win');
    GameAudio.beep({ frequency: 880, duration: 0.5, type: 'sine', volume: 0.4 });
  }

  function onGameOver() {
    phase = 'over';
    TowerLife.onGameOver(score);
    $('final-score').textContent = score;
    $('final-high').textContent  = best;
    setTimeout(() => showOverlay('overlay-over'), 500);
    GameAudio.beep({ frequency: 180, duration: 0.4, type: 'sawtooth', volume: 0.3 });
  }

  // ── Achievements ──────────────────────────────────────────────────
  const unlocked = new Set();
  function checkAchievements() {
    const u = id => {
      if (unlocked.has(id)) return;
      unlocked.add(id);
      TowerLife.unlockAchievement(id);
    };
    if (score >= 1000)  u('merge_1k');
    if (score >= 5000)  u('merge_5k');
    if (score >= 10000) u('merge_10k');
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] >= 512)  u('merge_512');
        if (board[r][c] >= 1024) u('merge_1024');
        if (board[r][c] >= 2048) u('merge_2048');
      }
  }

  // ── HUD ───────────────────────────────────────────────────────────
  function updateHUD() {
    $('score').textContent      = score;
    $('high-score').textContent = best;
  }

  // ── Overlays ──────────────────────────────────────────────────────
  function showOverlay(id) {
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
    $(id).classList.remove('hidden');
  }

  function hideOverlays() {
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
  }

  // ── Rendering ─────────────────────────────────────────────────────
  function fillRR(x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, W, H);

    // Board background
    fillRR(BOARD_X, BOARD_Y, BOARD_SZ, BOARD_SZ, 10, '#181818');

    // Cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x  = BOARD_X + GAP + c * (CELL_SZ + GAP);
        const y  = BOARD_Y + GAP + r * (CELL_SZ + GAP);

        // Empty slot
        fillRR(x, y, CELL_SZ, CELL_SZ, 6, '#111111');

        const val = board[r][c];
        if (!val) continue;

        const pal    = PALETTE[val] || PAL_HUGE;
        const { scale, flash } = tAnim[r][c];
        const cx     = x + CELL_SZ / 2;
        const cy     = y + CELL_SZ / 2;
        const hw     = (CELL_SZ / 2) * scale;
        const hh     = (CELL_SZ / 2) * scale;

        ctx.save();

        // Glow for higher tiles
        if (val >= 64) {
          ctx.shadowColor = pal.gl;
          ctx.shadowBlur  = 16 * scale;
        }

        // Tile background
        fillRR(cx - hw, cy - hh, hw * 2, hh * 2, 6 * scale, pal.bg);

        // Merge flash overlay
        if (flash > 0) {
          ctx.globalAlpha = flash * 0.4;
          fillRR(cx - hw, cy - hh, hw * 2, hh * 2, 6 * scale, pal.tx);
          ctx.globalAlpha = 1;
        }

        // Value label
        ctx.shadowColor    = pal.gl;
        ctx.shadowBlur     = 10;
        const fSz = val >= 1000 ? Math.round(CELL_SZ * 0.25 * scale)
                  : val >=  100 ? Math.round(CELL_SZ * 0.30 * scale)
                  :               Math.round(CELL_SZ * 0.37 * scale);
        ctx.font           = `bold ${fSz}px 'Courier New', monospace`;
        ctx.fillStyle      = pal.tx;
        ctx.textAlign      = 'center';
        ctx.textBaseline   = 'middle';
        ctx.fillText(String(val), cx, cy);

        ctx.restore();
      }
    }

    // Floating score delta
    if (scorePop.t > 0) {
      const alpha = Math.min(1, scorePop.t * 2);
      const rise  = (1 - scorePop.t) * 30;
      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.font         = 'bold 16px "Courier New"';
      ctx.fillStyle    = '#ffdd00';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = '#ffdd00';
      ctx.shadowBlur   = 8;
      ctx.fillText(scorePop.text, W / 2, BOARD_Y - 16 + rise);
      ctx.restore();
    }
  }

  // ── Game loop ─────────────────────────────────────────────────────
  let prevTime = 0;

  function loop(now) {
    const dt = prevTime === 0 ? 0 : Math.min((now - prevTime) / 1000, 0.1);
    prevTime  = now;

    // Animate tile scales (spring toward 1)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = tAnim[r][c];
        if (a.scale !== 1) {
          a.scale += (1 - a.scale) * Math.min(1, dt * 22);
          if (Math.abs(a.scale - 1) < 0.01) a.scale = 1;
        }
        if (a.flash > 0) a.flash = Math.max(0, a.flash - dt * 4.5);
      }
    }

    // Decay score pop
    if (scorePop.t > 0) scorePop.t = Math.max(0, scorePop.t - dt * 1.4);

    draw();
    requestAnimationFrame(loop);
  }

  // ── Input handling ────────────────────────────────────────────────

  // Attach swipe to the whole page so player doesn't need to aim at the grid
  document.addEventListener('touchstart', e => {
    tx0 = e.touches[0].clientX;
    ty0 = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (phase !== 'playing') return;
    const dx = e.changedTouches[0].clientX - tx0;
    const dy = e.changedTouches[0].clientY - ty0;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    applyMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }, { passive: true });

  document.addEventListener('keydown', e => {
    if (phase !== 'playing') return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir) { e.preventDefault(); applyMove(dir); }
  });

  // Unity bridge
  window.merge_swipe = dir => applyMove(dir);

  // ── Button handlers ───────────────────────────────────────────────
  $('btn-start').addEventListener('click', startGame);
  $('btn-restart').addEventListener('click', startGame);

  $('btn-continue').addEventListener('click', () => {
    phase = 'playing';
    hideOverlays();
  });

  $('btn-new-from-win').addEventListener('click', startGame);

  $('btn-mute').addEventListener('click', () => {
    GameAudio.setMuted(!GameAudio.isMuted());
    $('btn-mute').textContent = GameAudio.isMuted() ? '🔇' : '🔊';
  });

  function startGame() {
    persist();
    initBoard();
    phase = 'playing';
    updateHUD();
    hideOverlays();
    TowerLife.onGameReady(GAME_ID);
  }

  // ── Kick off ──────────────────────────────────────────────────────
  persist();
  updateHUD();
  requestAnimationFrame(loop);

})();
