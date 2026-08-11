/**
 * colorhop.js — Color Switch-clone "Color Hop"
 *
 * Tap to give the ball an upward impulse. Gravity pulls it back down.
 * Rotating rings descend toward the ball — each ring has four coloured
 * segments (one per colour). The ball must pass through the segment that
 * matches its current colour. Hitting any other colour = game over.
 * Each successful passage scores a point and changes the ball colour.
 * Ring rotation speed increases with score.
 *
 * Controls:
 *   Touch / Click : tap anywhere on the canvas
 *   Keyboard      : Space or Enter
 *   Unity bridge  : window.colorhop_tap()
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Neon palette (4 colours, one per ring segment) ─────────────────
  const COLORS = ['#ff2255', '#00ccff', '#ffdd00', '#aa44ff'];
  const PI2    = Math.PI * 2;

  // ── Ball ───────────────────────────────────────────────────────────
  const BALL_R       = 11;          // px radius
  const BALL_X       = W / 2;       // always centred horizontally
  const GRAVITY      = 1100;        // px / s²  (downward)
  const TAP_VY       = -560;        // px / s   (upward impulse on tap)
  const FLOOR_WORLD  = H - 50;      // world Y of the floor (= 530)
  const FLOOR_BOUNCE = -260;        // vy after floor bounce

  // ── Camera ─────────────────────────────────────────────────────────
  // Ball is kept at this canvas Y while the camera is tracking upward.
  const CAM_TARGET_Y = Math.round(H * 0.60); // 348

  // ── Ring geometry ──────────────────────────────────────────────────
  const RING_RO  = 54;                     // outer radius px
  const RING_RI  = 34;                     // inner radius px
  const RING_W   = RING_RO - RING_RI;      // stroke width = 20
  const RING_MID = (RING_RO + RING_RI) / 2; // arc draw radius = 44
  const RING_SEG = 4;
  const SEG_SPAN = PI2 / RING_SEG;         // 90° each
  const GAP_FRAC = 0.10;                   // fraction of SEG_SPAN that is gap (per side)
  const GAP_HALF = SEG_SPAN * GAP_FRAC / 2;
  const RING_SPACE = 150;                  // world distance between successive rings

  // ── Collision band (approach from below only) ──────────────────────
  // Ball enters lower band when dy = ballWorldY - ring.worldY is in [LO, HI].
  const COLL_LO = RING_RI - BALL_R;        // 23
  const COLL_HI = RING_RO + BALL_R;        // 65

  // ── Rotation speed (increases with score) ──────────────────────────
  const ROT_BASE = 1.2;    // rad / s at score 0
  const ROT_MAX  = 6.5;    // rad / s cap
  const ROT_STEP = 0.14;   // rad / s added per score point

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let ballWorldY; // ball Y in world coords (increases downward)
  let ballVY;     // Y velocity (negative = up, positive = down)
  let ballColorIdx;
  let cameraY;    // world Y shown at the TOP of the canvas
  let score, highScore;
  let rings      = [];  // [{worldY, angle, rotDir, colorOffset, crossed}]
  let nextRingWorldY;
  let particles  = [];  // canvas-space particles
  let state;            // 'idle' | 'playing' | 'dead'
  let lastTime, raf;
  let invincibleUntil = 0; // ms timestamp — collisions disabled until then

  // ── Utilities ──────────────────────────────────────────────────────
  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function rotSpeed() {
    return Math.min(ROT_BASE + score * ROT_STEP, ROT_MAX);
  }

  /**
   * Returns the colour index (0-3) at a given angle from the ring centre,
   * accounting for the ring's current rotation, or -1 if the angle falls
   * inside a gap between segments.
   */
  function colorAtAngle(angle, ring) {
    const a        = ((angle - ring.angle) % PI2 + PI2) % PI2;
    const segIdx   = Math.floor(a / SEG_SPAN);
    const posInSeg = a % SEG_SPAN;
    if (posInSeg < GAP_HALF || posInSeg > SEG_SPAN - GAP_HALF) return -1; // gap
    return (segIdx + ring.colorOffset) % RING_SEG;
  }

  // ── Ring spawning ──────────────────────────────────────────────────
  function spawnRing(worldY) {
    rings.push({
      worldY,
      angle:       rand(0, PI2),
      rotDir:      Math.random() < 0.5 ? 1 : -1,
      colorOffset: Math.floor(Math.random() * RING_SEG),
      crossed:     false,
    });
    nextRingWorldY = worldY - RING_SPACE;
  }

  // ── Particle burst ─────────────────────────────────────────────────
  function burst(worldY, color, n) {
    const cy = worldY - cameraY;
    for (let i = 0; i < n; i++) {
      const a = rand(0, PI2);
      const s = rand(70, 210);
      particles.push({
        x:     BALL_X,
        y:     cy,
        vx:    Math.cos(a) * s,
        vy:    Math.sin(a) * s,
        r:     rand(2.5, 5),
        life:  1,
        decay: rand(0.022, 0.055),
        color,
      });
    }
  }

  // ── Overlay helper ─────────────────────────────────────────────────
  function showOverlay(id, visible) {
    document.getElementById(id)?.classList.toggle('hidden', !visible);
  }

  // ── HUD colour dot ─────────────────────────────────────────────────
  function updateColorDot() {
    const dot = document.getElementById('color-dot');
    if (!dot) return;
    const c = COLORS[ballColorIdx];
    dot.style.backgroundColor = c;
    dot.style.boxShadow        = `0 0 6px 1px ${c}`;
  }

  // ── Canvas init ────────────────────────────────────────────────────
  function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    function resize() {
      const hud    = document.getElementById('hud');
      const hudH   = hud ? hud.offsetHeight + 4 : 44;
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

  // ── Game lifecycle ─────────────────────────────────────────────────
  function startGame() {
    if (!TowerLife.Credits.consume(startGame)) return;
    ballWorldY      = FLOOR_WORLD;
    ballVY          = 0;           // player must tap to launch
    ballColorIdx    = Math.floor(Math.random() * COLORS.length);
    cameraY         = Math.max(0, FLOOR_WORLD - CAM_TARGET_Y);
    score           = 0;
    invincibleUntil = performance.now() + 600; // 0.6 s grace at start
    rings           = [];
    particles       = [];

    // First ring close enough that one tap passes its centre
    let ry = FLOOR_WORLD - 100; // first ring at world Y = 430
    for (let i = 0; i < 6; i++) spawnRing(ry);

    showOverlay('overlay-start', false);
    showOverlay('overlay-over',  false);
    document.getElementById('score').textContent = '0';
    updateColorDot();
    state    = 'playing';
    lastTime = performance.now();
    TowerLife.onGameReady('colorhop');
  }

  function gameOver() {
    if (state !== 'playing') return;
    state = 'dead';
    GameAudio.die();
    burst(ballWorldY, COLORS[ballColorIdx], 22);

    if (score > highScore) {
      highScore = score;
      Save.save('colorhop_best', highScore);
    }
    TowerLife.onGameOver(score);

    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    document.getElementById('high-score').textContent  = highScore;
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
    // Particles always animate (canvas-space)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.vy   += 0.28 * GRAVITY * dt;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state !== 'playing') return;

    // ── Ball physics (world coordinates) ────────────────────────────
    ballVY    += GRAVITY * dt;
    ballWorldY += ballVY * dt;

    if (ballWorldY >= FLOOR_WORLD) {
      ballWorldY = FLOOR_WORLD;
      ballVY     = FLOOR_BOUNCE;
    }

    // ── Camera: snap upward, smooth downward ─────────────────────────
    const targetCam = Math.max(0, ballWorldY - CAM_TARGET_Y);
    if (targetCam < cameraY) {
      cameraY = targetCam;                                   // instant up
    } else {
      cameraY += (targetCam - cameraY) * Math.min(1, 7 * dt); // smooth down
    }

    // ── Rotate rings ──────────────────────────────────────────────────
    const rs = rotSpeed();
    for (const r of rings) {
      r.angle = (r.angle + r.rotDir * rs * dt + PI2) % PI2;
    }

    // ── Collision and scoring ─────────────────────────────────────────
    for (const ring of rings) {
      if (ring.crossed) continue;

      // dy > 0  →  ball is below ring in world space  (normal approach)
      // dy ≤ 0  →  ball has passed or reached ring centre  →  score
      const dy = ballWorldY - ring.worldY;

      if (dy <= 0) {
        // Ball rose above ring centre — score!
        ring.crossed = true;
        score++;
        document.getElementById('score').textContent = score;
        TowerLife.sendScore(score);
        GameAudio.score();
        burst(ring.worldY, COLORS[ballColorIdx], 14);

        // Change to a random different colour
        const next = (ballColorIdx + 1 + Math.floor(Math.random() * (COLORS.length - 1))) % COLORS.length;
        ballColorIdx = next;
        updateColorDot();
        invincibleUntil = performance.now() + 200; // 200 ms grace after each pass
        continue;
      }

      // Ball inside the lower approach band — check colour ONLY while rising.
      // If the ball stalls and falls back, it retreats through the band safely.
      if (dy >= COLL_LO && dy <= COLL_HI && ballVY < 0) {
        if (performance.now() >= invincibleUntil) {
          // Ball is directly below ring centre (both at X = W/2), angle = π/2
          const colorIdx = colorAtAngle(Math.PI / 2, ring);
          if (colorIdx !== -1 && colorIdx !== ballColorIdx) {
            gameOver();
            return;
          }
        }
      }
    }

    // ── Spawn more rings as camera moves up ───────────────────────────
    while (nextRingWorldY - cameraY > -(RING_RO + 40)) {
      spawnRing(nextRingWorldY);
    }

    // ── Cull rings that have drifted far below the canvas ─────────────
    for (let i = rings.length - 1; i >= 0; i--) {
      if (rings[i].worldY - cameraY > H + RING_RO + 60) rings.splice(i, 1);
    }
  }

  // ── Drawing ────────────────────────────────────────────────────────
  function draw() {
    const t = performance.now() / 1000;

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    // Faint vertical centre guide
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(BALL_X, 0);
    ctx.lineTo(BALL_X, H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Rings
    for (const r of rings) {
      const cy = r.worldY - cameraY;
      if (cy < -(RING_RO + 10) || cy > H + RING_RO + 10) continue;
      drawRing(r, cy);
    }

    // Floor dashed line (when visible)
    const floorCy = FLOOR_WORLD - cameraY;
    if (floorCy > 0 && floorCy < H) {
      ctx.globalAlpha = 0.20;
      ctx.strokeStyle = '#555';
      ctx.lineWidth   = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(0, floorCy);
      ctx.lineTo(W, floorCy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Ball
    if (state !== 'idle') {
      drawBall(t);
    }

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, PI2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }

  function drawBall(t) {
    const cy    = ballWorldY - cameraY;
    const bc    = COLORS[ballColorIdx];
    const pulse = 1 + 0.07 * Math.sin(t * 9);

    ctx.shadowColor = bc;
    ctx.shadowBlur  = 20;
    ctx.fillStyle   = bc;
    ctx.beginPath();
    ctx.arc(BALL_X, cy, BALL_R * pulse, 0, PI2);
    ctx.fill();

    // Bright inner core
    ctx.fillStyle  = 'rgba(255,255,255,0.88)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(BALL_X, cy, BALL_R * 0.34 * pulse, 0, PI2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  function drawRing(ring, cy) {
    ctx.lineWidth = RING_W;
    ctx.lineCap   = 'round';

    for (let i = 0; i < RING_SEG; i++) {
      const colorIdx   = (i + ring.colorOffset) % RING_SEG;
      const color      = COLORS[colorIdx];
      const startAngle = ring.angle + i * SEG_SPAN + GAP_HALF;
      const endAngle   = ring.angle + (i + 1) * SEG_SPAN - GAP_HALF;

      ctx.shadowColor = color;
      ctx.shadowBlur  = 12;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(W / 2, cy, RING_MID, startAngle, endAngle);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.lineCap    = 'butt';
  }

  // ── Input ──────────────────────────────────────────────────────────
  function onTap(e) {
    if (e) e.preventDefault();

    if (state === 'playing') {
      ballVY = TAP_VY;
      GameAudio.eat();
    } else if (state === 'idle') {
      startGame();
    }
  }

  function initInput() {
    canvas.addEventListener('pointerdown', onTap, { passive: false });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onTap();
      }
    });
  }

  // Unity bridge — call from C# to simulate a tap
  window.colorhop_tap = function () { onTap(); };

  // ── Boot ───────────────────────────────────────────────────────────
  function init() {
    highScore = Save.load('colorhop_best', 0);
    initCanvas();
    initInput();

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', startGame);
    document.getElementById('btn-mute').addEventListener('click', () => {
      const muted = !GameAudio.isMuted();
      GameAudio.setMuted(muted);
      document.getElementById('btn-mute').textContent = muted ? '🔇' : '🔊';
    });

    document.getElementById('high-score').textContent = highScore;
    document.getElementById('score').textContent      = '0';
    updateColorDot();

    state    = 'idle';
    lastTime = performance.now();
    raf      = requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
