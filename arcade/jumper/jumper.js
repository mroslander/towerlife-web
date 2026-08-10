/**
 * jumper.js — Doodle Jump-clone "Jumper"
 *
 * Controls:
 *   Touch  : tap/hold left half of screen = move left, right half = move right
 *   Desktop: ArrowLeft / A  and  ArrowRight / D
 *   Unity  : window.jumper_setInput(x)  where x is -1…1
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;   // logical canvas width
  const H = 580;   // logical canvas height

  // ── Physics ────────────────────────────────────────────────────────
  const GRAVITY     = 0.40;   // px / frame²
  const JUMP_VY     = -13.0;  // initial upward velocity on bounce
  const SPRING_VY   = -20.0;  // velocity when hitting a spring pad
  const MOVE_SPEED  =  5.0;   // horizontal px / frame at full input

  // Player dimensions
  const P_W = 28;
  const P_H = 26;

  // Platform height (visual + collision)
  const PLAT_H = 12;

  // Score scale factor: score = height_climbed_px * SCORE_SCALE
  const SCORE_SCALE = 0.1;

  // ── Difficulty table ───────────────────────────────────────────────
  // Tuned to ramp hard quickly so sessions stay under 2-3 minutes.
  // minGap/maxGap : vertical distance between successive platforms (px)
  // minW/maxW     : platform width range (px)
  // movingP       : probability of a platform being a moving one
  // breakP        : probability of a platform being a crumbling one
  // springP       : probability of a spring pad appearing on a normal platform
  const DIFF = [
    { score:    0, minGap:  52, maxGap:  70, minW: 88, maxW:112, movingP:0.00, breakP:0.00, springP:0.04 },
    { score:  150, minGap:  62, maxGap:  88, minW: 74, maxW: 96, movingP:0.10, breakP:0.00, springP:0.04 },
    { score:  320, minGap:  72, maxGap: 105, minW: 62, maxW: 82, movingP:0.20, breakP:0.08, springP:0.03 },
    { score:  540, minGap:  82, maxGap: 120, minW: 52, maxW: 70, movingP:0.28, breakP:0.16, springP:0.03 },
    { score:  800, minGap:  92, maxGap: 135, minW: 44, maxW: 60, movingP:0.33, breakP:0.23, springP:0.02 },
    { score: 1100, minGap: 100, maxGap: 148, minW: 38, maxW: 52, movingP:0.37, breakP:0.28, springP:0.02 },
    { score: 1450, minGap: 108, maxGap: 158, minW: 34, maxW: 46, movingP:0.40, breakP:0.32, springP:0.01 },
    { score: 1900, minGap: 114, maxGap: 164, minW: 30, maxW: 42, movingP:0.42, breakP:0.36, springP:0.01 },
  ];

  // Maximum jump height (px): vy² / (2 * gravity) = 13² / (2 * 0.4) ≈ 211
  // maxGap is capped at 164 — safely reachable even from a narrow platform edge.

  // Platform types
  const T_NORMAL  = 0;
  const T_MOVING  = 1;
  const T_BREAK   = 2;

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let player;
  let platforms, particles, springs, stars;
  let cameraY;      // world Y at the top edge of the canvas
  let score, highScore;
  let peakY;        // lowest world Y the player has ever reached this run
  let inputX;       // combined touch/keyboard: -1 | 0 | 1
  let joystickX;    // unity virtual joystick: -1…1
  let state;        // 'idle' | 'playing' | 'over'
  let raf;
  const ptrs = {};  // pointerId → 'left' | 'right'

  // ── Utilities ──────────────────────────────────────────────────────
  const rand   = (a, b) => a + Math.random() * (b - a);
  const clamp  = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

  function getDiff(sc) {
    let d = DIFF[0];
    for (let i = 1; i < DIFF.length; i++) {
      if (sc >= DIFF[i].score) d = DIFF[i]; else break;
    }
    return d;
  }

  // ── Stars (decorative background) ─────────────────────────────────
  function initStars() {
    stars = [];
    for (let i = 0; i < 65; i++) {
      stars.push({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(0.4, 1.6),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.4, 1.2),
      });
    }
  }

  // ── Platform factory ───────────────────────────────────────────────
  function makePlatform(worldY, sc) {
    const d   = getDiff(sc);
    const w   = rand(d.minW, d.maxW);
    const x   = rand(0, W - w);
    const rnd = Math.random();
    let   type = T_NORMAL;
    if      (rnd < d.breakP)               type = T_BREAK;
    else if (rnd < d.breakP + d.movingP)   type = T_MOVING;

    const hasSpring = (type === T_NORMAL) && Math.random() < d.springP;

    return {
      x, y: worldY, w, type,
      vx:          type === T_MOVING ? (Math.random() < 0.5 ? 1.6 : -1.6) : 0,
      crumbling:   false,
      crumbleTick: 0,
      broken:      false,
      spring:      hasSpring,
    };
  }

  // ── Platform pool management ───────────────────────────────────────
  function initPlatforms() {
    platforms = [];

    // Solid wide starting platform
    platforms.push({
      x: (W - 110) / 2,
      y: H * 0.68,
      w: 110,
      type: T_NORMAL,
      vx: 0,
      crumbling: false,
      crumbleTick: 0,
      broken: false,
      spring: false,
    });

    let worldY   = H * 0.68;
    let accumSc  = 0;
    while (worldY > -H * 2.5) {
      const d  = getDiff(accumSc);
      worldY  -= rand(d.minGap, d.maxGap);
      platforms.push(makePlatform(worldY, accumSc));
      accumSc += 1;
    }
  }

  function extendUp() {
    let topY = Infinity;
    for (const p of platforms) if (p.y < topY) topY = p.y;

    let worldY = topY;
    while (worldY > cameraY - H * 2) {
      const d  = getDiff(score);
      worldY  -= rand(d.minGap, d.maxGap);
      platforms.push(makePlatform(worldY, score));
    }
  }

  function pruneBelow() {
    const cutoff = cameraY + H * 1.6;
    platforms = platforms.filter(p => p.y < cutoff);
  }

  // ── Particles ──────────────────────────────────────────────────────
  function burst(wx, wy, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(1.2, 4.5);
      particles.push({
        x: wx, y: wy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.8,
        life: 1.0,
        decay: rand(0.025, 0.065),
        color,
        sz: rand(2, 5),
      });
    }
  }

  // ── Game init ──────────────────────────────────────────────────────
  function newGame() {
    score     = 0;
    inputX    = 0;
    particles = [];
    springs   = [];

    initPlatforms();

    const sp = platforms[0];
    player = {
      x:   W / 2 - P_W / 2,
      y:   sp.y - P_H,
      vx:  0,
      vy:  JUMP_VY,
      dir: 1,          // 1 = facing right, -1 = facing left
    };

    peakY   = player.y;
    cameraY = player.y - H * 0.35;

    UI.setScore('score',      0);
    UI.setScore('high-score', highScore);
  }

  // ── Game over ──────────────────────────────────────────────────────
  function doGameOver() {
    state = 'over';
    cancelAnimationFrame(raf);

    if (score > highScore) {
      highScore = score;
      Save.save('jumper_high', highScore);
    }

    UI.setScore('high-score', highScore);
    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    UI.showOverlay('overlay-over');
    TowerLife.onGameOver(score);
  }

  // ── Update ─────────────────────────────────────────────────────────
  function update() {
    // Resolve input (Unity joystick takes priority when non-zero)
    const ix = (joystickX !== 0) ? joystickX : inputX;
    if      (ix >  0.05) player.dir =  1;
    else if (ix < -0.05) player.dir = -1;

    // Horizontal
    player.x += ix * MOVE_SPEED;

    // Screen wrap
    if (player.x + P_W < 0) player.x = W;
    if (player.x        > W) player.x = -P_W;

    // Gravity + cap fall speed to avoid tunneling
    player.vy  = clamp(player.vy + GRAVITY, -30, 16);
    player.y  += player.vy;

    // ── Platform collisions (only while falling) ───────────────────
    if (player.vy > 0) {
      const feet     = player.y + P_H;
      const prevFeet = feet - player.vy;

      for (const p of platforms) {
        if (p.broken) continue;
        if (
          prevFeet <= p.y &&
          feet     >= p.y &&
          player.x + P_W > p.x &&
          player.x       < p.x + p.w
        ) {
          player.y = p.y - P_H;

          if (p.spring) {
            // Spring: super-jump
            player.vy = SPRING_VY;
            burst(player.x + P_W / 2, p.y, '#ffff00', 10);
          } else if (p.type === T_BREAK) {
            // Crumbling: one bounce then disappear
            player.vy = JUMP_VY;
            if (!p.crumbling) {
              p.crumbling   = true;
              p.crumbleTick = 24;
              burst(player.x + P_W / 2, p.y, '#ff8800', 8);
            }
          } else {
            player.vy = JUMP_VY;
            burst(player.x + P_W / 2, p.y, '#00ff88', 5);
          }
          break;
        }
      }
    }

    // ── Move & crumble platforms ───────────────────────────────────
    for (const p of platforms) {
      if (p.type === T_MOVING && !p.broken) {
        p.x += p.vx;
        if (p.x < 0 || p.x + p.w > W) {
          p.vx = -p.vx;
          p.x   = clamp(p.x, 0, W - p.w);
        }
      }
      if (p.crumbling) {
        p.crumbleTick--;
        if (p.crumbleTick <= 0) p.broken = true;
      }
    }

    // ── Camera: only scroll upward ─────────────────────────────────
    const camTarget = player.y - H * 0.35;
    if (camTarget < cameraY) cameraY = camTarget;

    // ── Score (height climbed) ─────────────────────────────────────
    if (player.y < peakY) {
      const rise = peakY - player.y;
      peakY  = player.y;
      score += Math.round(rise * SCORE_SCALE);
      UI.setScore('score', score);
      TowerLife.sendScore(score);
    }

    // ── Platform pool ──────────────────────────────────────────────
    extendUp();
    pruneBelow();

    // ── Particles ─────────────────────────────────────────────────
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x    += pt.vx;
      pt.y    += pt.vy;
      pt.vy   += 0.14;
      pt.life -= pt.decay;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    // ── Game over ─────────────────────────────────────────────────
    if (player.y - cameraY > H + 80) doGameOver();
  }

  // ── Draw ────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#00071a');
    bg.addColorStop(1, '#000c2e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Stars (parallax factor 0.08 so they shift very slightly upward)
    const t = Date.now() / 1000;
    for (const s of stars) {
      const screenY = ((s.y - cameraY * 0.08) % H + H) % H;
      ctx.globalAlpha = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, screenY, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const oy = -cameraY; // world → screen: screenY = worldY + oy

    // ── Platforms ─────────────────────────────────────────────────
    for (const p of platforms) {
      if (p.broken) continue;
      const sy = p.y + oy;
      if (sy < -20 || sy > H + 20) continue;

      let col;
      if (p.crumbling) {
        col = (Math.floor(p.crumbleTick / 3) % 2 === 0) ? '#ff2200' : '#ff9900';
      } else {
        switch (p.type) {
          case T_MOVING: col = '#00bbff'; break;
          case T_BREAK:  col = '#ff7700'; break;
          default:       col = '#00dd55'; break;
        }
      }

      ctx.shadowColor = col;
      ctx.shadowBlur  = 8;
      ctx.fillStyle   = col;
      ctx.fillRect(p.x, sy, p.w, PLAT_H);
      ctx.shadowBlur  = 0;

      // Highlight strip on top
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(p.x + 2, sy, p.w - 4, 3);

      // Spring pad marker
      if (p.spring) {
        const sx = p.x + p.w / 2 - 5;
        ctx.fillStyle = '#ffff00';
        ctx.fillRect(sx, sy - 8, 10, 8);
        ctx.fillStyle = '#ffee44';
        ctx.fillRect(sx + 2, sy - 10, 6, 3);
      }
    }

    // ── Particles ─────────────────────────────────────────────────
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle   = pt.color;
      const sy = pt.y + oy;
      ctx.fillRect(pt.x - pt.sz / 2, sy - pt.sz / 2, pt.sz, pt.sz);
    }
    ctx.globalAlpha = 1;

    // ── Player ────────────────────────────────────────────────────
    const px = Math.round(player.x);
    const py = Math.round(player.y + oy);
    drawPlayer(px, py, player.dir === 1);

    // ── HUD height indicator (small pillar on right edge) ─────────
    // Not required — HUD handles it.  Left blank intentionally.
  }

  // Draw a simple pixel-art style character
  function drawPlayer(px, py, right) {
    // Hat brim
    ctx.fillStyle = '#cc1111';
    ctx.fillRect(px + 1, py - 4, P_W - 2, 5);
    // Hat top
    ctx.fillStyle = '#dd2222';
    ctx.fillRect(px + 5, py - 9, P_W - 10, 6);

    // Head
    ctx.fillStyle = '#ffcc66';
    ctx.fillRect(px + 4, py, P_W - 8, 12);

    // Eye
    ctx.fillStyle = '#111';
    const eyeX = right ? px + P_W - 11 : px + 5;
    ctx.fillRect(eyeX, py + 3, 4, 4);
    // Eye highlight
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(eyeX + 2, py + 3, 2, 2);

    // Mouth
    ctx.fillStyle = '#993300';
    const mouthX = right ? px + P_W - 12 : px + 4;
    ctx.fillRect(mouthX, py + 8, 6, 2);

    // Body (jacket)
    ctx.fillStyle = '#33aa33';
    ctx.fillRect(px + 3, py + 12, P_W - 6, P_H - 14);

    // Legs
    ctx.fillStyle = '#1a441a';
    ctx.fillRect(px + 4,            py + P_H - 6, 8, 6);
    ctx.fillRect(px + P_W - 12,     py + P_H - 6, 8, 6);

    // Propeller arms (stretched to sides when airborne)
    const falling = player.vy > 0;
    ctx.fillStyle = '#33aa33';
    if (right) {
      ctx.fillRect(px,       py + 14, 4, falling ? 10 : 7);
      ctx.fillRect(px + P_W - 4, py + 14, 4, falling ? 10 : 7);
    } else {
      ctx.fillRect(px,       py + 14, 4, falling ? 10 : 7);
      ctx.fillRect(px + P_W - 4, py + 14, 4, falling ? 10 : 7);
    }
  }

  // ── Game loop ────────────────────────────────────────────────────
  function loop() {
    update();
    draw();
    if (state === 'playing') raf = requestAnimationFrame(loop);
  }

  // ── Start/restart ────────────────────────────────────────────────
  function startGame() {
    UI.hideOverlay('overlay-start');
    UI.hideOverlay('overlay-over');
    state = 'playing';
    newGame();
    TowerLife.onGameReady('jumper');
    raf = requestAnimationFrame(loop);
  }

  // ── Input ────────────────────────────────────────────────────────
  function resolveInput() {
    let l = false, r = false;
    for (const side of Object.values(ptrs)) {
      if (side === 'left')  l = true;
      if (side === 'right') r = true;
    }
    inputX = (l && !r) ? -1 : (!l && r) ? 1 : 0;
  }

  function onPtrDown(e) {
    e.preventDefault();
    if (state !== 'playing') { startGame(); return; }
    const rect   = canvas.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / rect.width * W;
    ptrs[e.pointerId] = localX < W / 2 ? 'left' : 'right';
    resolveInput();
  }

  function onPtrUp(e) {
    delete ptrs[e.pointerId];
    resolveInput();
  }

  function bindInput() {
    canvas.addEventListener('pointerdown',   onPtrDown, { passive: false });
    canvas.addEventListener('pointerup',     onPtrUp);
    canvas.addEventListener('pointercancel', onPtrUp);

    document.addEventListener('keydown', e => {
      if (state !== 'playing') {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startGame(); }
        return;
      }
      if (e.key === 'ArrowLeft'  || e.key === 'a') inputX = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') inputX =  1;
    });

    document.addEventListener('keyup', e => {
      if ((e.key === 'ArrowLeft'  || e.key === 'a') && inputX === -1) inputX = 0;
      if ((e.key === 'ArrowRight' || e.key === 'd') && inputX ===  1) inputX = 0;
    });

    document.getElementById('btn-start')  .addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', startGame);
    document.getElementById('btn-mute')   .addEventListener('click', () => {
      Audio.toggleMute();
      document.getElementById('btn-mute').textContent = Audio.isMuted() ? '🔇' : '🔊';
    });
  }

  // ── Unity API ─────────────────────────────────────────────────────
  /**
   * Drive the player with a virtual joystick from Unity.
   * @param {number} x  -1 (full left) … 1 (full right).  0 = neutral.
   *
   * Example Unity call:
   *   webView.EvaluateJavaScript("jumper_setInput(" + joystickX + ")", null);
   */
  window.jumper_setInput = function (x) {
    joystickX = clamp(Number(x) || 0, -1, 1);
  };

  // ── Idle background (start/over screens) ─────────────────────────
  function idleLoop() {
    if (state === 'playing') return;    // game loop takes over
    ctx.fillStyle = '#00071a';
    ctx.fillRect(0, 0, W, H);
    const t = Date.now() / 1000;
    for (const s of stars) {
      ctx.globalAlpha = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(idleLoop);
  }

  // ── Boot ─────────────────────────────────────────────────────────
  function init() {
    canvas        = document.getElementById('game-canvas');
    ctx           = canvas.getContext('2d');
    canvas.width  = W;
    canvas.height = H;

    highScore = Save.load('jumper_high', 0);
    joystickX = 0;
    inputX    = 0;
    state     = 'idle';

    initStars();
    UI.setScore('high-score', highScore);
    UI.showOverlay('overlay-start');
    bindInput();
    idleLoop();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
