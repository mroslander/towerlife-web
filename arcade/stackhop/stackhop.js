/**
 * stackhop.js — Stack Jump-clone "Stack Hop"
 *
 * Tap to jump to the next rotating platform. The platform's colored safe zone
 * must be at the "top" (marked by the white tick) when the ball lands.
 * Platforms rotate faster as your score increases.
 *
 * Controls:
 *   Touch / Click : tap anywhere
 *   Keyboard      : Space / Enter
 *   Unity bridge  : window.stackhop_tap()
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Tunable constants ──────────────────────────────────────────────

  // Platform geometry
  const PLAT_RX      = 108;   // ellipse x-radius (px)
  const PLAT_RY      = 19;    // ellipse y-radius (perspective squish)
  const PLAT_THICK   = 12;    // disc 3-D side height (px)
  const PLAT_GAP     = 92;    // vertical distance between platform centres (world px)
  const PLAT_HOLE_R  = 11;    // inner hole radius (pole)

  // Safe zone
  const SAFE_FRAC  = 0.30;              // 30 % of disc = safe ≈ 108°
  const SAFE_HALF  = Math.PI * SAFE_FRAC;
  // Landing check angle: top of ellipse (12 o'clock) = where ball falls down from
  const CHECK_ANGLE = -Math.PI / 2;

  // Grace: first N landings have a much larger safe zone to teach the mechanic
  const GRACE_JUMPS     = 3;
  const SAFE_FRAC_GRACE = 0.50;   // 50 % of disc = 180° — very forgiving
  const SAFE_HALF_GRACE = Math.PI * SAFE_FRAC_GRACE;

  // Rotation speed
  const ROT_BASE = 1.0;    // rad/s at score 0
  const ROT_INC  = 0.08;   // rad/s per score point
  const ROT_MAX  = 7.2;    // cap

  // Ball
  const BALL_R           = 12;
  const BALL_HOVER       = PLAT_RY + BALL_R + 6;   // screen-px above platform centre
  const BALL_SCREEN_FRAC = 0.68;                    // ball rests at this fraction down

  // Jump animation
  const JUMP_DUR = 0.28;    // seconds
  const JUMP_ARC = 48;      // extra upward arc height (px)

  // Platform pool
  const VISIBLE_ABOVE = 4;   // platforms pre-spawned above current
  const VISIBLE_BELOW = 3;   // platforms kept below (visual trail)

  // Misc
  const STAR_COUNT = 55;
  const PI2        = Math.PI * 2;

  // Colours
  const C_BG      = '#000814';
  const C_POLE    = '#101828';
  const C_DANGER  = '#0d1520';
  const C_SIDE    = '#07101a';
  const C_RING    = '#182438';
  const C_SAFE    = ['#00ccff', '#ff2255', '#ffdd00', '#44ff88', '#aa44ff', '#ff8800'];

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx, raf, lastTime;
  let state;            // 'idle' | 'playing' | 'dead'
  let score, highScore;

  // Platforms: index 0 = bottommost (highest worldY), higher index = higher up.
  // worldY uses standard canvas convention (Y increases downward), so higher
  // platforms have *smaller* worldY values.
  let platforms, currentIdx, platSeq;

  // Camera: screenY = worldY - cameraY
  let cameraY;

  // Jump
  let jumping, jumpT, jumpFromWY, jumpToWY;

  // Particles & stars
  let particles, stars;

  // ── Helpers ────────────────────────────────────────────────────────
  const rand = (a, b) => a + Math.random() * (b - a);

  function rotSpeed() {
    return Math.min(ROT_BASE + score * ROT_INC, ROT_MAX);
  }

  function normalizeAngle(a) {
    a = ((a % PI2) + PI2) % PI2;
    if (a > Math.PI) a -= PI2;
    return a;
  }

  // True when the CHECK_ANGLE falls inside this platform's safe arc.
  function isSafe(plat) {
    return Math.abs(normalizeAngle(CHECK_ANGLE - plat.rotation)) < plat.safeHalf;
  }

  // ── Platform management ────────────────────────────────────────────
  function makePlatform(worldY) {
    return {
      worldY,
      rotation: rand(0, PI2),
      rotDir: Math.random() < 0.5 ? 1 : -1,
      color: C_SAFE[platSeq++ % C_SAFE.length],
      safeHalf: SAFE_HALF,
    };
  }

  function ensurePlatforms() {
    while (currentIdx + VISIBLE_ABOVE >= platforms.length) {
      const topY = platforms[platforms.length - 1].worldY;
      platforms.push(makePlatform(topY - PLAT_GAP));
    }
    while (currentIdx > VISIBLE_BELOW + 1) {
      platforms.shift();
      currentIdx--;
    }
  }

  // ── Init ───────────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);

    highScore = Save.load('stackhop_hi', 0);
    document.getElementById('score').textContent = '0';
    document.getElementById('high-score').textContent = highScore;

    // Mute button
    const btnMute = document.getElementById('btn-mute');
    const savedMute = Save.load('stackhop_muted', false);
    GameAudio.setMuted(savedMute);
    btnMute.textContent = savedMute ? '🔇' : '🔊';
    btnMute.addEventListener('click', e => {
      e.stopPropagation();
      const m = !GameAudio.isMuted();
      GameAudio.setMuted(m);
      Save.save('stackhop_muted', m);
      btnMute.textContent = m ? '🔇' : '🔊';
    });

    // Input
    canvas.addEventListener('pointerdown', onTap);
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onTap(); }
    });
    document.getElementById('btn-start').addEventListener('click', onTap);
    document.getElementById('btn-restart').addEventListener('click', onTap);
    window.stackhop_tap = onTap;

    state = 'idle';

    stars = Array.from({ length: STAR_COUNT }, () => ({
      x: rand(0, W), y: rand(0, H), r: rand(0.5, 2), a: rand(0.15, 0.8),
    }));

    lastTime = performance.now();
    (function loop(ts) {
      const dt = Math.min((ts - lastTime) / 1000, 0.05);
      lastTime = ts;
      update(dt);
      draw();
      raf = requestAnimationFrame(loop);
    })(lastTime);
  }

  function resize() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.width  = W;
    canvas.height = H;
    canvas.style.width  = Math.round(W * scale) + 'px';
    canvas.style.height = Math.round(H * scale) + 'px';
  }

  // ── Game start / reset ─────────────────────────────────────────────
  function startGame() {
    score = 0;
    currentIdx = 0;
    platSeq = 0;
    jumping = false;
    jumpT = 0;
    particles = [];

    platforms = [];
    const total = VISIBLE_BELOW + 1 + VISIBLE_ABOVE;
    for (let i = 0; i < total; i++) {
      platforms.push(makePlatform(-i * PLAT_GAP));
    }
    // Grace: align starting platform; give first GRACE_JUMPS target platforms
    // a large safe zone and pre-align them so the tutorial feels fair.
    platforms[0].rotation = CHECK_ANGLE;
    for (let i = 1; i <= GRACE_JUMPS && i < platforms.length; i++) {
      platforms[i].rotation = CHECK_ANGLE;
      platforms[i].safeHalf = SAFE_HALF_GRACE;
    }

    // Camera so current platform is at BALL_SCREEN_FRAC down
    cameraY = platforms[0].worldY - H * BALL_SCREEN_FRAC;
    ensurePlatforms();

    document.getElementById('score').textContent = '0';
    document.getElementById('high-score').textContent = highScore;
    state = 'playing';
  }

  // ── Input ──────────────────────────────────────────────────────────
  function onTap() {
    if (state === 'idle') {
      document.getElementById('overlay-start').classList.add('hidden');
      startGame();
      return;
    }
    if (state === 'dead') {
      document.getElementById('overlay-over').classList.add('hidden');
      startGame();
      return;
    }
    if (state !== 'playing' || jumping) return;

    ensurePlatforms();
    const nextPlat = platforms[currentIdx + 1];
    if (!nextPlat) return;

    jumping    = true;
    jumpT      = 0;
    jumpFromWY = platforms[currentIdx].worldY;
    jumpToWY   = nextPlat.worldY;

    GameAudio.beep({ frequency: 440, duration: 0.07, type: 'square', volume: 0.22 });
  }

  // ── Update ─────────────────────────────────────────────────────────
  function update(dt) {
    if (state !== 'playing') return;

    // Rotate all platforms
    const rs = rotSpeed();
    for (const p of platforms) {
      p.rotation += p.rotDir * rs * dt;
    }

    // Jump animation
    if (jumping) {
      jumpT = Math.min(jumpT + dt / JUMP_DUR, 1);

      if (jumpT >= 1) {
        jumping = false;
        const landed = platforms[currentIdx + 1];

        if (isSafe(landed)) {
          // ── Landed on safe zone ──
          currentIdx++;
          score++;
          document.getElementById('score').textContent = score;
          if (score > highScore) {
            highScore = score;
            Save.save('stackhop_hi', highScore);
            document.getElementById('high-score').textContent = highScore;
            TowerLife.sendScore(highScore);
          }
          GameAudio.beep({ frequency: Math.min(500 + score * 14, 1200), duration: 0.10, type: 'square', volume: 0.28 });
          spawnSuccessParticles(landed);
          ensurePlatforms();
        } else {
          // ── Missed safe zone ──
          die(landed);
        }
      }
    }

    // Camera: follow ball (world Y)
    let ballWY;
    if (jumping) {
      const t = jumpT;
      ballWY = jumpFromWY + (jumpToWY - jumpFromWY) * t - Math.sin(t * Math.PI) * JUMP_ARC;
    } else {
      ballWY = platforms[currentIdx].worldY;
    }
    const targetCamY = ballWY - H * BALL_SCREEN_FRAC;
    cameraY += (targetCamY - cameraY) * Math.min(dt * 6, 1);

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 340 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function die(plat) {
    state = 'dead';
    GameAudio.die();

    const cx  = W / 2;
    const psy = plat.worldY - cameraY;
    const bcy = psy - BALL_HOVER;
    for (let i = 0; i < 24; i++) {
      const a = rand(0, PI2);
      const s = rand(80, 240);
      particles.push({ x: cx, y: bcy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(2, 5), life: rand(0.4, 0.9), color: plat.color });
    }

    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent = highScore;
    document.getElementById('overlay-over').classList.remove('hidden');
  }

  function spawnSuccessParticles(plat) {
    const cx  = W / 2;
    const psy = plat.worldY - cameraY;
    const bcy = psy - BALL_HOVER;
    for (let i = 0; i < 10; i++) {
      const a = rand(-Math.PI, 0);
      const s = rand(60, 150);
      particles.push({ x: cx, y: bcy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(1.5, 3.5), life: rand(0.2, 0.5), color: plat.color });
    }
  }

  // ── Draw ───────────────────────────────────────────────────────────
  function draw() {
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    // Stars
    ctx.save();
    for (const s of stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, PI2);
      ctx.fill();
    }
    ctx.restore();

    if (state === 'idle') return;

    // Ghost arc info: where the safe zone will be when the ball lands.
    // Always visible so the player knows exactly when to tap.
    let ghostPlat = null, ghostRot = 0;
    if (currentIdx + 1 < platforms.length) {
      const remTime = jumping ? JUMP_DUR * (1 - jumpT) : JUMP_DUR;
      ghostPlat = platforms[currentIdx + 1];
      ghostRot  = ghostPlat.rotation + ghostPlat.rotDir * rotSpeed() * remTime;
    }

    // Pole
    drawPole();

    // Platforms (bottom-to-top so higher ones overlay lower)
    for (let i = 0; i < platforms.length; i++) {
      const p    = platforms[i];
      const sy   = p.worldY - cameraY;
      if (sy < -80 || sy > H + 80) continue;

      const isCleared = i < currentIdx;
      const isCurrent = i === currentIdx;
      const isTarget  = i === currentIdx + 1;
      const gr        = isTarget ? ghostRot : null;

      drawPlatform(p, sy, isCleared, isCurrent, isTarget, gr);
    }

    // Ball
    drawBall();

    // Particles
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(p.life * 3, 1));
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, PI2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPole() {
    const cx    = W / 2;
    const poleW = 8;
    const topY  = platforms.length ? platforms[platforms.length - 1].worldY - cameraY - 60 : 0;
    const botY  = platforms.length ? platforms[0].worldY - cameraY + PLAT_THICK + 30 : H;

    ctx.fillStyle = C_POLE;
    ctx.fillRect(cx - poleW / 2, topY, poleW, botY - topY);

    // Subtle sheen on pole
    const g = ctx.createLinearGradient(cx - poleW / 2, 0, cx + poleW / 2, 0);
    g.addColorStop(0,   'rgba(0,0,0,0)');
    g.addColorStop(0.3, 'rgba(0,200,255,0.20)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - poleW / 2, topY, poleW, botY - topY);
  }

  /**
   * Draw a single platform disc.
   * @param {object} plat       Platform data
   * @param {number} cy         Screen Y of disc centre
   * @param {boolean} isCleared Ball has passed this platform (dim it)
   * @param {boolean} isCurrent Ball is resting on this platform
   * @param {boolean} isTarget  Ball is jumping toward this platform
   * @param {number|null} ghostRot Predicted rotation at landing (null = don't draw)
   */
  function drawPlatform(plat, cy, isCleared, isCurrent, isTarget, ghostRot) {
    const cx     = W / 2;
    const rx     = PLAT_RX;
    const scaleY = PLAT_RY / PLAT_RX;
    const ir     = PLAT_HOLE_R;
    const midR   = (rx + ir) / 2;
    const ringW  = rx - ir;

    ctx.globalAlpha = isCleared ? 0.30 : 1;

    // ── 3-D side (cylinder edge) ──────────────────────────────────────
    ctx.save();
    ctx.translate(cx, cy + PLAT_THICK);
    ctx.scale(1, scaleY);
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, PI2);
    ctx.fillStyle = C_SIDE;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = C_SIDE;
    ctx.fillRect(cx - rx, cy, rx * 2, PLAT_THICK);

    // ── Top face ──────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, scaleY);

    // Background disc
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, PI2);
    ctx.fillStyle = C_DANGER;
    ctx.fill();

    // Dark ring track (shows the safe-zone "rail")
    ctx.strokeStyle = C_RING;
    ctx.lineWidth   = ringW + 2;
    ctx.beginPath();
    ctx.arc(0, 0, midR, 0, PI2);
    ctx.stroke();

    // Ghost arc: where safe zone will be at landing (dashed white, semi-transparent)
    if (ghostRot !== null) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = ringW;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, midR, ghostRot - plat.safeHalf, ghostRot + plat.safeHalf);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Safe zone glow (active platforms only)
    if (isCurrent || isTarget) {
      ctx.save();
      ctx.shadowBlur  = 18;
      ctx.shadowColor = plat.color;
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = plat.color;
      ctx.lineWidth   = ringW + 8;
      ctx.beginPath();
      ctx.arc(0, 0, midR, plat.rotation - plat.safeHalf, plat.rotation + plat.safeHalf);
      ctx.stroke();
      ctx.restore();
    }

    // Safe zone arc (solid)
    ctx.strokeStyle = plat.color;
    ctx.lineWidth   = ringW;
    ctx.beginPath();
    ctx.arc(0, 0, midR, plat.rotation - plat.safeHalf, plat.rotation + plat.safeHalf);
    ctx.stroke();

    // Inner hole (pole)
    ctx.beginPath();
    ctx.arc(0, 0, ir, 0, PI2);
    ctx.fillStyle = C_BG;
    ctx.fill();

    // Outer outline
    ctx.strokeStyle = 'rgba(40,80,130,0.55)';
    ctx.lineWidth   = 1.5 / scaleY;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, PI2);
    ctx.stroke();

    ctx.restore();

    // ── Landing indicator (white tick at CHECK_ANGLE, target only) ────
    if (isTarget) {
      // CHECK_ANGLE = -π/2 = top of ellipse.
      // In screen space the top of the disc is at cy - PLAT_RY.
      const tickY  = cy - PLAT_RY - 5;
      const tickHW = 11;
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(cx - tickHW, tickY);
      ctx.lineTo(cx + tickHW, tickY);
      ctx.stroke();
      // Small downward pointing chevron
      ctx.beginPath();
      ctx.moveTo(cx - 5, tickY);
      ctx.lineTo(cx,     tickY + 5);
      ctx.lineTo(cx + 5, tickY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function drawBall() {
    const cx = W / 2;
    let by;

    if (jumping) {
      const t   = jumpT;
      const fsy = jumpFromWY - cameraY - BALL_HOVER;
      const tsy = jumpToWY   - cameraY - BALL_HOVER;
      by = fsy + (tsy - fsy) * t - Math.sin(t * Math.PI) * JUMP_ARC;
    } else {
      by = platforms[currentIdx].worldY - cameraY - BALL_HOVER;
    }

    // Shadow on current disc
    if (!jumping) {
      const psy = platforms[currentIdx].worldY - cameraY;
      ctx.save();
      ctx.translate(cx, psy);
      ctx.scale(1, PLAT_RY / PLAT_RX);
      ctx.beginPath();
      ctx.arc(0, 0, BALL_R + 5, 0, PI2);
      ctx.fillStyle = 'rgba(0,0,0,0.50)';
      ctx.fill();
      ctx.restore();
    }

    // Glow halo
    const glow = ctx.createRadialGradient(cx, by, 0, cx, by, BALL_R * 2.8);
    glow.addColorStop(0, 'rgba(255,255,255,0.22)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, by, BALL_R * 2.8, 0, PI2);
    ctx.fill();

    // Ball body (white sphere with sheen)
    const bg = ctx.createRadialGradient(
      cx - BALL_R * 0.32, by - BALL_R * 0.35, 0,
      cx,                  by,                  BALL_R
    );
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(1, '#aaccee');
    ctx.beginPath();
    ctx.arc(cx, by, BALL_R, 0, PI2);
    ctx.fillStyle = bg;
    ctx.fill();
  }

  // ── Boot ───────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', init);
})();
