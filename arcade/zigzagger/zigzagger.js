/**
 * zigzagger.js — Ketchapp ZigZag-clone "ZigZagger"
 *
 * One-touch control: tap/click anywhere to switch diagonal direction.
 * Collect gems for score. Speed increases over time.
 * Fall off the path = game over.
 *
 * Controls:
 *   Touch / Click : change direction
 *   Keyboard      : Space / Enter
 *   Unity         : window.zigzagger_tap()
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas logical size ────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Tunable constants ──────────────────────────────────────────────

  // Camera: ball is fixed at this screen position
  const BALL_SCREEN_X = W / 2;
  const BALL_SCREEN_Y = H * 0.65;

  // Tile geometry (world pixels)
  const TILE_HALF   = 60;   // half-diagonal of each diamond tile
  const TILE_STEP   = 24;   // tile-center spacing along path direction (in each axis)
  const CUBE_DEPTH  = 22;   // height of 3-D side faces (screen pixels)

  // Path generation
  const PATH_AHEAD  = 42;   // tiles generated ahead of ball
  const PATH_BEHIND = 14;   // tiles kept / drawn behind ball
  const SEG_FIRST   = 8;    // tiles ahead before the very first turn (ease-in)
  const SEG_MIN     = 4;    // min tiles per direction segment
  const SEG_MAX     = 9;    // max tiles per direction segment

  // Speed (world px / sec in each axis; diagonal speed = speed * √2)
  const BASE_SPEED  = 88;   // initial speed
  const SPEED_INC   = 3.2;  // px/sec added per second played
  const MAX_SPEED   = 230;  // cap

  // Gems
  const GEM_HALF       = 14;  // half-diagonal of gem diamond
  const GEM_EVERY      = 3;   // place a gem every N tiles (excluding start)
  const GEM_SKIP_START = 7;   // don't place gems on the first N tiles
  const GEM_SCORE      = 10;  // score per gem

  // Visuals
  const TRAIL_LEN  = 14;    // max trail segments
  const TRAIL_FADE = 2.8;   // alpha/sec trail fades
  const STAR_COUNT = 50;

  // Colours
  const C_BG         = '#000814';
  const C_TILE_TOP   = '#00ccff';
  const C_TILE_L     = '#00688a';
  const C_TILE_R     = '#003d55';
  const C_TILE_EDGE  = 'rgba(0,230,255,0.35)';
  const C_BALL       = '#ff4466';
  const C_GEM        = '#ffd700';
  const C_GEM_GLOW   = 'rgba(255,215,0,0.28)';

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let state;        // 'idle' | 'playing' | 'dying' | 'over'
  let raf;
  let lastTime;

  // Ball world position (floating point)
  let bx, by;
  // Movement direction: +1 = right (bx increases), −1 = left
  let dir;
  // Current axis speed (world px/sec)
  let speed;
  // Total seconds elapsed (used for speed ramp)
  let elapsed;

  // Scores
  let score, highScore;

  // Path: array of { wx, wy } tile centres (world coords)
  // Sorted so that path[0] is the oldest / furthest-behind tile.
  let path;
  // Generator cursor
  let pathGenX, pathGenY, pathGenDir, pathSegLeft;
  // Total tiles pushed (for gem placement)
  let tileCount;

  // Gems: array of { wx, wy, collected }
  let gems;

  // Trail: array of { x, y, a } (world pos + alpha)
  let trail;

  // Particles: array of { x, y, vx, vy, life, maxLife, color, r }
  let particles;

  // Floating score pop: { text, wx, wy, life }
  let scorePop;

  // Dying countdown (seconds)
  let dyingTimer;

  // Stars: array of { x, y, r, a, ph, fr }
  let stars;

  // Mute flag
  let muted = false;

  // ── Utility ────────────────────────────────────────────────────────
  const rand  = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b));

  // ── Canvas setup ───────────────────────────────────────────────────
  function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');

    function resize() {
      const wrap  = canvas.parentElement;
      const scale = Math.min(wrap.clientWidth / W, wrap.clientHeight / H);
      canvas.width        = W;
      canvas.height       = H;
      canvas.style.width  = Math.round(W * scale) + 'px';
      canvas.style.height = Math.round(H * scale) + 'px';
    }
    resize();
    window.addEventListener('resize', resize);
  }

  // ── Stars ───────────────────────────────────────────────────────────
  function initStars() {
    stars = Array.from({ length: STAR_COUNT }, () => ({
      x:  rand(0, W),
      y:  rand(0, H),
      r:  rand(0.4, 1.8),
      a:  rand(0.2, 0.85),
      ph: rand(0, Math.PI * 2),
      fr: rand(0.008, 0.04),
    }));
  }

  // ── World → screen ─────────────────────────────────────────────────
  // Camera always centres on ball: ball appears at (BALL_SCREEN_X, BALL_SCREEN_Y).
  function ws(wx, wy) {
    return {
      sx: BALL_SCREEN_X + (wx - bx),
      sy: BALL_SCREEN_Y + (wy - by),
    };
  }

  // ── Path generation ─────────────────────────────────────────────────
  // The world: moving forward means wy DECREASES (−y direction).
  // dir +1: bx increases, −1: bx decreases. by always decreases.
  //
  // path[0] = oldest/behind (highest wy, at or below ball on screen)
  // path[last] = newest/ahead (lowest wy, above ball on screen)

  function initPath() {
    path      = [];
    gems      = [];
    tileCount = 0;

    // Start generator one PATH_BEHIND tiles behind the ball along dir +1.
    pathGenX    = bx - PATH_BEHIND * TILE_STEP;
    pathGenY    = by + PATH_BEHIND * TILE_STEP;
    pathGenDir  = 1;
    // First segment: PATH_BEHIND tiles back + SEG_FIRST ahead before first turn.
    pathSegLeft = PATH_BEHIND + SEG_FIRST;

    // Seed enough tiles for the initial view
    const needed = PATH_BEHIND + PATH_AHEAD + SEG_FIRST + 4;
    for (let i = 0; i < needed; i++) appendTile();
  }

  function appendTile() {
    path.push({ wx: pathGenX, wy: pathGenY });
    tileCount++;

    // Place gem (skip very start; every GEM_EVERY tiles)
    if (tileCount > GEM_SKIP_START && (tileCount % GEM_EVERY) === 0) {
      gems.push({ wx: pathGenX, wy: pathGenY, collected: false });
    }

    pathGenX   += pathGenDir * TILE_STEP;
    pathGenY   -= TILE_STEP;           // always advance forward (−y)
    pathSegLeft--;

    if (pathSegLeft <= 0) {
      pathGenDir  = -pathGenDir;
      pathSegLeft = randi(SEG_MIN, SEG_MAX + 1);
    }
  }

  function maintainPath() {
    // Extend ahead until the generator is PATH_AHEAD tiles beyond the ball.
    const aheadTarget = by - PATH_AHEAD * TILE_STEP;
    while (pathGenY > aheadTarget) appendTile();

    // Prune tiles too far behind.
    const cutoff = by + (PATH_BEHIND + 3) * TILE_STEP;
    while (path.length > 0 && path[0].wy > cutoff) path.shift();
    while (gems.length  > 0 && gems[0].wy  > cutoff) gems.shift();
  }

  // ── Collision: is ball on the path? ────────────────────────────────
  // Circular proximity: ball is "on" any tile within TILE_HALF world px.
  // With TILE_STEP = 20 and TILE_HALF = 34: midpoint distance = 20·√2/2 ≈ 14.1 < 34. Safe.
  function isOnPath() {
    const R2 = (TILE_HALF * 1.06) * (TILE_HALF * 1.06);
    for (const t of path) {
      const dx = bx - t.wx;
      const dy = by - t.wy;
      if (dx * dx + dy * dy < R2) return true;
    }
    return false;
  }

  // ── Drawing helpers ─────────────────────────────────────────────────
  function drawDiamond(cx, cy, half, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(cx,        cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx,        cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
    if (fill)   { ctx.fillStyle = fill;  ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.6; ctx.stroke(); }
  }

  function drawTile(sx, sy) {
    const h = TILE_HALF;
    const d = CUBE_DEPTH;

    // Right side face (bottom-right of diamond, extends down by d)
    ctx.beginPath();
    ctx.moveTo(sx + h, sy);
    ctx.lineTo(sx,     sy + h);
    ctx.lineTo(sx,     sy + h + d);
    ctx.lineTo(sx + h, sy + d);
    ctx.closePath();
    ctx.fillStyle = C_TILE_R;
    ctx.fill();

    // Left side face (bottom-left of diamond, extends down by d)
    ctx.beginPath();
    ctx.moveTo(sx - h, sy);
    ctx.lineTo(sx,     sy + h);
    ctx.lineTo(sx,     sy + h + d);
    ctx.lineTo(sx - h, sy + d);
    ctx.closePath();
    ctx.fillStyle = C_TILE_L;
    ctx.fill();

    // Top face (the diamond)
    drawDiamond(sx, sy, h, C_TILE_TOP, C_TILE_EDGE);
  }

  function drawGem(sx, sy) {
    // Soft glow
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, GEM_HALF * 2.2);
    g.addColorStop(0,   C_GEM_GLOW);
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, GEM_HALF * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Gem body
    drawDiamond(sx, sy, GEM_HALF, C_GEM, 'rgba(255,255,255,0.5)');

    // Tiny highlight
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(sx - 1.5, sy - 2.5, GEM_HALF * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBall(sx, sy) {
    const r = 9;
    // Glow
    ctx.save();
    ctx.shadowColor = C_BALL;
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = C_BALL;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(sx - 2.5, sy - 3, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Audio ─────────────────────────────────────────────────────────
  function beep(freq, vol, dur) {
    if (muted) return;
    try {
      const ac  = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ac.createOscillator();
      const gn  = ac.createGain();
      osc.connect(gn);
      gn.connect(ac.destination);
      osc.frequency.value = freq;
      gn.gain.setValueAtTime(vol, ac.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.start();
      osc.stop(ac.currentTime + dur);
    } catch (_) {}
  }

  // ── Particles ──────────────────────────────────────────────────────
  function spawnGemFX(wx, wy) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      particles.push({
        x: wx, y: wy,
        vx: Math.cos(a) * rand(32, 78),
        vy: Math.sin(a) * rand(32, 78) - 28,
        life: rand(0.28, 0.5), maxLife: 0.5,
        color: C_GEM, r: rand(2, 4),
      });
    }
    scorePop = { text: '+' + GEM_SCORE, wx, wy, life: 0.72 };
  }

  function spawnDeathFX(wx, wy) {
    for (let i = 0; i < 22; i++) {
      const a   = Math.random() * Math.PI * 2;
      const spd = rand(50, 190);
      particles.push({
        x: wx, y: wy,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 55,
        life: rand(0.3, 0.75), maxLife: 0.75,
        color: C_BALL, r: rand(3, 8),
      });
    }
  }

  function stepParticles(dt) {
    for (const p of particles) {
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.vy   += 270 * dt; // gravity
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  // HUD drawn on canvas ────────────────────────────────────────────
  function drawHUD() {
    ctx.save();
    ctx.textBaseline = 'top';

    // SCORE — top left
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, 110, 52);
    ctx.fillStyle = '#445566';
    ctx.font      = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SCORE', 14, 12);
    ctx.fillStyle = '#00ff88';
    ctx.font      = 'bold 24px monospace';
    ctx.fillText(score, 14, 24);

    // BEST — top right
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(W - 110, 0, 110, 52);
    ctx.fillStyle = '#445566';
    ctx.font      = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('BEST', W - 14, 12);
    ctx.fillStyle = '#00ff88';
    ctx.font      = 'bold 24px monospace';
    ctx.fillText(highScore, W - 14, 24);

    ctx.restore();
  }

  // ── Game init ─────────────────────────────────────────────────────
  function startGame() {
    bx        = 0;
    by        = 0;
    dir       = 1;
    speed     = BASE_SPEED;
    score     = 0;
    elapsed   = 0;
    trail     = [];
    particles = [];
    scorePop  = null;
    dyingTimer = 0;

    initPath();
    state    = 'playing';
    lastTime = null;
  }

  // ── Direction tap ─────────────────────────────────────────────────
  function tap() {
    if (state !== 'playing') return;
    dir = -dir;
    beep(460, 0.11, 0.04);
  }

  // Exposed to Unity WebView
  window.zigzagger_tap = tap;

  // ── Update ────────────────────────────────────────────────────────
  function update(dt) {
    elapsed += dt;
    speed = Math.min(BASE_SPEED + SPEED_INC * elapsed, MAX_SPEED);

    const step = speed * dt;
    bx += dir  * step;
    by -= step;            // always forward (−y)

    // Trail
    trail.push({ x: bx, y: by, a: 0.55 });
    if (trail.length > TRAIL_LEN) trail.shift();
    for (const tp of trail) tp.a -= dt * TRAIL_FADE;

    maintainPath();

    // Gem collection
    const pickR2 = (GEM_HALF + 11) * (GEM_HALF + 11);
    for (const g of gems) {
      if (g.collected) continue;
      const dx = bx - g.wx, dy = by - g.wy;
      if (dx * dx + dy * dy < pickR2) {
        g.collected = true;
        score += GEM_SCORE;
        if (score > highScore) {
          highScore = score;
          Save.save('zigzagger_hi', highScore);
        }
        spawnGemFX(g.wx, g.wy);
        beep(880, 0.11, 0.08);
      }
    }

    // Death check
    if (!isOnPath()) {
      state      = 'dying';
      dyingTimer = 0.55;
      spawnDeathFX(bx, by);
      beep(160, 0.28, 0.5);
      return;
    }

    stepParticles(dt);
    if (scorePop) {
      scorePop.life -= dt;
      if (scorePop.life <= 0) scorePop = null;
    }
  }

  function updateDying(dt) {
    dyingTimer -= dt;
    stepParticles(dt);
    if (dyingTimer <= 0) endGame();
  }

  function endGame() {
    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    document.getElementById('overlay-over').classList.remove('hidden');
    state = 'over';
    if (window.TowerLife) TowerLife.onGameOver(score);
  }

  // ── Draw ──────────────────────────────────────────────────────────
  function draw(t) {
    // Background
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    // Stars (twinkling)
    ctx.save();
    for (const s of stars) {
      const a = s.a * (0.5 + 0.5 * Math.sin(s.ph + t * s.fr * 60));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Tiles — painter's order: ahead (top of screen, far) first → behind (bottom, close) last.
    // path[last] = ahead, path[0] = behind.
    for (let i = path.length - 1; i >= 0; i--) {
      const { wx, wy } = path[i];
      const { sx, sy } = ws(wx, wy);
      if (sx < -(TILE_HALF + 4) || sx > W + TILE_HALF + 4) continue;
      if (sy < -(TILE_HALF + CUBE_DEPTH + 2) || sy > H + TILE_HALF + CUBE_DEPTH + 2) continue;
      drawTile(sx, sy);
    }

    // Gems
    for (const g of gems) {
      if (g.collected) continue;
      const { sx, sy } = ws(g.wx, g.wy);
      if (sx < -24 || sx > W + 24 || sy < -24 || sy > H + 24) continue;
      drawGem(sx, sy);
    }

    // Ball trail
    for (const tp of trail) {
      if (tp.a <= 0) continue;
      const { sx, sy } = ws(tp.x, tp.y);
      ctx.globalAlpha = Math.max(0, tp.a);
      ctx.fillStyle   = C_BALL;
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ball (fixed screen position, only when playing)
    if (state === 'playing') {
      drawBall(BALL_SCREEN_X, BALL_SCREEN_Y);
    }

    // Particles
    for (const p of particles) {
      const { sx, sy } = ws(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Canvas HUD (score / best)
    if (state !== 'idle') drawHUD();

    // Score pop-up text
    if (scorePop) {
      const { sx, sy }  = ws(scorePop.wx, scorePop.wy);
      const progress    = scorePop.life / 0.72;  // 1 → 0
      ctx.globalAlpha   = Math.min(1, progress * 2);
      ctx.fillStyle     = C_GEM;
      ctx.font          = 'bold 14px monospace';
      ctx.textAlign     = 'center';
      ctx.fillText(scorePop.text, sx, sy - (1 - progress) * 30 - 8);
      ctx.globalAlpha   = 1;
    }
  }

  // ── Main loop ─────────────────────────────────────────────────────
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.05) : 0;
    lastTime  = ts;

    if      (state === 'playing') update(dt);
    else if (state === 'dying')   updateDying(dt);

    draw(ts / 1000);
  }

  // ── UI wiring ─────────────────────────────────────────────────────
  function initUI() {
    highScore = Save.load('zigzagger_hi', 0);

    document.getElementById('btn-start').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('overlay-start').classList.add('hidden');
      startGame();
    });

    document.getElementById('btn-restart').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('overlay-over').classList.add('hidden');
      startGame();
    });

    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
      btnMute.addEventListener('click', e => {
        e.stopPropagation();
        muted = !muted;
        btnMute.textContent = muted ? '🔇' : '🔊';
      });
    }

    // Tap canvas to change direction
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      tap();
    });

    // Keyboard
    window.addEventListener('keydown', e => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      e.preventDefault();
      if (state === 'idle') {
        document.getElementById('overlay-start').classList.add('hidden');
        startGame();
      } else if (state === 'playing') {
        tap();
      } else if (state === 'over') {
        document.getElementById('overlay-over').classList.add('hidden');
        startGame();
      }
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────
  function boot() {
    initCanvas();
    initStars();
    initUI();

    // Idle: set up a visible path preview behind the start overlay
    bx = 0; by = 0; dir = 1;
    trail     = [];
    particles = [];
    scorePop  = null;
    initPath();

    state = 'idle';
    raf   = requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
