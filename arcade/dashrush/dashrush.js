/**
 * dashrush.js — Geometry Dash-clone "Dash Rush"
 *
 * Auto-runner. One tap to jump over obstacles. Speed ramps up continuously.
 * Obstacle patterns grow more complex over time.
 *
 * Controls:
 *   Touch / Click : tap anywhere on the canvas
 *   Keyboard      : Space or ArrowUp
 *   Unity bridge  : window.dashrush_tap()
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Palette ────────────────────────────────────────────────────────
  const C_PLAYER  = '#00e5ff';
  const C_PDARK   = '#006688';
  const C_SPIKE   = '#ff2255';
  const C_BLOCK   = '#ffdd00';
  const C_BDARK   = '#aa9900';
  const C_GLINE   = '#00aaff';
  const C_GROUND  = '#0c0c20';

  // ── Layout ─────────────────────────────────────────────────────────
  const GROUND_Y = 430;   // top surface of the ground (player stands here)
  const PLAYER_X = 78;    // fixed horizontal center of the player cube
  const PW       = 28;    // player width
  const PH       = 28;    // player height

  // Obstacle dimensions (in px)
  const SPIKE_W  = 36;
  const SPIKE_H  = 44;    // visual height of one spike
  const BLOCK_W  = 32;
  const BLOCK_H  = 32;    // one height unit for blocks

  // ── Physics ────────────────────────────────────────────────────────
  const GRAVITY  = 2200;  // px/s²  — downward acceleration
  const JUMP_VY  = -590;  // px/s   — upward impulse on tap
  const MAX_VY   = 1000;  // px/s   — terminal downward velocity

  // ── Speed progression ──────────────────────────────────────────────
  // Speed ramps from SPEED_INIT to SPEED_MAX over roughly 90 seconds.
  const SPEED_INIT = 220;  // px/s at game start
  const SPEED_MAX  = 520;  // px/s cap
  const SPEED_RAMP = 18;   // px/s added per second of play

  // ── Obstacle spawning ──────────────────────────────────────────────
  // gapPx is the pixel distance scrolled between the end of one group
  // and the start of the next, interpolated from far (slow) to near (fast).
  const GAP_FAR   = 340;  // px gap at SPEED_INIT
  const GAP_NEAR  = 155;  // px gap at SPEED_MAX

  // ── Obstacle templates ─────────────────────────────────────────────
  // Each template: array of pieces {type, dx, units?}
  //   dx    : offset (px) from the group's leftmost edge
  //   units : block height in BLOCK_H units (default 1, max 2)
  const SP = SPIKE_W + 3;  // spacing between adjacent spikes
  const BK = BLOCK_W + 8;  // spacing between block and next piece

  const TMPL_EASY = [
    [ {type:'spike', dx:0} ],
    [ {type:'block', dx:0, units:1} ],
    [ {type:'spike', dx:0}, {type:'spike', dx:SP} ],
  ];

  const TMPL_MED = [
    ...TMPL_EASY,
    [ {type:'block', dx:0, units:1}, {type:'spike', dx:BK} ],
    [ {type:'block', dx:0, units:2} ],
    [ {type:'spike', dx:0}, {type:'block', dx:BK, units:1} ],
  ];

  const TMPL_HARD = [
    ...TMPL_MED,
    [ {type:'spike', dx:0}, {type:'spike', dx:SP}, {type:'spike', dx:SP*2} ],
    [ {type:'block', dx:0, units:2}, {type:'spike', dx:BLOCK_W+8} ],
    [ {type:'spike', dx:0}, {type:'spike', dx:SP}, {type:'block', dx:SP*2+8, units:1} ],
    [ {type:'block', dx:0, units:1}, {type:'block', dx:BK, units:2} ],
  ];

  function getTemplates() {
    if (score >= 600) return TMPL_HARD;
    if (score >= 200) return TMPL_MED;
    return TMPL_EASY;
  }

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let pY, pVY, pRot, isOnGround;  // player
  let speed, playTime, score, highScore, distance;
  let obstacles;        // [{type, x, visW, visH, hitX, hitW, hitH}]
  let particles;        // [{x, y, vx, vy, r, life, decay, color}]
  let trailPts;         // [{x, y, alpha}]  — ghost trail behind player
  let bgScroll;         // scrolling offset for background grid
  let spawnCooldown;    // seconds until the next obstacle group spawns
  let state;            // 'idle' | 'playing' | 'over'
  let lastTime, raf;

  // ── Utilities ──────────────────────────────────────────────────────
  const rand = (a, b) => a + Math.random() * (b - a);

  function gapSeconds() {
    const t = Math.min((speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT), 1);
    const gapPx = GAP_FAR + (GAP_NEAR - GAP_FAR) * t;
    return (rand(0.85, 1.35) * gapPx) / speed;
  }

  // ── Spawning ───────────────────────────────────────────────────────
  function spawnGroup(startX) {
    const tmpl  = getTemplates();
    const group = tmpl[Math.floor(Math.random() * tmpl.length)];
    for (const piece of group) {
      const ox = startX + piece.dx;
      if (piece.type === 'spike') {
        obstacles.push({
          type: 'spike', x: ox,
          visW: SPIKE_W, visH: SPIKE_H,
          // Spike hitbox: narrower than visual (spike is a triangle)
          hitX: ox + SPIKE_W * 0.20,
          hitW: SPIKE_W * 0.60,
          hitH: SPIKE_H * 0.78,
        });
      } else {
        const units = piece.units || 1;
        const bh    = BLOCK_H * units;
        obstacles.push({
          type: 'block', x: ox,
          visW: BLOCK_W, visH: bh,
          hitX: ox, hitW: BLOCK_W, hitH: bh,
        });
      }
    }
  }

  // ── Particles ──────────────────────────────────────────────────────
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 260);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 100,
        r:     rand(2, 5.5),
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

  // ── Canvas setup ───────────────────────────────────────────────────
  function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    function resize() {
      const hud    = document.getElementById('hud');
      const hudH   = hud ? hud.offsetHeight + 4 : 44;
      const availW = window.innerWidth;
      const availH = window.innerHeight - hudH;
      const scale  = Math.min(availW / W, availH / H);
      canvas.width        = W;
      canvas.height       = H;
      canvas.style.width  = Math.round(W * scale) + 'px';
      canvas.style.height = Math.round(H * scale) + 'px';
    }
    resize();
    window.addEventListener('resize', resize);
  }

  // ── Game lifecycle ─────────────────────────────────────────────────
  function startGame() {
    if (!TowerLife.Credits.consume(startGame)) return;

    pY            = GROUND_Y;
    pVY           = 0;
    pRot          = 0;
    isOnGround    = true;
    speed         = SPEED_INIT;
    playTime      = 0;
    score         = 0;
    distance      = 0;
    bgScroll      = 0;
    obstacles     = [];
    particles     = [];
    trailPts      = [];
    // First obstacle appears after W + 220 px of travel
    spawnCooldown = (W + 220) / SPEED_INIT;

    showOverlay('overlay-start', false);
    showOverlay('overlay-over',  false);
    document.getElementById('score').textContent = '0';

    state    = 'playing';
    lastTime = performance.now();
    TowerLife.onGameReady('dashrush');

    if (!raf) raf = requestAnimationFrame(loop);
  }

  function gameOver() {
    if (state !== 'playing') return;
    state = 'over';
    GameAudio.die();
    burst(PLAYER_X, pY - PH / 2, C_PLAYER,  20);
    burst(PLAYER_X, pY - PH / 2, '#ffffff',   8);
    burst(PLAYER_X, pY - PH / 2, C_SPIKE,   10);

    if (score > highScore) {
      highScore = score;
      Save.save('dashrush_best', highScore);
    }
    TowerLife.onGameOver(score);

    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    document.getElementById('high-score').textContent  = highScore;

    setTimeout(() => showOverlay('overlay-over', true), 850);
  }

  // ── Input ──────────────────────────────────────────────────────────
  function tap() {
    if (state === 'idle' || state === 'over') { startGame(); return; }
    if (state !== 'playing') return;
    if (isOnGround) {
      pVY        = JUMP_VY;
      isOnGround = false;
      GameAudio.eat();
    }
  }

  /** Unity bridge — call from C# / EvaluateJavaScript */
  window.dashrush_tap = tap;

  // ── Update ─────────────────────────────────────────────────────────
  function update(dt) {
    if (state !== 'playing') return;

    playTime += dt;
    speed = Math.min(SPEED_INIT + playTime * SPEED_RAMP, SPEED_MAX);

    const dx = speed * dt;
    distance += dx;
    bgScroll += dx;

    // ── Player physics ────────────────────────────────────────────
    if (!isOnGround) {
      pVY = Math.min(pVY + GRAVITY * dt, MAX_VY);
      pY += pVY * dt;
      pRot += 4.8 * dt;  // spin while airborne (rad/s)
    }

    // Land on ground
    if (pY >= GROUND_Y) {
      pY         = GROUND_Y;
      pVY        = 0;
      isOnGround = true;
      // snap rotation to the nearest 90° so it looks clean on landing
      pRot = Math.round(pRot / (Math.PI / 2)) * (Math.PI / 2);
    }

    // ── Score ─────────────────────────────────────────────────────
    const newScore = Math.floor(distance / 10);
    if (newScore !== score) {
      score = newScore;
      document.getElementById('score').textContent = score;
      TowerLife.sendScore(score);
    }

    // ── Scroll obstacles ──────────────────────────────────────────
    for (const o of obstacles) {
      o.x    -= dx;
      o.hitX -= dx;
    }
    obstacles = obstacles.filter(o => o.x + o.visW > -20);

    // ── Trail ─────────────────────────────────────────────────────
    trailPts.push({ x: PLAYER_X - PW / 2, y: pY - PH, alpha: 0.55 });
    for (const p of trailPts) {
      p.x    -= dx;
      p.alpha -= 0.045;
    }
    trailPts = trailPts.filter(p => p.alpha > 0 && p.x + PW > -20);

    // ── Spawn ─────────────────────────────────────────────────────
    spawnCooldown -= dt;
    if (spawnCooldown <= 0) {
      spawnGroup(W + 30);
      spawnCooldown = gapSeconds();
    }

    // ── Collision ─────────────────────────────────────────────────
    // Player AABB shrunk by `shrink` pixels on all sides for leniency
    const shrink = 4;
    const plx = PLAYER_X - PW / 2 + shrink;
    const ply = pY - PH + shrink;
    const prx = PLAYER_X + PW / 2 - shrink;
    const pby = pY - shrink;

    for (const o of obstacles) {
      const olx = o.hitX;
      const oly = GROUND_Y - o.hitH;
      const orx = o.hitX + o.hitW;
      if (plx < orx && prx > olx && ply < GROUND_Y && pby > oly) {
        gameOver();
        return;
      }
    }

    // ── Particles ─────────────────────────────────────────────────
    for (const p of particles) {
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.vy   += 550 * dt;  // gravity on debris
      p.life -= p.decay;
    }
    particles = particles.filter(p => p.life > 0);
  }

  // ── Drawing ────────────────────────────────────────────────────────
  function draw() {
    // ── Sky gradient ──────────────────────────────────────────────
    const grd = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    grd.addColorStop(0, '#070712');
    grd.addColorStop(1, '#0e0e28');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // ── Background grid (scrolls with the world) ──────────────────
    const gs = 50;
    const ox = (W - bgScroll % gs + gs) % gs;
    ctx.strokeStyle = '#10102a';
    ctx.lineWidth   = 1;
    // Vertical lines
    for (let x = ox - gs; x < W; x += gs) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GROUND_Y); ctx.stroke();
    }
    // Horizontal lines
    for (let y = 50; y < GROUND_Y; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Speed lines effect (appears at higher speeds)
    if (state === 'playing') {
      const frac = Math.max(0, (speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT));
      if (frac > 0.25) {
        const alpha = (frac - 0.25) / 0.75 * 0.18;
        ctx.strokeStyle = `rgba(0, 200, 255, ${alpha})`;
        ctx.lineWidth   = 1;
        for (let y = 40; y < GROUND_Y; y += 60 + Math.random() * 60) {
          const len = rand(30, 120);
          const lx  = rand(0, W - len);
          ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + len, y); ctx.stroke();
        }
      }
    }

    // ── Ground area ───────────────────────────────────────────────
    ctx.fillStyle = C_GROUND;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    // Ground tile grid
    const ts  = 32;
    const gox = (W - bgScroll % ts + ts) % ts;
    ctx.strokeStyle = '#14143a';
    ctx.lineWidth   = 0.5;
    for (let x = gox - ts; x < W; x += ts) {
      ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = GROUND_Y + ts; y < H; y += ts) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Ground glow line
    ctx.save();
    ctx.shadowColor = C_GLINE;
    ctx.shadowBlur  = 12;
    ctx.strokeStyle = C_GLINE;
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();
    ctx.restore();

    // ── Ghost trail ───────────────────────────────────────────────
    ctx.save();
    for (const p of trailPts) {
      ctx.globalAlpha = p.alpha * 0.65;
      ctx.fillStyle   = C_PLAYER;
      ctx.fillRect(p.x, p.y, PW, PH);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ── Obstacles ─────────────────────────────────────────────────
    for (const o of obstacles) {
      if (o.x > W + 10 || o.x + o.visW < -10) continue;
      if (o.type === 'spike') drawSpike(o.x, o.visW, o.visH);
      else                    drawBlock(o.x, o.visW, o.visH);
    }

    // ── Player ────────────────────────────────────────────────────
    if (state !== 'idle') drawPlayer();

    // ── Particles ─────────────────────────────────────────────────
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ── Speed bar (bottom strip) ──────────────────────────────────
    if (state === 'playing') {
      const frac = (speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, H - 5, W, 5);
      ctx.fillStyle = C_PLAYER;
      ctx.fillRect(0, H - 5, W * frac, 5);
    }
  }

  // ── Draw helpers ───────────────────────────────────────────────────
  function drawPlayer() {
    const cx = PLAYER_X;
    const cy = pY - PH / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pRot);

    // Outer glow
    ctx.shadowColor = C_PLAYER;
    ctx.shadowBlur  = 16;

    // Main body
    ctx.fillStyle = C_PLAYER;
    ctx.fillRect(-PW / 2, -PH / 2, PW, PH);
    ctx.shadowBlur = 0;

    // Inner dark panel
    const ip = 6;
    ctx.fillStyle = C_PDARK;
    ctx.fillRect(-PW / 2 + ip, -PH / 2 + ip, PW - ip * 2, PH - ip * 2);

    // Cross / design
    ctx.fillStyle = C_PLAYER;
    ctx.fillRect(-1.5,         -PH / 2 + ip, 3,           PH - ip * 2);
    ctx.fillRect(-PW / 2 + ip, -1.5,          PW - ip * 2, 3);

    ctx.restore();
  }

  function drawSpike(x, w, h) {
    const cx = x + w / 2;
    ctx.save();
    ctx.shadowColor = C_SPIKE;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = C_SPIKE;
    ctx.beginPath();
    ctx.moveTo(cx,       GROUND_Y - h);  // tip
    ctx.lineTo(cx - w/2, GROUND_Y);      // bottom-left
    ctx.lineTo(cx + w/2, GROUND_Y);      // bottom-right
    ctx.closePath();
    ctx.fill();
    // Edge highlight
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = 'rgba(255, 100, 130, 0.5)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx,       GROUND_Y - h);
    ctx.lineTo(cx + w/2, GROUND_Y);
    ctx.stroke();
    ctx.restore();
  }

  function drawBlock(x, w, h) {
    const y = GROUND_Y - h;
    ctx.save();
    ctx.shadowColor = C_BLOCK;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = C_BLOCK;
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur  = 0;

    // Border
    ctx.strokeStyle = C_BDARK;
    ctx.lineWidth   = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // Top shine
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + 3, y + 3, w - 6, 7);

    // Horizontal dividers for multi-unit blocks
    if (h > BLOCK_H) {
      ctx.strokeStyle = C_BDARK;
      ctx.lineWidth   = 1;
      for (let dy = BLOCK_H; dy < h; dy += BLOCK_H) {
        ctx.beginPath();
        ctx.moveTo(x,     GROUND_Y - dy);
        ctx.lineTo(x + w, GROUND_Y - dy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ── Main loop ──────────────────────────────────────────────────────
  function loop(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────
  function init() {
    highScore = Save.load('dashrush_best', 0);
    document.getElementById('high-score').textContent = highScore;

    initCanvas();

    // Pre-init draw state so first static draw doesn't crash
    bgScroll  = 0;
    obstacles = [];
    particles = [];
    trailPts  = [];
    pY        = GROUND_Y;
    pRot      = 0;

    // Controls
    canvas.addEventListener('click',      tap);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); tap(); }, { passive: false });
    window.addEventListener('keydown',    e => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); tap(); }
    });

    // Mute button
    const btnMute = document.getElementById('btn-mute');
    if (btnMute) {
      btnMute.addEventListener('click', e => {
        e.stopPropagation();
        const m = !GameAudio.isMuted();
        GameAudio.setMuted(m);
        btnMute.textContent = m ? '🔇' : '🔊';
      });
    }

    // Overlay buttons
    document.getElementById('btn-start')?.addEventListener('click',   e => { e.stopPropagation(); startGame(); });
    document.getElementById('btn-restart')?.addEventListener('click', e => { e.stopPropagation(); startGame(); });

    state    = 'idle';
    lastTime = performance.now();
    draw();   // render static background behind the start overlay

    TowerLife.onMessage(msg => {
      if (msg.type === 'MUTE') GameAudio.setMuted(msg.muted);
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
