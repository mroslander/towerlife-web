/**
 * finger.js — MmmmFingers-clone "Finger"
 *
 * Top-down endless runner. Camera looks straight down. You are speeding
 * forward automatically. Hold your finger and drag it to steer left/right
 * (and up/down) around incoming obstacles. Lifting your finger = instant
 * game over.
 *
 * Obstacles scroll towards you from the top and may:
 *   ROTATOR  — spin (rotating blade)
 *   HBAR     — wall with a gap that slides horizontally
 *   SLIDER   — circle bouncing horizontally + pulsing in size
 *
 * Speed increases over time. Score = time survived.
 *
 * Controls:
 *   Touch/Mouse : press, hold, and drag. Lift = game over.
 *   Unity       : window.finger_setPos(x, y) where x,y are 0–1 normalised
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Player ─────────────────────────────────────────────────────────
  const PLAYER_R     = 10;   // visual radius (px)
  const PLAYER_HIT_R = 8;    // collision radius (px)
  const TRAIL_LEN    = 20;   // trail history length

  // ── Obstacle geometry ───────────────────────────────────────────────

  // ROTATOR — spinning blade scrolling down
  const ROT_ARM_HALF  = 9;          // half arm width for collision (px)
  const ROT_ARM_MIN   = 55;         // arm length range (px)
  const ROT_ARM_MAX   = 88;
  const ROT_GRACE     = 0.35;       // seconds before collision is active

  // HBAR — full-width bar with sliding gap
  const BAR_H         = 26;         // bar height (px)
  const GAP_MIN       = 56;         // gap width range (px, decreases with diff)
  const GAP_MAX       = 108;

  // SLIDER — circle bouncing horizontally + pulsing
  const SL_R_MIN      = 22;
  const SL_R_MAX      = 42;
  const SL_PULSE_AMP  = 0.22;       // fractional radius pulse amplitude
  const SL_PULSE_FREQ = 2.8;        // pulse cycles per second

  // ── Scroll speed ────────────────────────────────────────────────────
  const SCROLL_START = 230;    // px/s at t = 0
  const SCROLL_MAX   = 780;    // px/s at t ≥ SCROLL_TIME
  const SCROLL_TIME  = 80;     // seconds to reach full speed

  // ── Difficulty tiers ───────────────────────────────────────────────
  const DIFF = [
    { time:  0, maxObs: 2, spawnSec: 2.0, gapW: 86,      obsSpd: 1.0 },
    { time:  8, maxObs: 2, spawnSec: 1.7, gapW: 76,      obsSpd: 1.4 },
    { time: 20, maxObs: 3, spawnSec: 1.5, gapW: 68,      obsSpd: 1.8 },
    { time: 35, maxObs: 3, spawnSec: 1.3, gapW: 62,      obsSpd: 2.3 },
    { time: 55, maxObs: 4, spawnSec: 1.1, gapW: 58,      obsSpd: 2.8 },
    { time: 75, maxObs: 5, spawnSec: 0.9, gapW: GAP_MIN, obsSpd: 3.5 },
  ];

  // Milestone sound every N seconds
  const MILESTONE_SEC = 10;

  // ── Neon palette ────────────────────────────────────────────────────
  const PALETTE = ['#ff2255','#ff6600','#ffdd00','#00ccff','#aa44ff','#ff44cc'];

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let fingerX = W / 2, fingerY = H * 0.72;
  let fingerDown = false;
  let trail   = [];       // recent player positions for motion trail
  let obstacles = [], particles = [], speedLines = [];
  let elapsed = 0, highScore = 0;
  let spawnTimer = 0, nextMilestone = MILESTONE_SEC;
  let state = 'idle';     // 'idle' | 'waiting' | 'playing' | 'dead'
  let lastTime = 0, raf = null;

  // ── Utilities ──────────────────────────────────────────────────────
  const rand    = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const clamp   = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  const PI2     = Math.PI * 2;
  const pick    = arr => arr[randInt(0, arr.length - 1)];
  const fmtTime = s => s.toFixed(1) + 's';

  function getDiff(t) {
    let d = DIFF[0];
    for (let i = 1; i < DIFF.length; i++) {
      if (t >= DIFF[i].time) d = DIFF[i]; else break;
    }
    return d;
  }

  function scrollSpeed() {
    // px/s — smoothly ramps from SCROLL_START to SCROLL_MAX over SCROLL_TIME s
    return SCROLL_START + (SCROLL_MAX - SCROLL_START) * Math.min(elapsed / SCROLL_TIME, 1);
  }

  // ── Canvas setup ───────────────────────────────────────────────────
  function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    function resize() {
      const hudEl  = document.getElementById('hud');
      const hudH   = hudEl ? hudEl.offsetHeight + 4 : 44;
      const availW = window.innerWidth;
      const availH = window.innerHeight - hudH;
      const scale  = Math.min(availW / W, availH / H);
      canvas.width  = W;
      canvas.height = H;
      canvas.style.width  = Math.round(W * scale) + 'px';
      canvas.style.height = Math.round(H * scale) + 'px';
    }
    resize();
    window.addEventListener('resize', resize);
  }

  // ── Speed lines (background depth effect) ──────────────────────────
  function initSpeedLines() {
    speedLines = Array.from({ length: 42 }, () => ({
      x:     rand(0, W),
      y:     rand(0, H),
      len:   rand(12, 48),
      alpha: rand(0.05, 0.20),
    }));
  }

  // ── Obstacle spawning ──────────────────────────────────────────────
  function spawnObstacle() {
    const { gapW, obsSpd } = getDiff(elapsed);
    const roll = Math.random();
    const type = roll < 0.34 ? 'rotator' : roll < 0.67 ? 'hbar' : 'slider';

    if (type === 'rotator') {
      const armLen = rand(ROT_ARM_MIN, ROT_ARM_MAX);
      obstacles.push({
        type:    'rotator',
        x:       rand(armLen + 15, W - armLen - 15),
        y:       -(armLen + 20),
        angle:   rand(0, PI2),
        rotSpd:  rand(1.0, 2.4) * obsSpd * (Math.random() < 0.5 ? 1 : -1),  // rad/s
        armLen,
        numArms: Math.random() < 0.35 ? 3 : 2,
        color:   pick(PALETTE),
        age:     0,
        // Optional vertical surge: rotator approaches slightly faster than scroll
        extraVy: rand(0, 60),   // extra px/s downward
      });

    } else if (type === 'hbar') {
      const gw = clamp(gapW * rand(0.85, 1.15), GAP_MIN, GAP_MAX);
      obstacles.push({
        type:    'hbar',
        x:       0,
        y:       -(BAR_H + 4),
        gapX:    rand(gw / 2 + 18, W - gw / 2 - 18),
        gapW:    gw,
        gapSpd:  rand(55, 140) * obsSpd * (Math.random() < 0.5 ? 1 : -1),  // px/s
        color:   pick(PALETTE),
      });

    } else { // slider
      const r    = rand(SL_R_MIN, SL_R_MAX);
      const hspd = rand(80, 190) * obsSpd;
      obstacles.push({
        type:   'slider',
        x:      rand(r + 12, W - r - 12),
        y:      -(r + 12),
        r,
        vx:     hspd * (Math.random() < 0.5 ? 1 : -1),   // px/s
        phase:  rand(0, PI2),   // pulse phase
        color:  pick(PALETTE),
        age:    0,
      });
    }
  }

  // ── Collision detection ────────────────────────────────────────────
  function checkHit(obs) {
    const px = fingerX, py = fingerY;

    if (obs.type === 'rotator') {
      if (obs.age < ROT_GRACE) return false;
      const dx   = px - obs.x;
      const dy   = py - obs.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 12 || dist > obs.armLen + PLAYER_HIT_R) return false;

      const fa    = Math.atan2(dy, dx);
      const halfW = Math.atan2(ROT_ARM_HALF + PLAYER_HIT_R, dist);

      for (let k = 0; k < obs.numArms; k++) {
        const aa = obs.angle + k * PI2 / obs.numArms;
        let d = fa - aa;
        d = ((d % PI2) + PI2) % PI2;
        if (d > Math.PI) d -= PI2;
        if (Math.abs(d) < halfW) return true;
      }
      return false;
    }

    if (obs.type === 'hbar') {
      // Player inside the bar's y-range?
      if (py < obs.y - PLAYER_HIT_R || py > obs.y + BAR_H + PLAYER_HIT_R) return false;
      // Player inside the gap's x-range (safe zone)?
      const hg = obs.gapW / 2;
      if (px > obs.gapX - hg + PLAYER_HIT_R && px < obs.gapX + hg - PLAYER_HIT_R) return false;
      return true;
    }

    if (obs.type === 'slider') {
      // Use pulsed radius for collision too (player can use the shrink window)
      const pr = obs.r * (1 + SL_PULSE_AMP * Math.sin(obs.age * SL_PULSE_FREQ * PI2));
      return Math.hypot(px - obs.x, py - obs.y) < pr + PLAYER_HIT_R;
    }

    return false;
  }

  // ── Particles ──────────────────────────────────────────────────────
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, PI2);
      const s = rand(2, 9);
      particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r:     rand(2, 5.5),
        life:  1,
        decay: rand(0.02, 0.05),
        color,
      });
    }
  }

  // ── Game lifecycle ─────────────────────────────────────────────────
  function gotoWaiting() {
    state         = 'waiting';
    fingerDown    = false;
    obstacles     = [];
    particles     = [];
    trail         = [];
    elapsed       = 0;
    nextMilestone = MILESTONE_SEC;
    spawnTimer    = 0;
    fingerX = W / 2; fingerY = H * 0.72;
    showOverlay('overlay-start', false);
    showOverlay('overlay-over',  false);
    document.getElementById('score').textContent = '0.0s';
  }

  function startPlaying() {
    state         = 'playing';
    obstacles     = [];
    particles     = [];
    trail         = [];
    elapsed       = 0;
    nextMilestone = MILESTONE_SEC;
    spawnTimer    = 1.0;   // first obstacle after 1 s
    lastTime      = performance.now();
    TowerLife.onGameReady('finger');
  }

  function endGame(reason) {
    state = 'dead';
    GameAudio.die();

    if (elapsed > highScore) {
      highScore = elapsed;
      Save.save('finger_best', highScore);
    }
    TowerLife.onGameOver(Math.round(elapsed * 10));

    burst(fingerX, fingerY, reason === 'hit' ? '#ff2255' : '#ffdd00', 26);

    document.getElementById('over-reason').textContent =
      reason === 'hit' ? 'OBSTACLE HIT!' : 'FINGER LIFTED!';
    document.getElementById('over-reason').style.color =
      reason === 'hit' ? '#ff2255' : '#ffdd00';
    document.getElementById('final-score').textContent = fmtTime(elapsed);
    document.getElementById('final-high').textContent  = fmtTime(highScore);
    document.getElementById('high-score').textContent  = fmtTime(highScore);
    showOverlay('overlay-over', true);
  }

  // ── Main loop ──────────────────────────────────────────────────────
  function loop(now) {
    const dt = clamp((now - lastTime) / 1000, 0, 0.05);
    lastTime = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update(dt) {
    // ── Speed lines always animate ────────────────────────────────────
    const bgSpd = (state === 'playing' ? scrollSpeed() : SCROLL_START) * 1.6;
    for (const sl of speedLines) {
      sl.y += bgSpd * dt;
      if (sl.y > H) sl.y -= (H + sl.len);
    }

    // ── Particles always decay ────────────────────────────────────────
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x  += p.vx * dt * 60;
      p.y  += p.vy * dt * 60;
      p.vy += 0.12;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state !== 'playing') return;

    // ── Core game update ──────────────────────────────────────────────
    elapsed += dt;
    document.getElementById('score').textContent = fmtTime(elapsed);

    if (elapsed >= nextMilestone) {
      GameAudio.score();
      nextMilestone += MILESTONE_SEC;
    }

    TowerLife.sendScore(Math.round(elapsed * 10));

    const ss              = scrollSpeed();      // px/s downward for all obstacles
    const { maxObs, spawnSec } = getDiff(elapsed);

    // Trail
    trail.unshift({ x: fingerX, y: fingerY });
    if (trail.length > TRAIL_LEN) trail.pop();

    // Spawn
    spawnTimer -= dt;
    if (spawnTimer <= 0 && obstacles.length < maxObs) {
      spawnObstacle();
      spawnTimer = spawnSec;
    }

    // Update obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];

      // All obstacles move down at current scroll speed
      obs.y += ss * dt;

      if (obs.type === 'rotator') {
        obs.angle += obs.rotSpd * dt;
        obs.age   += dt;
        obs.y     += obs.extraVy * dt;   // optional surge

      } else if (obs.type === 'hbar') {
        obs.gapX += obs.gapSpd * dt;
        // Bounce gap within screen bounds
        const minGX = obs.gapW / 2 + 10;
        const maxGX = W - obs.gapW / 2 - 10;
        if ((obs.gapX < minGX && obs.gapSpd < 0) ||
            (obs.gapX > maxGX && obs.gapSpd > 0)) {
          obs.gapSpd = -obs.gapSpd;
        }
        obs.gapX = clamp(obs.gapX, minGX, maxGX);

      } else { // slider
        obs.x   += obs.vx * dt;
        obs.age += dt;
        // Bounce horizontally
        if ((obs.x - obs.r < 0 && obs.vx < 0) ||
            (obs.x + obs.r > W && obs.vx > 0)) {
          obs.vx = -obs.vx;
          obs.x  = clamp(obs.x, obs.r, W - obs.r);
        }
      }

      // Off-screen removal
      if (obs.y > H + 120) { obstacles.splice(i, 1); continue; }

      // Collision check
      if (fingerDown && checkHit(obs)) {
        endGame('hit');
        return;
      }
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────
  function draw() {
    const t  = performance.now() / 1000;
    const ss = state === 'playing' ? scrollSpeed() : SCROLL_START;

    // ── Background ────────────────────────────────────────────────────
    ctx.fillStyle = '#060612';
    ctx.fillRect(0, 0, W, H);

    // ── Speed lines ───────────────────────────────────────────────────
    const lineBright = 0.4 + 0.6 * (ss / SCROLL_MAX);
    for (const sl of speedLines) {
      ctx.globalAlpha = sl.alpha * lineBright;
      ctx.strokeStyle = '#aaccff';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sl.x, sl.y + sl.len * lineBright);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // ── Subtle lane guides ────────────────────────────────────────────
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.setLineDash([20, 30]);
    for (const lx of [W * 0.33, W * 0.67]) {
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (state === 'waiting') {
      drawWaitPrompt(t);
      return;
    }

    // ── Obstacles ─────────────────────────────────────────────────────
    for (const obs of obstacles) drawObstacle(obs);

    // ── Player trail ──────────────────────────────────────────────────
    if (fingerDown && trail.length > 1) {
      for (let i = trail.length - 1; i >= 0; i--) {
        const frac  = 1 - i / trail.length;
        ctx.globalAlpha = frac * 0.35;
        ctx.fillStyle   = '#00ff88';
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, PLAYER_R * frac * 0.65, 0, PI2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ── Particles ─────────────────────────────────────────────────────
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, PI2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Player ────────────────────────────────────────────────────────
    if (fingerDown) drawPlayer(fingerX, fingerY, t);
  }

  // ── Wait prompt ────────────────────────────────────────────────────
  function drawWaitPrompt(t) {
    const alpha = 0.55 + 0.45 * Math.sin(t * 2.4);
    ctx.globalAlpha  = alpha;
    ctx.fillStyle    = '#00ff88';
    ctx.shadowColor  = '#00ff88';
    ctx.shadowBlur   = 14;
    ctx.font         = 'bold 15px "Courier New", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOUCH & HOLD TO SPEED AHEAD', W / 2, H / 2);
    ctx.globalAlpha  = 1;
    ctx.shadowBlur   = 0;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Obstacle drawing ───────────────────────────────────────────────
  function drawObstacle(obs) {
    if (obs.type === 'rotator') drawRotator(obs);
    else if (obs.type === 'hbar') drawHBar(obs);
    else drawSlider(obs);
    ctx.shadowBlur = 0;
  }

  function drawRotator(obs) {
    ctx.save();
    ctx.translate(obs.x, obs.y);
    ctx.rotate(obs.angle);

    // Fade in during grace period
    const alpha = obs.age < ROT_GRACE ? obs.age / ROT_GRACE : 1;
    ctx.globalAlpha = alpha;

    ctx.shadowColor = obs.color;
    ctx.shadowBlur  = 14;

    for (let k = 0; k < obs.numArms; k++) {
      ctx.save();
      ctx.rotate(k * PI2 / obs.numArms);

      // Arm body
      ctx.strokeStyle = obs.color;
      ctx.lineWidth   = ROT_ARM_HALF * 2;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(obs.armLen, 0);
      ctx.stroke();

      // Bright tip
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2.5;
      ctx.shadowBlur  = 22;
      ctx.beginPath();
      ctx.moveTo(obs.armLen - 12, 0);
      ctx.lineTo(obs.armLen + 4,  0);
      ctx.stroke();

      ctx.restore();
    }

    // Hub
    ctx.fillStyle  = obs.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, PI2);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHBar(obs) {
    const halfGap = obs.gapW / 2;

    ctx.shadowColor = obs.color;
    ctx.shadowBlur  = 12;
    ctx.fillStyle   = obs.color;

    // Left solid segment
    if (obs.gapX - halfGap > 0) {
      ctx.fillRect(0, obs.y, obs.gapX - halfGap, BAR_H);
    }
    // Right solid segment
    if (obs.gapX + halfGap < W) {
      ctx.fillRect(obs.gapX + halfGap, obs.y, W - (obs.gapX + halfGap), BAR_H);
    }

    // Bright gap edges (make the gap obvious)
    ctx.shadowBlur  = 18;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'square';

    ctx.beginPath();
    ctx.moveTo(obs.gapX - halfGap, obs.y - 2);
    ctx.lineTo(obs.gapX - halfGap, obs.y + BAR_H + 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(obs.gapX + halfGap, obs.y - 2);
    ctx.lineTo(obs.gapX + halfGap, obs.y + BAR_H + 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';
  }

  function drawSlider(obs) {
    // Pulsing radius
    const pr = obs.r * (1 + SL_PULSE_AMP * Math.sin(obs.age * SL_PULSE_FREQ * PI2));

    ctx.shadowColor = obs.color;
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = obs.color + '28';
    ctx.strokeStyle = obs.color;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(obs.x, obs.y, pr, 0, PI2);
    ctx.fill();
    ctx.stroke();

    // Inner bright ring
    ctx.shadowBlur  = 22;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(obs.x, obs.y, pr * 0.5, 0, PI2);
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  function drawPlayer(x, y, t) {
    // Subtle danger warning if close to any obstacle
    let minD = Infinity;
    for (const obs of obstacles) {
      let d = Math.hypot(x - obs.x, y - obs.y);
      if (obs.type !== 'rotator') d -= obs.r ?? 0;
      if (d < minD) minD = d;
    }
    if (minD < 70 && obstacles.length > 0) {
      const intensity = 1 - minD / 70;
      ctx.strokeStyle = `rgba(255,40,40,${(intensity * 0.6).toFixed(2)})`;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_R + 14, 0, PI2);
      ctx.stroke();
    }

    // Outer glow ring
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur  = 20;
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_R, 0, PI2);
    ctx.stroke();

    // Filled centre dot
    ctx.fillStyle  = '#00ff88';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_R * 0.42, 0, PI2);
    ctx.fill();

    // Forward-pointing arrow above the player
    const ay = y - PLAYER_R - 5;
    ctx.shadowBlur = 14;
    ctx.fillStyle  = '#00ff88';
    ctx.beginPath();
    ctx.moveTo(x,     ay - 6);
    ctx.lineTo(x - 5, ay + 1);
    ctx.lineTo(x + 5, ay + 1);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  // ── Input ──────────────────────────────────────────────────────────
  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * W / r.width,
      y: (e.clientY - r.top)  * H / r.height,
    };
  }

  function onDown(e) {
    e.preventDefault();
    const p = canvasXY(e);
    fingerX = p.x; fingerY = p.y;
    fingerDown = true;
    if (state === 'waiting') startPlaying();
  }

  function onMove(e) {
    e.preventDefault();
    if (!fingerDown) return;
    const p = canvasXY(e);
    fingerX = p.x; fingerY = p.y;
  }

  function onUp(e) {
    e.preventDefault();
    fingerDown = false;
    if (state === 'playing') endGame('lift');
  }

  function initInput() {
    canvas.addEventListener('pointerdown',   onDown, { passive: false });
    canvas.addEventListener('pointermove',   onMove, { passive: false });
    canvas.addEventListener('pointerup',     onUp,   { passive: false });
    canvas.addEventListener('pointercancel', onUp,   { passive: false });
    canvas.style.touchAction = 'none';
  }

  // ── Unity bridge ───────────────────────────────────────────────────
  /** Called from Unity to set normalised position (0–1 each axis). */
  window.finger_setPos = function (nx, ny) {
    fingerX = clamp(nx, 0, 1) * W;
    fingerY = clamp(ny, 0, 1) * H;
  };

  // ── Overlay helper ─────────────────────────────────────────────────
  function showOverlay(id, visible) {
    document.getElementById(id)?.classList.toggle('hidden', !visible);
  }

  // ── Boot ───────────────────────────────────────────────────────────
  function init() {
    highScore = Save.load('finger_best', 0);

    initCanvas();
    initSpeedLines();
    initInput();

    document.getElementById('btn-start').addEventListener('click', gotoWaiting);
    document.getElementById('btn-restart').addEventListener('click', gotoWaiting);
    document.getElementById('btn-mute').addEventListener('click', () => {
      const muted = !GameAudio.isMuted();
      GameAudio.setMuted(muted);
      document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
    });

    document.getElementById('high-score').textContent = fmtTime(highScore);
    document.getElementById('score').textContent      = '0.0s';

    state    = 'idle';
    lastTime = performance.now();
    raf      = requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
