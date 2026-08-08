/**
 * jewelrumble.js — Bejeweled-clone arcade game
 *
 * Swap adjacent gems to match 3 or more.  A continuously burning timer keeps
 * the pressure on — it speeds up over time, and every successful match buys
 * back seconds proportional to how many gems were removed.
 *
 * Depends on (loaded via index.html):
 *   save.js · towerlife.js · audio.js · achievements.js · ui.js
 */
(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────
  const COLS      = 8;
  const ROWS      = 8;
  const CELL      = 43;
  const PAD       = 4;
  const CW        = COLS * CELL + PAD * 2;   // 352 px
  const CH        = ROWS * CELL + PAD * 2;   // 352 px
  const GEM_R     = CELL * 0.41;

  const GEM_TYPES  = 6;
  const START_TIME = 30;    // seconds at game start
  const MAX_TIME   = 60;    // timer cap (bumps cannot exceed this)
  const BURN_INC   = 0.025; // burnSpeed grows this much per elapsed real second

  // Animation durations in frames (~60 fps)
  const F_SWAP  = 10;
  const F_MATCH = 18;
  const F_DROP  = 20;
  const F_FILL  = 15;

  const GEM_COLORS = [
    '#ff3366', // 0 red    – diamond
    '#3399ff', // 1 blue   – circle
    '#33ff99', // 2 green  – square
    '#ffcc00', // 3 yellow – triangle
    '#cc33ff', // 4 purple – hexagon
    '#ff9900', // 5 orange – 4-point star
  ];

  // ── Canvas ────────────────────────────────────────────────────
  const canvas  = document.getElementById('game-canvas');
  const ctx     = canvas.getContext('2d');
  canvas.width  = CW;
  canvas.height = CH;

  // ── DOM refs ──────────────────────────────────────────────────
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

  // ── Game state ────────────────────────────────────────────────
  let grid        = [];
  let score       = 0;
  let highScore   = 0;
  let timeLeft    = START_TIME;
  let burnSpeed   = 1.0;
  let gameElapsed = 0;   // total real seconds elapsed this game

  let running = false;
  let paused  = false;
  let rafId   = null;
  let lastTs  = 0;

  // ── Phase machine ─────────────────────────────────────────────
  let phase    = 'idle';   // idle | swap | unswap | match | drop | fill
  let phaseT   = 0;

  let selected = null;
  let swapA    = null;
  let swapB    = null;
  let matchSet = [];
  let dropList = [];
  let fillList = [];
  let cascade  = 0;

  const particles = [];

  // ── Grid helpers ──────────────────────────────────────────────
  function gemAt(r, c) {
    return (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? grid[r][c] : -1;
  }

  function rnd(n) { return Math.floor(Math.random() * n); }

  // ── Grid initialisation ───────────────────────────────────────
  function initGrid() {
    grid = Array.from({length: ROWS}, () => new Array(COLS).fill(0));
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        grid[r][c] = safeRandom(r, c);
    if (!hasValidMove()) shuffleGrid();
  }

  function safeRandom(r, c) {
    let type, tries = 0;
    do { type = rnd(GEM_TYPES); tries++; }
    while (tries < 15 && wouldMatch(r, c, type));
    return type;
  }

  function wouldMatch(r, c, t) {
    return (gemAt(r, c - 1) === t && gemAt(r, c - 2) === t) ||
           (gemAt(r - 1, c) === t && gemAt(r - 2, c) === t);
  }

  // ── Match detection ───────────────────────────────────────────
  function findMatches() {
    const matched = new Set();
    for (let r = 0; r < ROWS; r++) {
      let run = 1;
      for (let c = 1; c <= COLS; c++) {
        if (c < COLS && grid[r][c] !== -1 && grid[r][c] === grid[r][c - 1]) {
          run++;
        } else {
          if (run >= 3) for (let i = c - run; i < c; i++) matched.add(r * COLS + i);
          run = 1;
        }
      }
    }
    for (let c = 0; c < COLS; c++) {
      let run = 1;
      for (let r = 1; r <= ROWS; r++) {
        if (r < ROWS && grid[r][c] !== -1 && grid[r][c] === grid[r - 1][c]) {
          run++;
        } else {
          if (run >= 3) for (let i = r - run; i < r; i++) matched.add(i * COLS + c);
          run = 1;
        }
      }
    }
    return Array.from(matched).map(k => ({ r: (k / COLS) | 0, c: k % COLS }));
  }

  // ── Gem physics ───────────────────────────────────────────────
  function doSwap(r1, c1, r2, c2) {
    const tmp = grid[r1][c1];
    grid[r1][c1] = grid[r2][c2];
    grid[r2][c2] = tmp;
  }

  function dropGems() {
    const drops = [];
    for (let c = 0; c < COLS; c++) {
      let writeR = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (grid[r][c] !== -1) {
          if (r !== writeR) {
            drops.push({ r: writeR, c, fromR: r });
            grid[writeR][c] = grid[r][c];
            grid[r][c] = -1;
          }
          writeR--;
        }
      }
    }
    return drops;
  }

  function fillEmpty() {
    const newGems = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c] === -1) { grid[r][c] = rnd(GEM_TYPES); newGems.push({ r, c }); }
    return newGems;
  }

  function hasValidMove() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c + 1 < COLS) {
          doSwap(r, c, r, c + 1);
          const ok = findMatches().length > 0;
          doSwap(r, c, r, c + 1);
          if (ok) return true;
        }
        if (r + 1 < ROWS) {
          doSwap(r, c, r + 1, c);
          const ok = findMatches().length > 0;
          doSwap(r, c, r + 1, c);
          if (ok) return true;
        }
      }
    }
    return false;
  }

  function shuffleGrid() {
    let attempts = 0;
    do {
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          grid[r][c] = rnd(GEM_TYPES);
      let m, limit = 100;
      while ((m = findMatches()).length > 0 && limit-- > 0)
        for (const { r, c } of m) grid[r][c] = rnd(GEM_TYPES);
      attempts++;
    } while (!hasValidMove() && attempts < 10);
  }

  // ── Timer bump ────────────────────────────────────────────────
  // 3 gems +3 s · 4 gems +6 s · 5 gems +10 s · 6+ gems +14 s
  // Each cascade level beyond the first adds +3 s bonus.
  function timerBump(count, cascadeN) {
    const base  = count >= 6 ? 14 : count === 5 ? 10 : count === 4 ? 6 : 3;
    const bonus = (cascadeN - 1) * 3;
    timeLeft = Math.min(timeLeft + base + bonus, MAX_TIME);
  }

  // ── Scoring ───────────────────────────────────────────────────
  function calcPoints(count, cascadeN) {
    const base = count >= 5 ? 200 : count === 4 ? 120 : 60;
    return Math.round(base * count * (0.5 + burnSpeed * 0.5) * (1 + (cascadeN - 1) * 0.5));
  }

  // ── Phase transitions ─────────────────────────────────────────
  function beginSwap(a, b) {
    swapA = a; swapB = b;
    selected = null;
    phase = 'swap'; phaseT = F_SWAP;
  }

  function onPhaseEnd() {
    if (phase === 'swap') {
      doSwap(swapA.r, swapA.c, swapB.r, swapB.c);
      matchSet = findMatches();
      if (matchSet.length > 0) {
        cascade = 1; phase = 'match'; phaseT = F_MATCH;
        GameAudio.eat();
      } else {
        phase = 'unswap'; phaseT = F_SWAP;
      }

    } else if (phase === 'unswap') {
      doSwap(swapA.r, swapA.c, swapB.r, swapB.c);
      swapA = swapB = null; phase = 'idle';

    } else if (phase === 'match') {
      const pts = calcPoints(matchSet.length, cascade);
      score += pts;
      timerBump(matchSet.length, cascade);
      spawnMatchParticles(matchSet, pts);
      for (const { r, c } of matchSet) grid[r][c] = -1;
      matchSet = [];
      updateHUD();
      dropList = dropGems();
      phase = 'drop'; phaseT = dropList.length > 0 ? F_DROP : 1;

    } else if (phase === 'drop') {
      dropList = [];
      fillList = fillEmpty();
      phase = 'fill'; phaseT = fillList.length > 0 ? F_FILL : 1;

    } else if (phase === 'fill') {
      fillList = [];
      matchSet = findMatches();
      if (matchSet.length > 0) {
        cascade++;
        phase = 'match'; phaseT = F_MATCH;
        GameAudio.eat();
        if (cascade >= 3) GameAudio.score();
      } else {
        cascade = 0; swapA = swapB = null;
        if (!hasValidMove()) shuffleGrid();
        phase = 'idle';
      }
    }
  }

  // ── Particles ─────────────────────────────────────────────────
  function spawnMatchParticles(cells, pts) {
    if (pts < 120) return;
    for (const { r, c } of cells) {
      const cx    = PAD + c * CELL + CELL / 2;
      const cy    = PAD + r * CELL + CELL / 2;
      const color = GEM_COLORS[grid[r][c]] || '#ffffff';
      for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 2.5;
        particles.push({ x: cx, y: cy,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: 1, decay: 0.04 + Math.random() * 0.04,
          r: 2 + Math.random() * 2, color });
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

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // ── Input ─────────────────────────────────────────────────────
  let ptrStart = null;

  function pointerCell(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    const x  = (e.clientX - rect.left) * sx - PAD;
    const y  = (e.clientY - rect.top)  * sy - PAD;
    const c  = (x / CELL) | 0;
    const r  = (y / CELL) | 0;
    return (r >= 0 && r < ROWS && c >= 0 && c < COLS) ? { r, c } : null;
  }

  function pointerPx(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width  / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top)  * sy,
    };
  }

  canvas.addEventListener('pointerdown', e => {
    if (!running || paused || phase !== 'idle') return;
    const cell = pointerCell(e);
    if (!cell) return;
    const px = pointerPx(e);
    ptrStart = { r: cell.r, c: cell.c, px: px.x, py: px.y };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', e => {
    if (!running || paused || phase !== 'idle' || !ptrStart) return;
    const px = pointerPx(e);
    const dx = px.x - ptrStart.px;
    const dy = px.y - ptrStart.py;
    if (Math.abs(dx) < CELL / 2 && Math.abs(dy) < CELL / 2) return;
    // Determine dominant direction and derive target cell
    let dr = 0, dc = 0;
    if (Math.abs(dx) >= Math.abs(dy)) { dc = dx > 0 ? 1 : -1; }
    else                              { dr = dy > 0 ? 1 : -1; }
    const target = { r: ptrStart.r + dr, c: ptrStart.c + dc };
    if (target.r >= 0 && target.r < ROWS && target.c >= 0 && target.c < COLS) {
      selected = null;
      beginSwap(ptrStart, target);
    }
    ptrStart = null;
  });

  canvas.addEventListener('pointerup', e => {
    if (!running || paused || phase !== 'idle' || !ptrStart) return;
    const cell = pointerCell(e);
    if (!cell) { ptrStart = null; return; }

    const sameTap = cell.r === ptrStart.r && cell.c === ptrStart.c;
    if (sameTap) {
      if (!selected)                             { selected = cell; }
      else if (selected.r === cell.r && selected.c === cell.c) { selected = null; }
      else if (adjacent(selected, cell))         { beginSwap(selected, cell); }
      else                                       { selected = cell; }
    } else if (adjacent(ptrStart, cell)) {
      selected = null;
      beginSwap(ptrStart, cell);
    }
    ptrStart = null;
  });

  function adjacent(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  document.addEventListener('keydown', e => {
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (!running) return;
      if (paused) doResume(); else doPause();
    }
    if ((e.code === 'Enter' || e.code === 'Space') && !running) doStart();
  });

  document.getElementById('btn-start').addEventListener('click', doStart);
  document.getElementById('btn-restart').addEventListener('click', doStart);
  document.getElementById('btn-resume').addEventListener('click', doResume);
  document.getElementById('btn-pause').addEventListener('click', () => { if (paused) doResume(); else doPause(); });
  document.getElementById('btn-mute').addEventListener('click', () => {
    GameAudio.setMuted(!GameAudio.isMuted());
    document.getElementById('btn-mute').textContent = GameAudio.isMuted() ? '🔇' : '🔊';
  });
  overlayStart.addEventListener('click', e => { if (e.target === overlayStart) doStart(); });
  overlayPause.addEventListener('click', e => { if (e.target === overlayPause) doResume(); });
  overlayOver.addEventListener('click',  e => { if (e.target === overlayOver)  doStart(); });

  // ── HUD ───────────────────────────────────────────────────────
  function formatTime(t) {
    if (t >= 10) return Math.ceil(t).toString();
    return Math.max(0, t).toFixed(1);
  }

  function formatSurvived(secs) {
    const s = Math.floor(secs);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHUD() {
    elScore.textContent = score;
    elHigh.textContent  = highScore;

    const ratio = timeLeft / MAX_TIME;
    elTime.textContent = formatTime(timeLeft);
    elTime.classList.toggle('urgent', timeLeft < 8);

    elTimerBar.style.width      = (Math.max(0, ratio) * 100).toFixed(1) + '%';
    elTimerBar.style.background =
      ratio > 0.5 ? '#33ff99' : ratio > 0.25 ? '#ffcc00' : '#ff3366';

    elSpeed.textContent = burnSpeed.toFixed(1) + '\u00d7';
    const speedFrac = Math.min((burnSpeed - 1) / 2, 1);
    elSpeed.style.color =
      speedFrac < 0.25 ? '#33ff99' : speedFrac < 0.6 ? '#ffcc00' : '#ff3366';
  }

  // ── Game control ──────────────────────────────────────────────
  function doStart() {
    if (!TowerLife.Credits.consume(doStart)) return;
    score       = 0;
    timeLeft    = START_TIME;
    burnSpeed   = 1.0;
    gameElapsed = 0;
    cascade     = 0;
    selected    = null;
    swapA = swapB = null;
    matchSet = []; dropList = []; fillList = [];
    particles.length = 0;
    phase = 'idle';

    highScore = Save.load('jewelrumble_hi', 0);
    initGrid();
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

    if (score > highScore) { highScore = score; Save.save('jewelrumble_hi', highScore); }

    if (score >= 2000)       Achievements.unlock('jr_2k',   '2 000 Points');
    if (score >= 5000)       Achievements.unlock('jr_5k',   '5 000 Points');
    if (score >= 10000)      Achievements.unlock('jr_10k',  '10 000 Points');
    if (gameElapsed >= 120)  Achievements.unlock('jr_2min', '2 Minute Survivor');

    elFinalScore.textContent = score;
    elFinalHigh.textContent  = highScore;
    elFinalTime.textContent  = formatSurvived(gameElapsed);

    overlayOver.classList.remove('hidden');
    document.getElementById('btn-pause').disabled = true;
    GameAudio.die();
    TowerLife.onGameOver(score, { highScore });
  }

  // ── Game loop ─────────────────────────────────────────────────
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(ts - lastTs, 80);
    lastTs = ts;

    if (!paused) {
      const dtSec = dt / 1000;

      // Advance elapsed time, recalculate burn speed
      gameElapsed += dtSec;
      burnSpeed = 1.0 + gameElapsed * BURN_INC;

      // Drain timer at current burn speed
      timeLeft -= dtSec * burnSpeed;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateHUD(); draw();
        doGameOver();
        return;
      }

      // Phase animation tick
      if (phase !== 'idle') { phaseT--; if (phaseT <= 0) onPhaseEnd(); }

      updateParticles();
      updateHUD();
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ── Rendering ─────────────────────────────────────────────────
  function draw() {
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, CW, CH);

    ctx.strokeStyle = '#13132a'; ctx.lineWidth = 1;
    for (let i = 0; i <= ROWS; i++) {
      ctx.beginPath();
      ctx.moveTo(PAD, PAD + i * CELL); ctx.lineTo(PAD + COLS * CELL, PAD + i * CELL);
      ctx.stroke();
    }
    for (let i = 0; i <= COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(PAD + i * CELL, PAD); ctx.lineTo(PAD + i * CELL, PAD + ROWS * CELL);
      ctx.stroke();
    }

    const swapT  = (phase === 'swap' || phase === 'unswap') ? 1 - phaseT / F_SWAP  : null;
    const matchT = phase === 'match' ? 1 - phaseT / F_MATCH : null;
    const dropT  = phase === 'drop'  ? 1 - phaseT / F_DROP  : null;
    const fillT  = phase === 'fill'  ? 1 - phaseT / F_FILL  : null;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const type = grid[r][c];
        if (type === -1) continue;

        let cx    = PAD + c * CELL + CELL / 2;
        let cy    = PAD + r * CELL + CELL / 2;
        let alpha = 1;
        let scale = 1;

        // Swap glide
        if (swapT !== null && swapA && swapB) {
          const fwd = phase === 'swap' ? swapT : 1 - swapT;
          if (r === swapA.r && c === swapA.c) {
            cx += (swapB.c - swapA.c) * CELL * fwd;
            cy += (swapB.r - swapA.r) * CELL * fwd;
          } else if (r === swapB.r && c === swapB.c) {
            cx += (swapA.c - swapB.c) * CELL * fwd;
            cy += (swapA.r - swapB.r) * CELL * fwd;
          }
        }

        // Match flash
        const isMatched = matchT !== null && matchSet.some(m => m.r === r && m.c === c);
        if (isMatched) { alpha = 1 - matchT; scale = 1 + matchT * 0.45; }

        // Drop fall
        if (dropT !== null) {
          const d = dropList.find(d => d.r === r && d.c === c);
          if (d) cy -= (r - d.fromR) * CELL * (1 - dropT);
        }

        // Fill drop-in
        if (fillT !== null && fillList.some(f => f.r === r && f.c === c)) {
          cy -= CELL * (1 - fillT); alpha = fillT;
        }

        ctx.save();
        ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.globalAlpha = alpha;
        drawGem(type, selected && selected.r === r && selected.c === c, isMatched);
        ctx.restore();
      }
    }

    drawParticles();
  }

  // ── Gem renderer ──────────────────────────────────────────────
  function drawGem(type, isSelected, isMatched) {
    const color = GEM_COLORS[type];
    const r     = GEM_R;

    ctx.shadowBlur = 0;
    if (isMatched)       { ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 24; }
    else if (isSelected) { ctx.shadowColor = color;     ctx.shadowBlur = 16; }

    ctx.fillStyle   = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth   = 1.5;

    switch (type) {
      case 0: drawDiamond(r);  break;
      case 1: drawCircle(r);   break;
      case 2: drawSquare(r);   break;
      case 3: drawTriangle(r); break;
      case 4: drawHexagon(r);  break;
      case 5: drawStar(r);     break;
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.18, -r * 0.30, r * 0.38, r * 0.22, -0.35, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected) {
      const pulse = 0.55 + 0.38 * Math.sin(Date.now() / 130);
      ctx.strokeStyle = `rgba(255,255,255,${pulse.toFixed(2)})`;
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 0;
      const s = r * 1.12;
      ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 2); ctx.stroke();
    }
  }

  function drawDiamond(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.72, 0);
    ctx.lineTo(0,  r); ctx.lineTo(-r * 0.72, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  function drawCircle(r) {
    ctx.beginPath(); ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  function drawSquare(r) {
    const s = r * 0.72;
    ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 2);
    ctx.fill(); ctx.stroke();
  }

  function drawTriangle(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.87, r * 0.58); ctx.lineTo(-r * 0.87, r * 0.58);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  function drawHexagon(r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? ctx.moveTo(r * 0.80 * Math.cos(a), r * 0.80 * Math.sin(a))
              : ctx.lineTo(r * 0.80 * Math.cos(a), r * 0.80 * Math.sin(a));
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  function drawStar(r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a  = (i * Math.PI) / 4 - Math.PI / 4;
      const rr = i % 2 === 0 ? r * 0.86 : r * 0.38;
      i === 0 ? ctx.moveTo(rr * Math.cos(a), rr * Math.sin(a))
              : ctx.lineTo(rr * Math.cos(a), rr * Math.sin(a));
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ── Initial idle draw ─────────────────────────────────────────
  draw();

})();
