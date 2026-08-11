/**
 * piano.js — Piano Tiles-clone "Piano"
 *
 * 4 columns of tiles scroll downward. Tap the glowing tile in each row
 * before its top edge crosses the bottom bar. Tap an empty lane = game over.
 * Speed and tile density increase with score.
 *
 * Controls:
 *   Touch / Click  : tap the correct column
 *   Unity bridge   : window.piano_tap(col)   col = 0..3
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // -- Canvas ----------------------------------------------------------------
  const W = 360;
  const H = 580;

  // -- Layout ----------------------------------------------------------------
  const COLS       = 4;
  const COL_W      = W / COLS;           // 90 px
  const TILE_H     = 130;                // px height of one tile
  const TILE_PAD   = 3;                  // gap between neighbouring tiles
  const BOTTOM_BAR = 60;                 // height of the tap-zone bar at bottom
  // A tile is "missed" when its top edge crosses this Y line
  const MISS_Y     = H - BOTTOM_BAR;    // 520

  // -- Difficulty constants --------------------------------------------------
  const SPEED_INIT        = 230;   // px/s at start
  const SPEED_MAX         = 720;   // px/s cap
  const SPEED_RAMP        = 7;     // px/s added per tile tapped
  const ROW_SPACING_INIT  = 175;   // px between successive tile tops (loose)
  const ROW_SPACING_MIN   = 132;   // px (tight - tiles almost back-to-back)
  const ROW_SQUEEZE       = 0.8;   // px tighter per tile tapped

  // -- Neon palette ---------------------------------------------------------
  const C_BG       = '#000000';
  const C_LANE_ODD = '#0a0a16';
  const C_SEP      = '#1a1a30';
  const C_BAR      = '#080814';
  const C_BAR_LINE = '#00e5ff';
  const C_MISS     = '#ff2255';
  const C_NOTE     = '#00e5ff';

  // -- Note labels & frequencies (C-major pentatonic) -----------------------
  const NOTE_LABELS = ['C', 'E', 'G', 'A'];
  const NOTE_FREQS  = [261.63, 329.63, 392.00, 440.00];

  // -- State ----------------------------------------------------------------
  let canvas, ctx;
  let score, bestScore;
  let speed, rowSpacing;
  let tiles;          // { col, y, state:'active'|'hit'|'missed', hitFlash }
  let particles;      // { x, y, vx, vy, life, maxLife, r }
  let spawnDebt;      // pixels of scroll accumulated toward next row spawn
  let lastCol;        // column of last spawned tile (avoid same-col repeats)
  let running;
  let animId;
  let lastTs;
  let audioCtx;

  // -- Audio ----------------------------------------------------------------
  function playNote(col, good) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = good ? 'triangle' : 'sawtooth';
      osc.frequency.value = good ? NOTE_FREQS[col] : 100;
      gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (good ? 0.3 : 0.2));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (_) {}
  }

  // -- Helpers --------------------------------------------------------------
  function colX(col) { return col * COL_W; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function pickNextCol() {
    const options = [];
    for (let c = 0; c < COLS; c++) {
      if (c !== lastCol) options.push(c);
    }
    const col = options[Math.floor(Math.random() * options.length)];
    lastCol = col;
    return col;
  }

  function spawnTileAt(y) {
    tiles.push({ col: pickNextCol(), y, state: 'active', hitFlash: 0 });
  }

  // -- Reset ----------------------------------------------------------------
  function reset() {
    score      = 0;
    speed      = SPEED_INIT;
    rowSpacing = ROW_SPACING_INIT;
    tiles      = [];
    particles  = [];
    spawnDebt  = 0;
    lastCol    = -1;
    running    = false;
    lastTs     = null;
    audioCtx   = null;

    document.getElementById('score').textContent      = '0';
    document.getElementById('high-score').textContent  = bestScore;

    // Pre-seed rows above and on screen so tiles appear immediately on start.
    // Stop before a tile's top would already be past MISS_Y at game start.
    let seedY = -TILE_H;
    while (seedY < MISS_Y - TILE_H) {
      spawnTileAt(seedY);
      seedY += rowSpacing;
    }
  }

  // -- Tap handler ----------------------------------------------------------
  function handleTap(col) {
    if (!running) return;

    // Find the lowest still-visible active tile in this column
    let best = null;
    for (const t of tiles) {
      if (t.state !== 'active' || t.col !== col) continue;
      if (t.y < MISS_Y && t.y + TILE_H > 0) {
        if (!best || t.y > best.y) best = t;
      }
    }

    if (best) {
      best.state    = 'hit';
      best.hitFlash = 0.18;
      score++;
      speed      = clamp(speed + SPEED_RAMP, SPEED_INIT, SPEED_MAX);
      rowSpacing = clamp(rowSpacing - ROW_SQUEEZE, ROW_SPACING_MIN, ROW_SPACING_INIT);
      document.getElementById('score').textContent = score;
      if (score > bestScore) {
        bestScore = score;
        Save.save('piano_best', bestScore);
        document.getElementById('high-score').textContent = bestScore;
      }
      TowerLife.sendScore(score);
      spawnParticles(best.col, best.y + TILE_H / 2);
      playNote(best.col, true);
      checkAchievements();
    } else {
      triggerGameOver();
    }
  }

  // -- Particles ------------------------------------------------------------
  function spawnParticles(col, cy) {
    const cx = colX(col) + COL_W / 2;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const spd   = 70 + Math.random() * 90;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.38 + Math.random() * 0.22,
        maxLife: 0.6,
        r: 2.5 + Math.random() * 3,
      });
    }
  }

  // -- Game over ------------------------------------------------------------
  function triggerGameOver() {
    if (!running) return;
    running = false;
    TowerLife.onGameOver(score);
    playNote(0, false);

    for (const t of tiles) {
      if (t.state === 'active' && t.y < MISS_Y && t.y + TILE_H > 0) {
        t.state = 'missed';
      }
    }

    setTimeout(function () {
      document.getElementById('final-score').textContent = score;
      document.getElementById('final-high').textContent  = bestScore;
      document.getElementById('overlay-over').classList.remove('hidden');
    }, 380);
  }

  // -- Achievements ---------------------------------------------------------
  function checkAchievements() {
    if (score === 10)  TowerLife.unlockAchievement('piano_10');
    if (score === 30)  TowerLife.unlockAchievement('piano_30');
    if (score === 60)  TowerLife.unlockAchievement('piano_60');
    if (score === 100) TowerLife.unlockAchievement('piano_100');
  }

  // -- Game loop ------------------------------------------------------------
  function loop(ts) {
    animId = requestAnimationFrame(loop);
    const dt = lastTs === null ? 0 : Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (running) update(dt);
    draw();
  }

  function update(dt) {
    const dist = speed * dt;

    for (const t of tiles) {
      t.y += dist;
      if (t.state === 'hit') t.hitFlash -= dt;
    }

    // Check for missed active tiles
    for (const t of tiles) {
      if (t.state === 'active' && t.y >= MISS_Y) {
        t.state = 'missed';
        triggerGameOver();
        return;
      }
    }

    // Cull tiles well past the bottom
    tiles = tiles.filter(function (t) { return t.y < H + 10; });

    // Spawn new rows based on accumulated scroll distance
    spawnDebt += dist;
    while (spawnDebt >= rowSpacing) {
      spawnDebt -= rowSpacing;
      spawnTileAt(-TILE_H);
    }

    // Update particles
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 100 * dt;
      p.life -= dt;
    }
    particles = particles.filter(function (p) { return p.life > 0; });
  }

  // -- Draw -----------------------------------------------------------------
  function draw() {
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    // Faint alternating column stripes
    ctx.fillStyle = C_LANE_ODD;
    for (let c = 1; c < COLS; c += 2) {
      ctx.fillRect(colX(c), 0, COL_W, H);
    }

    // Tiles
    for (const t of tiles) {
      const x = colX(t.col) + TILE_PAD;
      const y = t.y + TILE_PAD;
      const w = COL_W - TILE_PAD * 2;
      const h = TILE_H - TILE_PAD * 2;

      if (t.state === 'active') {
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0,   '#00ffff');
        grad.addColorStop(0.5, '#00ccee');
        grad.addColorStop(1,   '#004455');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();

        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur  = 16;
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.shadowBlur  = 0;

        ctx.fillStyle    = 'rgba(0,0,0,0.4)';
        ctx.font         = 'bold 30px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(NOTE_LABELS[t.col], x + w / 2, y + h / 2);

      } else if (t.state === 'hit') {
        const frac = clamp(t.hitFlash / 0.18, 0, 1);
        ctx.globalAlpha = frac;
        const hue = 180 + (1 - frac) * 60;
        const lit = 60 + frac * 40;
        ctx.fillStyle   = 'hsl(' + hue + ', 100%, ' + lit + '%)';
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        ctx.globalAlpha = 1;

      } else if (t.state === 'missed') {
        ctx.fillStyle   = C_MISS;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Particles
    ctx.shadowColor = C_NOTE;
    ctx.shadowBlur  = 8;
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle   = C_NOTE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    // Column separators
    ctx.strokeStyle = C_SEP;
    ctx.lineWidth   = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(colX(c), 0);
      ctx.lineTo(colX(c), H);
      ctx.stroke();
    }

    // Bottom bar background
    ctx.fillStyle = C_BAR;
    ctx.fillRect(0, MISS_Y, W, BOTTOM_BAR);

    // Bottom bar glowing top border
    ctx.strokeStyle = C_BAR_LINE;
    ctx.lineWidth   = 2;
    ctx.shadowColor = C_BAR_LINE;
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.moveTo(0, MISS_Y);
    ctx.lineTo(W, MISS_Y);
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Piano key buttons in bottom bar
    const keyW = COL_W - 10;
    const keyH = BOTTOM_BAR - 14;
    const keyY = MISS_Y + 7;
    for (let c = 0; c < COLS; c++) {
      const kx = colX(c) + 5;
      ctx.fillStyle   = 'rgba(0,229,255,0.07)';
      ctx.strokeStyle = 'rgba(0,229,255,0.4)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.roundRect(kx, keyY, keyW, keyH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle    = 'rgba(0,229,255,0.7)';
      ctx.font         = '11px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(NOTE_LABELS[c], kx + keyW / 2, keyY + keyH / 2);
    }
  }

  // -- Bootstrap ------------------------------------------------------------
  function startGame() {
    document.getElementById('overlay-start').classList.add('hidden');
    document.getElementById('overlay-over').classList.add('hidden');
    reset();
    running = true;
  }

  function bootstrap() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    canvas.width  = W;
    canvas.height = H;

    bestScore = Save.load('piano_best', 0);
    document.getElementById('high-score').textContent = bestScore;

    reset();
    animId = requestAnimationFrame(loop);

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (!running) return;
      const rect   = canvas.getBoundingClientRect();
      const scaleX = W / rect.width;
      const cx     = (e.clientX - rect.left) * scaleX;
      handleTap(clamp(Math.floor(cx / COL_W), 0, COLS - 1));
    });

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', function () {
      document.getElementById('overlay-over').classList.add('hidden');
      startGame();
    });
    document.getElementById('btn-mute').addEventListener('click', function () {
      const btn = document.getElementById('btn-mute');
      btn.textContent = btn.textContent === '\uD83D\uDD0A' ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    });

    TowerLife.onGameReady('piano');
  }

  // -- Unity bridge ---------------------------------------------------------
  window.piano_tap = function (col) {
    handleTap(clamp(col | 0, 0, COLS - 1));
  };

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
