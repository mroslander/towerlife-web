/**
 * froggy.js — Frogger / Crossy Road-clone "Froggy"
 *
 * Controls:
 *   Touch  : Swipe up / down / left / right to hop, or tap = hop forward.
 *   Desktop: Arrow keys / WASD
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas & Grid ─────────────────────────────────────────────────────
  const CELL = 45;         // px per grid cell
  const COLS = 8;          // grid columns
  const W    = CELL * COLS; // 360
  const H    = 580;

  // ── Camera ───────────────────────────────────────────────────────────
  // camRow = world row index at the TOP of the visible screen.
  // screenY of row R = (camRow - R) * CELL
  // Frog appears ~65 % down the screen when at its furthest row.
  const CAM_ROWS_ABOVE_FROG = 8;

  // ── Row types ────────────────────────────────────────────────────────
  const SAFE  = 0;
  const ROAD  = 1;
  const RIVER = 2;

  // ── Timing ───────────────────────────────────────────────────────────
  const HOP_FRAMES   = 7;  // frames per hop animation
  const DEATH_FRAMES = 55; // frames of death animation before game-over

  // ── Difficulty ───────────────────────────────────────────────────────
  // score = world rows reached.  Difficulty snaps at each threshold.
  // carSpd: [min, max] px / frame   numCars: cars per road lane
  // logSpd: [min, max] px / frame   logW: [min, max] log width in cells
  const DIFF = [
    { score:   0, carSpd:[1.0,2.0], numCars:3, logSpd:[0.9,1.6], logW:[2,4] },
    { score:  12, carSpd:[1.4,2.5], numCars:3, logSpd:[1.1,2.0], logW:[2,3] },
    { score:  28, carSpd:[1.8,3.2], numCars:4, logSpd:[1.4,2.4], logW:[2,3] },
    { score:  50, carSpd:[2.4,4.0], numCars:4, logSpd:[1.8,3.0], logW:[1,3] },
    { score:  80, carSpd:[3.2,5.2], numCars:5, logSpd:[2.2,3.6], logW:[1,2] },
    { score: 120, carSpd:[4.0,6.5], numCars:5, logSpd:[2.8,4.5], logW:[1,2] },
  ];

  function getDiff(sc) {
    let d = DIFF[0];
    for (let i = 1; i < DIFF.length; i++) {
      if (sc >= DIFF[i].score) d = DIFF[i]; else break;
    }
    return d;
  }

  // ── Palette ───────────────────────────────────────────────────────────
  const C_GRASS_A  = '#1b3d0a';
  const C_GRASS_B  = '#204e0d';
  const C_ROAD_A   = '#252525';
  const C_ROAD_B   = '#1d1d1d';
  const C_DASH     = '#3a3a3a';
  const C_WATER_A  = '#0a1e3a';
  const C_WATER_B  = '#0c2650';
  const C_LOG      = '#7a4a12';
  const C_LOG_RING = '#9e6318';
  const C_FROG     = '#22e050';
  const C_FROG_D   = '#0e9a36';
  const CAR_COLS   = ['#ff2244','#ffaa00','#00aaff','#ff44bb','#44ffcc','#ffee22','#ff6600'];

  // ── State ─────────────────────────────────────────────────────────────
  let canvas, ctx;
  let state;        // 'idle' | 'playing' | 'over'
  let score, highScore;
  let raf;

  // Frog
  let frog;
  // {
  //   row, col         : integer grid position (updated at hop start)
  //   pixelX           : X in pixels (drifts on logs, set at hop start)
  //   fromRow, fromCol : grid position at hop animation start
  //   fromPixelX       : X in pixels at hop animation start
  //   hopProg          : 0..1 animation progress
  //   hopping          : bool
  //   dir              : 'up' | 'down' | 'left' | 'right'
  //   dead, deadTimer  : death state
  // }

  // World
  let worldRows;    // Map<int, rowData>
  let genGroups;    // Array<{type, startRow, endRow}>
  let camRow;       // animated float — world row at top of screen
  let camRowTarget; // target camRow (only ever increases)

  // Particles
  let particles;

  // Input
  let swipeStart;   // {x, y} | null
  let inputQueue;   // queued {dr,dc} hops

  // ── Utilities ──────────────────────────────────────────────────────────
  const rand  = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp  = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - (1 - t) * (1 - t);

  // ── Canvas setup ──────────────────────────────────────────────────────
  function setupCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');

    function resize() {
      const hud   = document.getElementById('hud');
      const hudH  = hud ? hud.getBoundingClientRect().height + 8 : 40;
      const avail = window.innerHeight - hudH - 16;
      const scale = Math.min(window.innerWidth / W, avail / H, 2);
      canvas.width  = W;
      canvas.height = H;
      canvas.style.width  = Math.floor(W * scale) + 'px';
      canvas.style.height = Math.floor(H * scale) + 'px';
      const wrap = document.getElementById('canvas-wrapper');
      if (wrap) { wrap.style.width = canvas.style.width; wrap.style.height = canvas.style.height; }
    }

    window.addEventListener('resize', resize);
    resize();
  }

  // ── World generation ───────────────────────────────────────────────────
  // Groups are contiguous bands of the same row type.

  function initWorld() {
    worldRows = new Map();
    genGroups = [{ type: SAFE, startRow: 0, endRow: 2 }];
    expandGroups(CAM_ROWS_ABOVE_FROG + 5);
  }

  function expandGroups(upToRow) {
    while (genGroups[genGroups.length - 1].endRow < upToRow) {
      const last      = genGroups[genGroups.length - 1];
      const nextStart = last.endRow + 1;
      let nextType, nextLen;

      if (last.type === SAFE) {
        // Alternate ROAD / RIVER groups
        const prevLanes = genGroups.filter(g => g.type !== SAFE);
        const lastLane  = prevLanes.length > 0 ? prevLanes[prevLanes.length - 1].type : ROAD;
        nextType = lastLane === ROAD ? RIVER : ROAD;
        nextLen  = randi(2, 5);
      } else {
        nextType = SAFE;
        nextLen  = randi(1, 2);
      }

      genGroups.push({ type: nextType, startRow: nextStart, endRow: nextStart + nextLen - 1 });
    }
  }

  function getGroupForRow(rowIdx) {
    expandGroups(rowIdx + 6);
    return genGroups.find(g => rowIdx >= g.startRow && rowIdx <= g.endRow);
  }

  function getOrMakeRow(rowIdx) {
    if (worldRows.has(rowIdx)) return worldRows.get(rowIdx);
    const group = getGroupForRow(rowIdx);
    const row   = buildRow(rowIdx, group);
    worldRows.set(rowIdx, row);
    return row;
  }

  function buildRow(rowIdx, group) {
    const d   = getDiff(score);
    const row = { idx: rowIdx, type: group.type, objects: [] };

    if (group.type === ROAD) {
      row.dir   = (rowIdx - group.startRow) % 2 === 0 ? 1 : -1; // alternating
      row.shade = rowIdx % 2 === 0;
      row.objects = buildCars(row.dir, d);
    } else if (group.type === RIVER) {
      row.dir   = (rowIdx - group.startRow) % 2 === 0 ? 1 : -1;
      row.shade = rowIdx % 2 === 0;
      row.objects = buildLogs(row.dir, d);
    }
    // SAFE: no objects

    return row;
  }

  function buildCars(dir, d) {
    const cars  = [];
    const speed = rand(d.carSpd[0], d.carSpd[1]) * dir;
    const n     = d.numCars;
    const slot  = W / n;

    for (let i = 0; i < n; i++) {
      const cw    = CELL * randi(1, 2) - 4;
      const baseX = i * slot + rand(2, slot - cw - 2);
      cars.push({
        x:     clamp(baseX, 0, W - cw),
        w:     cw,
        speed,
        color: CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)],
      });
    }
    return cars;
  }

  function buildLogs(dir, d) {
    const logs  = [];
    const speed = rand(d.logSpd[0], d.logSpd[1]) * dir;

    let x = rand(0, CELL * 0.6);
    while (x < W + CELL) {
      const cells = randi(d.logW[0], d.logW[1]);
      const lw    = cells * CELL - 4;
      logs.push({ x, w: lw, speed });
      x += lw + rand(CELL * 0.6, CELL * 2.2);
    }
    return logs;
  }

  // ── Game init ──────────────────────────────────────────────────────────
  function initGame() {
    initWorld();
    score      = 0;
    particles  = [];
    swipeStart = null;
    inputQueue = [];

    const startCol = Math.floor(COLS / 2);
    frog = {
      row:        0, col:        startCol,
      pixelX:     startCol * CELL + CELL / 2,
      fromRow:    0, fromCol:    startCol,
      fromPixelX: startCol * CELL + CELL / 2,
      hopProg:    1,  hopping: false,
      dir:        'up',
      dead:       false, deadTimer: 0,
    };

    camRowTarget = CAM_ROWS_ABOVE_FROG;
    camRow       = camRowTarget;

    // Pre-generate visible rows
    for (let r = 0; r <= camRowTarget + 3; r++) getOrMakeRow(r);

    UI.setScore('score',      0);
    UI.setScore('high-score', highScore);
    TowerLife.onGameReady('froggy');
  }

  // ── Hop ────────────────────────────────────────────────────────────────
  function tryHop(dr, dc) {
    if (frog.dead) return;
    if (frog.hopping) {
      if (inputQueue.length < 1) inputQueue.push({ dr, dc });
      return;
    }
    doHop(dr, dc);
  }

  function doHop(dr, dc) {
    const newRow = frog.row + dr;
    const newCol = clamp(frog.col + dc, 0, COLS - 1);
    if (newRow < 0) return;

    if      (dr > 0) frog.dir = 'up';
    else if (dr < 0) frog.dir = 'down';
    else if (dc < 0) frog.dir = 'left';
    else             frog.dir = 'right';

    frog.fromRow    = frog.row;
    frog.fromCol    = frog.col;
    frog.fromPixelX = frog.pixelX;

    frog.row    = newRow;
    frog.col    = newCol;
    frog.pixelX = newCol * CELL + CELL / 2;
    frog.hopProg = 0;
    frog.hopping = true;

    // Score update — only on new forward rows
    if (dr > 0 && frog.row > score) {
      score = frog.row;
      if (score > highScore) {
        highScore = score;
        Save.save('froggy_best', highScore);
      }
      UI.setScore('score',      score);
      UI.setScore('high-score', highScore);
      TowerLife.sendScore(score);

      if (score % 10 === 0) GameAudio.score();

      const target = frog.row + CAM_ROWS_ABOVE_FROG;
      if (target > camRowTarget) camRowTarget = target;
    }

    // Pre-generate rows ahead
    for (let r = frog.row; r <= frog.row + CAM_ROWS_ABOVE_FROG + 4; r++) getOrMakeRow(r);

    GameAudio.beep({ frequency: 380 + (dr > 0 ? 120 : 0), duration: 0.06, type: 'square', volume: 0.18 });
  }

  // ── Update ─────────────────────────────────────────────────────────────
  function update() {
    if (state !== 'playing') return;

    // Smooth camera follow
    camRow += (camRowTarget - camRow) * 0.12;

    // Move all obstacles
    for (const row of worldRows.values()) {
      if (row.type === ROAD || row.type === RIVER) {
        for (const obj of row.objects) {
          obj.x += obj.speed;
          // Wrap horizontally
          if (obj.speed > 0 && obj.x > W + obj.w + CELL)    obj.x = -(obj.w + CELL);
          if (obj.speed < 0 && obj.x < -(obj.w + CELL * 2)) obj.x = W + CELL;
        }
      }
    }

    // Hop animation
    if (frog.hopping) {
      frog.hopProg = Math.min(1, frog.hopProg + 1 / HOP_FRAMES);
      if (frog.hopProg >= 1) {
        frog.hopping = false;
        frog.pixelX  = frog.col * CELL + CELL / 2;
        onLanded();
      }
    }

    if (!frog.hopping && !frog.dead) {
      const row = worldRows.get(frog.row);

      // River: drift with log
      if (row && row.type === RIVER) {
        const log = findLog(row, frog.pixelX);
        if (log) {
          frog.pixelX += log.speed;
          frog.col     = Math.round((frog.pixelX - CELL / 2) / CELL);
          if (frog.pixelX < CELL * 0.3 || frog.pixelX > W - CELL * 0.3) die('water');
        } else {
          die('water');
        }
      }

      // Road: continuous car collision
      if (!frog.dead && row && row.type === ROAD) {
        for (const car of row.objects) {
          if (carHits(car, frog.pixelX)) { die('car'); break; }
        }
      }

      // Camera crush: frog pushed below visible area
      if (!frog.dead && frogScreenY() > H + CELL) die('fall');

      // Flush input queue
      if (!frog.dead && inputQueue.length > 0) {
        const next = inputQueue.shift();
        doHop(next.dr, next.dc);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;  p.y += p.vy;  p.vy += 0.18;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Death countdown
    if (frog.dead) {
      frog.deadTimer--;
      if (frog.deadTimer <= 0) doGameOver();
    }
  }

  function onLanded() {
    const row = worldRows.get(frog.row);
    if (!row) return;
    if (row.type === RIVER && !findLog(row, frog.pixelX)) die('water');
  }

  function findLog(row, x) {
    for (const log of row.objects) {
      if (x >= log.x + 3 && x <= log.x + log.w - 3) return log;
    }
    return null;
  }

  function carHits(car, fx) {
    const half = CELL * 0.3;
    return fx + half > car.x + 3 && fx - half < car.x + car.w - 3;
  }

  // ── Death ──────────────────────────────────────────────────────────────
  function die(cause) {
    if (frog.dead) return;
    frog.dead      = true;
    frog.deadTimer = DEATH_FRAMES;

    const sx = frogScreenX();
    const sy = frogScreenY();

    if (cause === 'water') {
      GameAudio.beep({ frequency: 200, duration: 0.32, type: 'sine',     volume: 0.30 });
      burst(sx, sy, '#44aaff', 14);
      burst(sx, sy, '#aaddff',  7);
    } else {
      GameAudio.die();
      burst(sx, sy, '#ff4422', 16);
      burst(sx, sy, '#ffaa00',  8);
    }
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(1.5, 5.0);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
        life: 1, decay: rand(0.025, 0.06), r: rand(2, 6), color });
    }
  }

  // ── Game over ──────────────────────────────────────────────────────────
  function doGameOver() {
    state = 'over';
    cancelAnimationFrame(raf);
    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    UI.showOverlay('overlay-over');
    TowerLife.onGameOver(score);
  }

  // ── Screen-space helpers ──────────────────────────────────────────────
  function rowTopY(worldRow) { return (camRow - worldRow) * CELL; }

  function frogScreenX() {
    if (frog.hopping) {
      const t = easeOut(frog.hopProg);
      return lerp(frog.fromPixelX, frog.col * CELL + CELL / 2, t);
    }
    return frog.pixelX;
  }

  function frogScreenY() {
    if (frog.hopping) {
      const t   = easeOut(frog.hopProg);
      const row = lerp(frog.fromRow, frog.row, t);
      const base = (camRow - row) * CELL + CELL / 2;
      const dr  = frog.row - frog.fromRow;
      const arc = Math.abs(dr) > 0 ? CELL * 0.46 : CELL * 0.20;
      return base - Math.sin(frog.hopProg * Math.PI) * arc;
    }
    return rowTopY(frog.row) + CELL / 2;
  }

  // ── Draw ───────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Void background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Draw rows in visible range (bottom to top)
    const loRow = Math.floor(camRow - H / CELL) - 1;
    const hiRow = Math.ceil(camRow) + 1;
    for (let r = loRow; r <= hiRow; r++) {
      if (r < 0) continue;
      const row = worldRows.get(r);
      if (row) drawRow(row);
    }

    // Frog (flicker during death)
    if (!frog.dead || Math.floor(frog.deadTimer / 5) % 2 === 0) {
      const sx = frogScreenX(), sy = frogScreenY();
      drawFrogShadow(sx);
      drawFrog(sx, sy);
    }

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRow(row) {
    const sy = rowTopY(row.idx);
    if (sy + CELL < -1 || sy > H + 1) return; // off-screen

    if (row.type === SAFE) {
      ctx.fillStyle = row.idx % 2 === 0 ? C_GRASS_A : C_GRASS_B;
      ctx.fillRect(0, sy, W, CELL);
      // Subtle checkerboard tint
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      for (let c = 0; c < COLS; c++) {
        if ((c + row.idx) % 2 === 0) ctx.fillRect(c * CELL, sy, CELL, CELL);
      }

    } else if (row.type === ROAD) {
      ctx.fillStyle = row.shade ? C_ROAD_A : C_ROAD_B;
      ctx.fillRect(0, sy, W, CELL);
      // Centre dashed line
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = C_DASH;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, sy + CELL / 2);
      ctx.lineTo(W, sy + CELL / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Cars
      for (const car of row.objects) drawCar(car, sy + CELL / 2, row.dir);

    } else { // RIVER
      ctx.fillStyle = row.shade ? C_WATER_A : C_WATER_B;
      ctx.fillRect(0, sy, W, CELL);
      // Water shimmer band
      ctx.fillStyle = 'rgba(100,180,255,0.06)';
      ctx.fillRect(0, sy + CELL * 0.22, W, CELL * 0.22);
      // Logs
      for (const log of row.objects) drawLog(log, sy + CELL / 2);
    }
  }

  function drawCar(car, cy, dir) {
    const cx  = car.x;
    const cw  = car.w;
    const ch  = Math.round(CELL * 0.72);
    const top = Math.round(cy - ch / 2);
    const r   = Math.min(5, cw / 4);

    // Body
    ctx.fillStyle = car.color;
    rrect(cx, top, cw, ch, r);
    ctx.fill();

    // Windows (dark)
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const ww = Math.min(cw * 0.27, 17);
    const wh = ch * 0.36;
    ctx.fillRect(cx + 4, top + ch * 0.18, ww, wh);
    ctx.fillRect(cx + cw - ww - 4, top + ch * 0.18, ww, wh);

    // Headlights / taillights
    const frontX = dir > 0 ? cx + cw - 3 : cx;
    const rearX  = dir > 0 ? cx           : cx + cw - 3;
    ctx.fillStyle = '#ffffcc';
    ctx.fillRect(frontX, top + ch * 0.12, 3, ch * 0.26);
    ctx.fillRect(frontX, top + ch * 0.62, 3, ch * 0.26);
    ctx.fillStyle = '#ff3322';
    ctx.fillRect(rearX,  top + ch * 0.12, 3, ch * 0.26);
    ctx.fillRect(rearX,  top + ch * 0.62, 3, ch * 0.26);

    // Wheels (4 corners, bird's-eye)
    ctx.fillStyle = '#111';
    const wr = ch * 0.20;
    ctx.beginPath(); ctx.arc(cx + cw * 0.18, top,      wr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + cw * 0.82, top,      wr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + cw * 0.18, top + ch, wr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + cw * 0.82, top + ch, wr, 0, Math.PI * 2); ctx.fill();
  }

  function drawLog(log, cy) {
    const lx  = log.x;
    const lw  = log.w;
    const lh  = Math.round(CELL * 0.70);
    const top = Math.round(cy - lh / 2);

    ctx.fillStyle = C_LOG;
    rrect(lx, top, lw, lh, 7);
    ctx.fill();

    // End-caps (lighter wood ring)
    ctx.fillStyle = C_LOG_RING;
    ctx.fillRect(lx,          top, 7, lh);
    ctx.fillRect(lx + lw - 7, top, 7, lh);

    // Grain lines
    ctx.strokeStyle = C_LOG_RING;
    ctx.lineWidth   = 1.5;
    for (let gx = lx + 18; gx < lx + lw - 9; gx += 18) {
      ctx.beginPath();
      ctx.moveTo(gx, top + 3);
      ctx.lineTo(gx, top + lh - 3);
      ctx.stroke();
    }
  }

  function drawFrogShadow(sx) {
    const groundY = rowTopY(frog.row) + CELL * 0.85;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(sx + 2, groundY, CELL * 0.26, CELL * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFrog(sx, sy) {
    const s = CELL * 0.84;

    // Body
    ctx.fillStyle = C_FROG;
    ctx.beginPath();
    ctx.ellipse(sx, sy, s * 0.38, s * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly
    ctx.fillStyle = C_FROG_D;
    ctx.beginPath();
    ctx.ellipse(sx, sy + s * 0.07, s * 0.22, s * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye bulges (on top of head)
    const eOff = s * 0.19;
    const eR   = s * 0.11;
    ctx.fillStyle = C_FROG;
    ctx.beginPath(); ctx.arc(sx - eOff, sy - s * 0.26, eR * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + eOff, sy - s * 0.26, eR * 1.4, 0, Math.PI * 2); ctx.fill();

    // Eye whites
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(sx - eOff, sy - s * 0.26, eR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + eOff, sy - s * 0.26, eR, 0, Math.PI * 2); ctx.fill();

    // Pupils (shift toward facing direction)
    const pdx = frog.dir === 'left' ? -1.5 : frog.dir === 'right' ? 1.5 : 0.5;
    ctx.fillStyle = '#111111';
    ctx.beginPath(); ctx.arc(sx - eOff + pdx, sy - s * 0.26, eR * 0.54, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + eOff + pdx, sy - s * 0.26, eR * 0.54, 0, Math.PI * 2); ctx.fill();

    // Legs
    ctx.strokeStyle = C_FROG;
    ctx.lineWidth   = 3.5;
    ctx.lineCap     = 'round';
    if (frog.hopping) {
      // Front legs up
      ctx.beginPath(); ctx.moveTo(sx - s * 0.30, sy + s * 0.04); ctx.lineTo(sx - s * 0.52, sy - s * 0.22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + s * 0.30, sy + s * 0.04); ctx.lineTo(sx + s * 0.52, sy - s * 0.22); ctx.stroke();
      // Back legs spread
      ctx.beginPath(); ctx.moveTo(sx - s * 0.25, sy + s * 0.18); ctx.lineTo(sx - s * 0.55, sy + s * 0.42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + s * 0.25, sy + s * 0.18); ctx.lineTo(sx + s * 0.55, sy + s * 0.42); ctx.stroke();
    } else {
      // Legs folded at sides
      ctx.beginPath(); ctx.moveTo(sx - s * 0.30, sy + s * 0.07); ctx.lineTo(sx - s * 0.52, sy + s * 0.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + s * 0.30, sy + s * 0.07); ctx.lineTo(sx + s * 0.52, sy + s * 0.28); ctx.stroke();
    }
  }

  // ── Rounded-rect path helper ──────────────────────────────────────────
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Input ─────────────────────────────────────────────────────────────
  function setupInput() {
    // Keyboard
    window.addEventListener('keydown', e => {
      if (state === 'idle') { if (e.key === 'Enter' || e.key === ' ') startGame(); return; }
      if (state === 'over') { if (e.key === 'Enter' || e.key === ' ') restartGame(); return; }
      if (state !== 'playing') return;
      switch (e.key) {
        case 'ArrowUp':    case 'w': case 'W': e.preventDefault(); tryHop( 1,  0); break;
        case 'ArrowDown':  case 's': case 'S': e.preventDefault(); tryHop(-1,  0); break;
        case 'ArrowLeft':  case 'a': case 'A': e.preventDefault(); tryHop( 0, -1); break;
        case 'ArrowRight': case 'd': case 'D': e.preventDefault(); tryHop( 0,  1); break;
      }
    });

    // Touch swipe / tap
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      if (state === 'idle') { startGame();   return; }
      if (state === 'over') { restartGame(); return; }
      const t = e.changedTouches[0];
      swipeStart = { x: t.clientX, y: t.clientY };
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      if (state !== 'playing' || !swipeStart) return;
      const t  = e.changedTouches[0];
      const dx = t.clientX - swipeStart.x;
      const dy = t.clientY - swipeStart.y;
      swipeStart = null;

      const SWIPE_MIN = 18; // px threshold
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) {
        tryHop(1, 0); // tap = hop forward
        return;
      }
      if (Math.abs(dx) >= Math.abs(dy)) {
        tryHop(0, dx > 0 ? 1 : -1);
      } else {
        tryHop(dy < 0 ? 1 : -1, 0); // swipe up → hop forward
      }
    }, { passive: false });
  }

  // ── Game flow ─────────────────────────────────────────────────────────
  function startGame() {
    if (!TowerLife.Credits.consume(startGame)) return;
    UI.hideOverlay('overlay-start');
    state = 'playing';
    initGame();
    raf = requestAnimationFrame(loop);
  }

  function restartGame() {
    if (!TowerLife.Credits.consume(restartGame)) return;
    UI.hideOverlay('overlay-over');
    state = 'playing';
    initGame();
    raf = requestAnimationFrame(loop);
  }

  // ── Main loop ─────────────────────────────────────────────────────────
  function loop() {
    update();
    draw();
    if (state === 'playing') raf = requestAnimationFrame(loop);
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    setupCanvas();
    setupInput();

    highScore = Save.load('froggy_best', 0);
    UI.setScore('score',      0);
    UI.setScore('high-score', highScore);

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', restartGame);
    document.getElementById('btn-mute').addEventListener('click', () => {
      const muted = !GameAudio.isMuted();
      GameAudio.setMuted(muted);
      document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
    });

    TowerLife.onMessage(msg => {
      if (msg.type === 'PAUSE'  && state === 'playing') cancelAnimationFrame(raf);
      if (msg.type === 'RESUME' && state === 'playing') { raf = requestAnimationFrame(loop); }
      if (msg.type === 'MUTE')  GameAudio.setMuted(msg.muted);
    });

    // Draw idle preview under the start overlay
    state      = 'idle';
    score      = 0;
    particles  = [];
    initWorld();
    camRow     = CAM_ROWS_ABOVE_FROG;
    camRowTarget = camRow;
    for (let r = 0; r <= camRow + 2; r++) getOrMakeRow(r);
    const mc = Math.floor(COLS / 2);
    frog = {
      row: 0, col: mc, pixelX: mc * CELL + CELL / 2,
      fromRow: 0, fromCol: mc, fromPixelX: mc * CELL + CELL / 2,
      hopProg: 1, hopping: false, dir: 'up', dead: false, deadTimer: 0,
    };
    draw();
  });
})();
