/**
 * blockmaster.js — Block Puzzle arcade game
 *
 * Drag tetromino-style blocks from the tray onto a 10×10 grid.
 * Complete rows and/or columns to clear them and earn bonus points.
 * Game over when no remaining tray piece can be placed anywhere on the board.
 *
 * Depends on (loaded via index.html):
 *   save.js · towerlife.js · audio.js · achievements.js · ui.js
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  //  LAYOUT CONSTANTS
  // ══════════════════════════════════════════════════════════════════════
  const COLS      = 10;
  const ROWS      = 10;
  const CELL      = 32;         // grid cell size in px
  const TRAY_CELL = 22;         // tray preview cell size in px

  const GRID_X = 20;
  const GRID_Y = 8;
  const GRID_W = COLS * CELL;   // 320
  const GRID_H = ROWS * CELL;   // 320

  const TRAY_Y    = GRID_Y + GRID_H + 18;              // 346
  const TRAY_H    = 134;
  const NUM_SLOTS = 3;
  const SLOT_W    = (GRID_X * 2 + GRID_W) / NUM_SLOTS; // 120

  const CW = GRID_X * 2 + GRID_W;  // 360
  const CH = TRAY_Y + TRAY_H + 10; // 490

  // ── Drag & drop ────────────────────────────────────────────────────
  // The piece floats above the finger so it stays visible
  const LIFT_PX = 62;

  // ── Flash animation ────────────────────────────────────────────────
  const FLASH_MS = 300;

  // ── Scoring ────────────────────────────────────────────────────────
  const CELL_PTS   = 1;  // points per placed cell
  // Bonus for clearing N lines (rows+cols combined) in one placement
  const LINE_BONUS = [0, 100, 250, 500, 800, 1200, 1600, 2000];

  // ══════════════════════════════════════════════════════════════════════
  //  COLORS  (fill · dark bevel)
  // ══════════════════════════════════════════════════════════════════════
  const COLORS = [
    { fill: '#ff3366', dark: '#780021' },
    { fill: '#ff6600', dark: '#7a2800' },
    { fill: '#ffcc00', dark: '#7a5e00' },
    { fill: '#33ff99', dark: '#0f6640' },
    { fill: '#00eeff', dark: '#005566' },
    { fill: '#3399ff', dark: '#0d3f77' },
    { fill: '#cc33ff', dark: '#5a1177' },
    { fill: '#ff9900', dark: '#7a3d00' },
  ];

  // ══════════════════════════════════════════════════════════════════════
  //  PIECE SHAPES
  //  Each entry is an array of [row, col] offsets.
  //  All shapes are normalised: min row = 0, min col = 0.
  // ══════════════════════════════════════════════════════════════════════
  const SHAPES = [
    // ── 1-cell ──────────────────────────────────────────────────────────
    [[0,0]],

    // ── 2-cell lines ────────────────────────────────────────────────────
    [[0,0],[0,1]],
    [[0,0],[1,0]],

    // ── 3-cell lines ────────────────────────────────────────────────────
    [[0,0],[0,1],[0,2]],
    [[0,0],[1,0],[2,0]],

    // ── 3-cell L-corners (all 4 rotations) ─────────────────────────────
    [[0,0],[0,1],[1,0]],   // ┐ corner
    [[0,0],[0,1],[1,1]],   // ┌ corner
    [[0,0],[1,0],[1,1]],   // └ corner
    [[0,1],[1,0],[1,1]],   // ┘ corner

    // ── 4-cell lines ────────────────────────────────────────────────────
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[3,0]],

    // ── 2×2 square ──────────────────────────────────────────────────────
    [[0,0],[0,1],[1,0],[1,1]],

    // ── 4-cell L-shapes (L/J tetromino, all 8 orientations) ─────────────
    [[0,0],[1,0],[2,0],[2,1]],   // L  ┘ foot-right
    [[0,1],[1,1],[2,0],[2,1]],   // J  └ foot-left
    [[0,0],[0,1],[1,0],[2,0]],   // J  ┐ arm-right
    [[0,0],[0,1],[1,1],[2,1]],   // L  ┌ arm-left
    [[0,0],[0,1],[0,2],[1,0]],   // L flat — arm-bottom-left
    [[0,0],[0,1],[0,2],[1,2]],   // J flat — arm-bottom-right
    [[0,0],[1,0],[1,1],[1,2]],   // L flat — arm-top-right
    [[0,2],[1,0],[1,1],[1,2]],   // J flat — arm-top-left

    // ── S / Z 4-cell ─────────────────────────────────────────────────────
    [[0,1],[0,2],[1,0],[1,1]],   // S
    [[0,0],[0,1],[1,1],[1,2]],   // Z

    // ── 5-cell lines ─────────────────────────────────────────────────────
    [[0,0],[0,1],[0,2],[0,3],[0,4]],
    [[0,0],[1,0],[2,0],[3,0],[4,0]],

    // ── 3×3 square ───────────────────────────────────────────────────────
    [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]],

    // ── 3×2 / 2×3 rectangles ─────────────────────────────────────────────
    [[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],
    [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]],

    // ── Large L-corners (5-cell, 3×3 corner pieces) ──────────────────────
    [[0,0],[1,0],[2,0],[2,1],[2,2]],   // foot bottom-right
    [[0,0],[0,1],[0,2],[1,2],[2,2]],   // foot bottom-left
    [[0,2],[1,2],[2,0],[2,1],[2,2]],   // foot top-left
    [[0,0],[0,1],[0,2],[1,0],[2,0]],   // foot top-right
  ];

  // ══════════════════════════════════════════════════════════════════════
  //  CANVAS + DOM
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
  const overlayStart = document.getElementById('overlay-start');
  const overlayOver  = document.getElementById('overlay-over');

  // ══════════════════════════════════════════════════════════════════════
  //  GAME STATE
  // ══════════════════════════════════════════════════════════════════════
  let board;          // ROWS×COLS: -1 = empty, ≥0 = COLORS index
  let tray;           // NUM_SLOTS entries: { shapeIdx, colorIdx } | null
  let score, highScore, linesCleared;
  let running;
  let rafId, lastTs;

  // Flash state (line-clear animation)
  let flashLines;     // null | { rows: number[], cols: number[] }
  let flashTimer;     // countdown ms

  // Drag state
  let drag = null;    // null | { slot, piece, pointerX, pointerY, snapRow, snapCol, valid }
  const particles = [];

  // ══════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════════════════
  /** Bounding box of a shape (max row/col + 1) */
  function getBounds(cells) {
    let maxR = 0, maxC = 0;
    for (const [r, c] of cells) {
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    return { h: maxR + 1, w: maxC + 1 };
  }

  /** True if placing `cells` with top-left at (gridR, gridC) is legal */
  function canPlace(cells, gridR, gridC) {
    for (const [dr, dc] of cells) {
      const r = gridR + dr, c = gridC + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
      if (board[r][c] !== -1) return false;
    }
    return true;
  }

  /** True if a shape (by index) can be placed anywhere on the current board */
  function pieceCanFitAnywhere(shapeIdx) {
    const cells = SHAPES[shapeIdx];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (canPlace(cells, r, c)) return true;
    return false;
  }

  /** True when no remaining tray piece can be placed */
  function isGameOver() {
    return tray.every(p => p === null || !pieceCanFitAnywhere(p.shapeIdx));
  }

  function randomPiece() {
    return {
      shapeIdx: (Math.random() * SHAPES.length) | 0,
      colorIdx: (Math.random() * COLORS.length) | 0,
    };
  }

  /**
   * Given a pointer position (canvas coords), calculate where the
   * piece top-left should snap to on the grid.
   * The piece center floats LIFT_PX above the pointer.
   */
  function calcSnap(cells, pointerX, pointerY) {
    const { h, w } = getBounds(cells);
    const pieceCX = pointerX;
    const pieceCY = pointerY - LIFT_PX;
    // Snap top-left to nearest grid cell
    const snapCol = Math.round((pieceCX - GRID_X) / CELL - w / 2);
    const snapRow = Math.round((pieceCY - GRID_Y) / CELL - h / 2);
    return { snapRow, snapCol };
  }

  /** Convert a pointer event to canvas-local coordinates */
  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      cx: (e.clientX - rect.left) * (CW / rect.width),
      cy: (e.clientY - rect.top)  * (CH / rect.height),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  INPUT — POINTER EVENTS (drag & drop)
  // ══════════════════════════════════════════════════════════════════════
  function slotAtPoint(cx, cy) {
    if (cy < TRAY_Y - 6 || cy > TRAY_Y + TRAY_H + 6) return -1;
    const s = Math.floor(cx / SLOT_W);
    return (s >= 0 && s < NUM_SLOTS) ? s : -1;
  }

  canvas.addEventListener('pointerdown', e => {
    if (!running || flashLines || drag) return;
    e.preventDefault();
    const { cx, cy } = toCanvas(e);
    const slot = slotAtPoint(cx, cy);
    if (slot < 0 || tray[slot] === null) return;

    canvas.setPointerCapture(e.pointerId);
    const piece  = tray[slot];
    const cells  = SHAPES[piece.shapeIdx];
    const { snapRow, snapCol } = calcSnap(cells, cx, cy);
    drag = {
      slot, piece,
      pointerX: cx, pointerY: cy,
      snapRow, snapCol,
      valid: canPlace(cells, snapRow, snapCol),
    };
  });

  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    e.preventDefault();
    const { cx, cy } = toCanvas(e);
    drag.pointerX = cx;
    drag.pointerY = cy;
    const cells = SHAPES[drag.piece.shapeIdx];
    const { snapRow, snapCol } = calcSnap(cells, cx, cy);
    drag.snapRow = snapRow;
    drag.snapCol = snapCol;
    drag.valid   = canPlace(cells, snapRow, snapCol);
  });

  canvas.addEventListener('pointerup', e => {
    if (!drag) return;
    const { cx, cy } = toCanvas(e);
    const cells = SHAPES[drag.piece.shapeIdx];
    const { snapRow, snapCol } = calcSnap(cells, cx, cy);

    // Accept drop only when piece center is inside or just above the grid area
    const pieceCenterY = cy - LIFT_PX;
    const inGridArea = pieceCenterY > GRID_Y - CELL * 1.5;

    if (canPlace(cells, snapRow, snapCol) && inGridArea) {
      placePiece(drag.slot, snapRow, snapCol);
    }
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => { drag = null; });

  // ══════════════════════════════════════════════════════════════════════
  //  PLACEMENT & LINE CLEARING
  // ══════════════════════════════════════════════════════════════════════
  function placePiece(slot, gridR, gridC) {
    const { shapeIdx, colorIdx } = tray[slot];
    const cells = SHAPES[shapeIdx];

    for (const [dr, dc] of cells) board[gridR + dr][gridC + dc] = colorIdx;
    score     += cells.length * CELL_PTS;
    tray[slot] = null;

    // Find full rows and full columns
    const fullRows = [];
    for (let r = 0; r < ROWS; r++) {
      if (board[r].every(v => v !== -1)) fullRows.push(r);
    }
    const fullCols = [];
    for (let c = 0; c < COLS; c++) {
      let full = true;
      for (let r = 0; r < ROWS; r++) { if (board[r][c] === -1) { full = false; break; } }
      if (full) fullCols.push(c);
    }

    if (fullRows.length > 0 || fullCols.length > 0) {
      flashLines = { rows: fullRows, cols: fullCols };
      flashTimer = FLASH_MS;
      const n = fullRows.length + fullCols.length;
      if (n >= 2) GameAudio.score();
      else        GameAudio.eat();
    } else {
      GameAudio.beep({ frequency: 220, duration: 0.06, type: 'square', volume: 0.14 });
      afterPlacement();
    }

    updateHUD();
  }

  function resolveFlash() {
    const { rows, cols } = flashLines;
    flashLines = null;

    const n      = rows.length + cols.length;
    linesCleared += n;
    score        += n < LINE_BONUS.length ? LINE_BONUS[n] : LINE_BONUS[LINE_BONUS.length - 1];

    spawnLineParticles(rows, cols);

    const rowSet = new Set(rows);
    const colSet = new Set(cols);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (rowSet.has(r) || colSet.has(c)) board[r][c] = -1;

    updateHUD();
    afterPlacement();
  }

  /** Called after every piece placement (and after flash resolves). */
  function afterPlacement() {
    // Refill when all 3 tray slots are empty
    if (tray.every(p => p === null)) {
      tray = Array.from({ length: NUM_SLOTS }, randomPiece);
    }
    if (isGameOver()) doGameOver();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  PARTICLES
  // ══════════════════════════════════════════════════════════════════════
  function spawnLineParticles(rows, cols) {
    const rowSet = new Set(rows);
    const colSet = new Set(cols);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!rowSet.has(r) && !colSet.has(c)) continue;
        const ci    = board[r][c];
        const color = ci >= 0 ? COLORS[ci].fill : '#ffffff';
        for (let k = 0; k < 3; k++) {
          const angle = Math.random() * Math.PI * 2;
          const spd   = 1.2 + Math.random() * 2.5;
          particles.push({
            x: GRID_X + c * CELL + CELL / 2,
            y: GRID_Y + r * CELL + CELL / 2,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - 1,
            life: 1,
            decay: 0.022 + Math.random() * 0.028,
            radius: 1.5 + Math.random() * 2,
            color,
          });
        }
      }
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.1;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  HUD
  // ══════════════════════════════════════════════════════════════════════
  function updateHUD() {
    elScore.textContent = score;
    elHigh.textContent  = highScore;
    TowerLife.sendScore(score);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  GAME CONTROL
  // ══════════════════════════════════════════════════════════════════════
  function doStart() {
    if (!TowerLife.Credits.consume(doStart)) return;

    score        = 0;
    linesCleared = 0;
    flashLines   = null;
    drag         = null;
    particles.length = 0;
    lastTs       = performance.now();

    highScore = Save.load('blockmaster_hi', 0);
    board = Array.from({ length: ROWS }, () => new Array(COLS).fill(-1));
    tray  = Array.from({ length: NUM_SLOTS }, randomPiece);

    updateHUD();
    overlayStart.classList.add('hidden');
    overlayOver.classList.add('hidden');

    running = true;
    rafId   = requestAnimationFrame(loop);
  }

  function doGameOver() {
    running = false;
    cancelAnimationFrame(rafId);

    if (score > highScore) {
      highScore = score;
      Save.save('blockmaster_hi', highScore);
    }

    if (score >= 500)  Achievements.unlock('bm_500',  '500 Points');
    if (score >= 2000) Achievements.unlock('bm_2k',   '2 000 Points');
    if (score >= 5000) Achievements.unlock('bm_5k',   '5 000 Points');
    if (linesCleared >= 10) Achievements.unlock('bm_10l', '10 Lines Cleared');
    if (linesCleared >= 30) Achievements.unlock('bm_30l', '30 Lines Cleared');

    elFinalScore.textContent = score;
    elFinalHigh.textContent  = highScore;
    elFinalLines.textContent = linesCleared;

    overlayOver.classList.remove('hidden');
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

    if (flashLines) {
      flashTimer -= dt;
      if (flashTimer <= 0) resolveFlash();
    }

    updateParticles();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  RENDERING
  // ══════════════════════════════════════════════════════════════════════
  function draw() {
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, CW, CH);

    drawGrid();
    drawTray();
    if (drag) drawDragPiece();
    drawParticles();
  }

  function drawGrid() {
    // Board background
    ctx.fillStyle = '#0c0c1e';
    ctx.fillRect(GRID_X, GRID_Y, GRID_W, GRID_H);

    // Grid lines
    ctx.strokeStyle = '#13132b';
    ctx.lineWidth   = 0.5;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(GRID_X, GRID_Y + r * CELL);
      ctx.lineTo(GRID_X + GRID_W, GRID_Y + r * CELL);
      ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(GRID_X + c * CELL, GRID_Y);
      ctx.lineTo(GRID_X + c * CELL, GRID_Y + GRID_H);
      ctx.stroke();
    }

    // Flash state sets
    const flashRowSet = flashLines ? new Set(flashLines.rows) : null;
    const flashColSet = flashLines ? new Set(flashLines.cols) : null;

    // Drag preview: build set of grid keys (r * COLS + c) that would be filled
    let previewSet  = null;
    let previewValid = false;
    if (drag) {
      const cells = SHAPES[drag.piece.shapeIdx];
      previewSet   = new Set();
      previewValid = drag.valid;
      for (const [dr, dc] of cells) {
        const r = drag.snapRow + dr, c = drag.snapCol + dc;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) previewSet.add(r * COLS + c);
      }
    }

    // Draw board cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ci       = board[r][c];
        const isFlash  = flashLines && (flashRowSet.has(r) || flashColSet.has(c));
        const inPreview = previewSet && previewSet.has(r * COLS + c);

        if (ci !== -1) {
          if (isFlash) {
            // Alternating white flash
            const phase = 1 - flashTimer / FLASH_MS;
            if (Math.floor(phase * 8) % 2 === 0) {
              ctx.fillStyle   = '#ffffff';
              ctx.shadowColor = '#ffffff';
              ctx.shadowBlur  = 16;
              ctx.fillRect(GRID_X + c * CELL + 1, GRID_Y + r * CELL + 1, CELL - 2, CELL - 2);
              ctx.shadowBlur  = 0;
            } else {
              drawFilledCell(GRID_X + c * CELL, GRID_Y + r * CELL, ci);
            }
          } else {
            drawFilledCell(GRID_X + c * CELL, GRID_Y + r * CELL, ci);
          }
        } else if (inPreview) {
          const alpha = previewValid ? 0.50 : 0.20;
          const color = previewValid ? COLORS[drag.piece.colorIdx].fill : '#ff3366';
          ctx.globalAlpha = alpha;
          ctx.fillStyle   = color;
          if (previewValid) { ctx.shadowColor = color; ctx.shadowBlur = 6; }
          ctx.fillRect(GRID_X + c * CELL + 1, GRID_Y + r * CELL + 1, CELL - 2, CELL - 2);
          ctx.globalAlpha = 1;
          ctx.shadowBlur  = 0;
        }
      }
    }

    // Board border
    ctx.strokeStyle = '#1c1c40';
    ctx.lineWidth   = 2;
    ctx.strokeRect(GRID_X, GRID_Y, GRID_W, GRID_H);
  }

  function drawFilledCell(bx, by, colorIdx) {
    const { fill, dark } = COLORS[colorIdx];
    const x = bx + 1, y = by + 1, s = CELL - 2;
    ctx.fillStyle   = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur  = 5;
    ctx.fillRect(x, y, s, s);
    ctx.shadowBlur  = 0;
    // Top + left highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x, y, s, 3);
    ctx.fillRect(x, y, 3, s);
    // Bottom + right shadow bevel
    ctx.fillStyle = dark;
    ctx.fillRect(x,         y + s - 3, s, 3);
    ctx.fillRect(x + s - 3, y,         3, s);
  }

  function drawTrayCell(bx, by, colorIdx, cellSz) {
    const { fill, dark } = COLORS[colorIdx];
    const s = cellSz - 2;
    ctx.fillStyle   = fill;
    ctx.shadowColor = fill;
    ctx.shadowBlur  = 4;
    ctx.fillRect(bx, by, s, s);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.25)';
    ctx.fillRect(bx, by, s, 2);
    ctx.fillRect(bx, by, 2, s);
    ctx.fillStyle   = dark;
    ctx.fillRect(bx,         by + s - 2, s, 2);
    ctx.fillRect(bx + s - 2, by,         2, s);
  }

  function drawTray() {
    ctx.fillStyle = '#0c0c1e';
    ctx.fillRect(0, TRAY_Y, CW, TRAY_H);

    // Top separator
    ctx.strokeStyle = '#1c1c40';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, TRAY_Y);
    ctx.lineTo(CW, TRAY_Y);
    ctx.stroke();

    // Vertical slot dividers
    ctx.strokeStyle = '#13132b';
    for (let i = 1; i < NUM_SLOTS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * SLOT_W, TRAY_Y + 10);
      ctx.lineTo(i * SLOT_W, TRAY_Y + TRAY_H - 10);
      ctx.stroke();
    }

    for (let i = 0; i < NUM_SLOTS; i++) {
      if (tray[i] === null) continue;
      if (drag && drag.slot === i) continue; // hide the piece being dragged

      const piece  = tray[i];
      const canFit = pieceCanFitAnywhere(piece.shapeIdx);
      drawPieceInSlot(i, piece, TRAY_CELL, canFit ? 1 : 0.28);
    }
  }

  function drawPieceInSlot(slot, piece, cellSz, alpha) {
    const cells = SHAPES[piece.shapeIdx];
    const { h, w } = getBounds(cells);
    const slotCX = slot * SLOT_W + SLOT_W / 2;
    const slotCY = TRAY_Y + TRAY_H / 2;
    const ox = slotCX - (w * cellSz) / 2;
    const oy = slotCY - (h * cellSz) / 2;

    ctx.globalAlpha = alpha;
    for (const [dr, dc] of cells) {
      drawTrayCell(ox + dc * cellSz + 1, oy + dr * cellSz + 1, piece.colorIdx, cellSz);
    }
    ctx.globalAlpha = 1;
  }

  function drawDragPiece() {
    const cells = SHAPES[drag.piece.shapeIdx];
    const { h, w } = getBounds(cells);
    const { fill, dark } = COLORS[drag.piece.colorIdx];

    // Piece floats above the pointer
    const cx = drag.pointerX;
    const cy = drag.pointerY - LIFT_PX;
    const ox = cx - (w * CELL) / 2;
    const oy = cy - (h * CELL) / 2;

    for (const [dr, dc] of cells) {
      const bx = ox + dc * CELL, by = oy + dr * CELL;
      const x  = bx + 1, y = by + 1, s = CELL - 2;
      ctx.fillStyle   = fill;
      ctx.shadowColor = fill;
      ctx.shadowBlur  = 10;
      ctx.fillRect(x, y, s, s);
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, y, s, 3);
      ctx.fillRect(x, y, 3, s);
      ctx.fillStyle   = dark;
      ctx.fillRect(x,         y + s - 3, s, 3);
      ctx.fillRect(x + s - 3, y,         3, s);
    }
  }

  function drawParticles() {
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
  }

  // ══════════════════════════════════════════════════════════════════════
  //  BUTTON HANDLERS
  // ══════════════════════════════════════════════════════════════════════
  document.getElementById('btn-start').addEventListener('click', doStart);
  document.getElementById('btn-restart').addEventListener('click', doStart);
  document.getElementById('btn-mute').addEventListener('click', () => {
    GameAudio.setMuted(!GameAudio.isMuted());
    document.getElementById('btn-mute').textContent = GameAudio.isMuted() ? '🔇' : '🔊';
  });
  overlayStart.addEventListener('click', e => { if (e.target === overlayStart) doStart(); });
  overlayOver.addEventListener('click',  e => { if (e.target === overlayOver)  doStart(); });

  TowerLife.onGameReady('blockmaster');

})();
