/**
 * gravityflip.js — Gravity Guy-clone "Gravity Flip"
 *
 * Auto-runner. One tap flips gravity. Avoid ceiling and floor obstacles.
 * Speed ramps up continuously. One hit and it's over.
 *
 * Controls:
 *   Touch / Click  : tap anywhere on canvas
 *   Keyboard       : Space · ArrowUp · ArrowDown
 *   Unity bridge   : window.gravityflip_tap()
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Layout ─────────────────────────────────────────────────────────
  const CEILING_Y = 62;              // top of play area
  const FLOOR_Y   = 518;             // bottom of play area
  const PLAY_H    = FLOOR_Y - CEILING_Y;  // 456 px

  // Player
  const PLAYER_X  = 80;
  const PW        = 22;
  const PH        = 22;

  // Obstacle column width
  const OBS_W     = 44;

  // ── Palette ────────────────────────────────────────────────────────
  const C_BG        = '#06060f';
  const C_GRID      = '#0d0d26';
  const C_WALL      = '#09091c';
  const C_CEIL_GL   = '#bb33ff';   // ceiling / top-obstacle accent
  const C_FLOOR_GL  = '#ff5500';   // floor / bottom-obstacle accent
  const C_PLAYER    = '#00e5ff';
  const C_PDARK     = '#004a55';
  const C_OBS_TOP   = '#7722aa';
  const C_OBS_TOP2  = '#cc66ff';
  const C_OBS_BOT   = '#aa3300';
  const C_OBS_BOT2  = '#ff7733';

  // ── Physics ────────────────────────────────────────────────────────
  const GRAVITY = 1600;   // px/s²
  const MAX_VY  = 520;    // terminal velocity px/s

  // ── Speed progression ──────────────────────────────────────────────
  const SPEED_INIT = 160;   // px/s at game start
  const SPEED_MAX  = 420;   // px/s cap
  const SPEED_RAMP = 12;    // px/s gained per second

  // ── Obstacle spacing ───────────────────────────────────────────────
  const GAP_FAR  = 400;   // px between groups at low speed
  const GAP_NEAR = 180;   // px between groups at max speed

  // ── Gap size within play channel (fraction of PLAY_H) ─────────────
  // Shrinks as player scores more points.
  const GAP_FRAC_INIT = 0.48;   // 48 % of PLAY_H at score 0
  const GAP_FRAC_MIN  = 0.33;   // 33 % of PLAY_H at score SCORE_HARD+
  const SCORE_HARD    = 900;    // score at which gap reaches minimum

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let pY, pVY, gravDir;          // player: position, velocity, gravity direction (+1=down, -1=up)
  let speed, playTime, score, highScore, distance;
  let obstacles;                 // [{x, topH, botH}]
  let particles;                 // [{x,y,vx,vy,r,life,decay,color}]
  let trailPts;                  // [{x,y,alpha}]  ghost trail
  let bgScroll;
  let spawnCooldown;
  let flashAlpha;                // brief screen flash on flip
  let tapLock = false;           // guard against ghost clicks after overlay dismissal
  let state;                     // 'idle' | 'playing' | 'over'
  let lastTime, raf;

  // ── Utilities ──────────────────────────────────────────────────────
  const rand  = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function gapSeconds() {
    const t = clamp((speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT), 0, 1);
    return rand(0.88, 1.22) * (GAP_FAR + (GAP_NEAR - GAP_FAR) * t) / speed;
  }

  function currentGapFrac() {
    const t = clamp(score / SCORE_HARD, 0, 1);
    return GAP_FRAC_INIT + (GAP_FRAC_MIN - GAP_FRAC_INIT) * t;
  }

  // ── Obstacle spawning ──────────────────────────────────────────────
  function spawnObs(startX) {
    const gap  = PLAY_H * currentGapFrac();
    const room = PLAY_H - gap;

    let topH = 0, botH = 0;
    const r = Math.random();

    if (r < 0.55) {
      // Gate: both top & bottom create a narrow channel
      topH = clamp(rand(room * 0.15, room * 0.85), 14, room - 14);
      botH = room - topH;
    } else if (r < 0.78) {
      // Top obstacle only — player must stay below it
      topH = clamp(rand(PLAY_H * 0.14, PLAY_H * 0.42), 14, PLAY_H * 0.46);
    } else {
      // Bottom obstacle only — player must stay above it
      botH = clamp(rand(PLAY_H * 0.14, PLAY_H * 0.42), 14, PLAY_H * 0.46);
    }

    obstacles.push({ x: startX, topH, botH });
  }

  // ── Particles ──────────────────────────────────────────────────────
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(70, 260);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 90,
        r:     rand(2, 5.5),
        life:  1,
        decay: rand(0.025, 0.055),
        color,
      });
    }
  }

  function showOverlay(id, v) {
    document.getElementById(id)?.classList.toggle('hidden', !v);
  }

  // ── Canvas setup ───────────────────────────────────────────────────
  function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    function resize() {
      const hud  = document.getElementById('hud');
      const hudH = hud ? hud.offsetHeight + 4 : 44;
      const s    = Math.min(window.innerWidth / W, (window.innerHeight - hudH) / H);
      canvas.width  = W;
      canvas.height = H;
      canvas.style.width  = Math.round(W * s) + 'px';
      canvas.style.height = Math.round(H * s) + 'px';
    }
    resize();
    window.addEventListener('resize', resize);
  }

  // ── Game lifecycle ─────────────────────────────────────────────────
  function startGame() {
    if (!TowerLife.Credits.consume(startGame)) return;

    pY           = (CEILING_Y + FLOOR_Y) / 2;
    pVY          = 0;
    gravDir      = 1;       // gravity pulls down initially
    speed        = SPEED_INIT;
    playTime     = 0;
    score        = 0;
    distance     = 0;
    bgScroll     = 0;
    flashAlpha   = 0;
    obstacles    = [];
    particles    = [];
    trailPts     = [];
    // First obstacle appears after the player has settled in
    spawnCooldown = (W + 220) / SPEED_INIT;

    showOverlay('overlay-start', false);
    showOverlay('overlay-over',  false);
    document.getElementById('score').textContent = '0';

    state    = 'playing';
    lastTime = performance.now();
    TowerLife.onGameReady('gravityflip');

    // Lock taps briefly so a ghost click from the overlay button doesn't
    // immediately flip gravity right after the new game starts.
    tapLock = true;
    setTimeout(() => { tapLock = false; }, 300);

    if (!raf) raf = requestAnimationFrame(loop);
  }

  function gameOver() {
    if (state !== 'playing') return;
    state = 'over';
    GameAudio.die();
    burst(PLAYER_X, pY, C_PLAYER,  18);
    burst(PLAYER_X, pY, '#ffffff',   6);
    burst(PLAYER_X, pY, '#aa44ff',  10);

    if (score > highScore) {
      highScore = score;
      Save.save('gravityflip_best', highScore);
    }
    TowerLife.onGameOver(score);

    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    document.getElementById('high-score').textContent  = highScore;

    setTimeout(() => showOverlay('overlay-over', true), 850);
  }

  // ── Input ──────────────────────────────────────────────────────────
  function tap() {
    if (tapLock) return;
    if (state === 'idle' || state === 'over') { startGame(); return; }
    if (state !== 'playing') return;

    gravDir   *= -1;   // pure gravity flip — velocity carries over (momentum)
    flashAlpha = 0.28;
    GameAudio.eat();
  }

  /** Unity bridge — call from C# / EvaluateJavaScript */
  window.gravityflip_tap = tap;

  // ── Update ─────────────────────────────────────────────────────────
  function update(dt) {
    if (state !== 'playing') return;

    playTime += dt;
    speed = Math.min(SPEED_INIT + playTime * SPEED_RAMP, SPEED_MAX);
    const dx = speed * dt;
    distance += dx;
    bgScroll += dx;

    // Flash decay
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt * 3.5);

    // Player physics — gravity in current direction
    pVY += GRAVITY * gravDir * dt;
    pVY  = clamp(pVY, -MAX_VY, MAX_VY);
    pY  += pVY * dt;

    // Score
    const ns = Math.floor(distance / 10);
    if (ns !== score) {
      score = ns;
      document.getElementById('score').textContent = score;
      TowerLife.sendScore(score);
    }

    // Trail
    trailPts.push({ x: PLAYER_X - PW / 2, y: pY - PH / 2, alpha: 0.5 });
    for (const p of trailPts) { p.x -= dx; p.alpha -= 0.05; }
    trailPts = trailPts.filter(p => p.alpha > 0 && p.x + PW > -20);

    // Scroll & cull obstacles
    for (const o of obstacles) o.x -= dx;
    obstacles = obstacles.filter(o => o.x + OBS_W > -20);

    // Spawn
    spawnCooldown -= dt;
    if (spawnCooldown <= 0) {
      spawnObs(W + 20);
      spawnCooldown = gapSeconds();
    }

    // Collision — slightly shrunk hitbox for leniency
    const sh    = 3;
    const pTop  = pY - PH / 2 + sh;
    const pBot  = pY + PH / 2 - sh;
    const pLeft = PLAYER_X - PW / 2 + sh;
    const pRght = PLAYER_X + PW / 2 - sh;

    // Wall bounds
    if (pTop <= CEILING_Y || pBot >= FLOOR_Y) { gameOver(); return; }

    // Obstacles
    for (const o of obstacles) {
      if (pLeft >= o.x + OBS_W || pRght <= o.x) continue;
      if (o.topH > 0 && pTop < CEILING_Y + o.topH) { gameOver(); return; }
      if (o.botH > 0 && pBot > FLOOR_Y   - o.botH) { gameOver(); return; }
    }

    // Particles
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy  += 520 * dt;
      p.life -= p.decay;
    }
    particles = particles.filter(p => p.life > 0);
  }

  // ── Drawing ────────────────────────────────────────────────────────
  function draw() {
    // Background
    ctx.fillStyle = C_BG;
    ctx.fillRect(0, 0, W, H);

    // Scrolling grid — only in play channel
    const gs = 50;
    const ox = (W - bgScroll % gs + gs) % gs;
    ctx.strokeStyle = C_GRID;
    ctx.lineWidth   = 1;
    for (let x = ox - gs; x < W; x += gs) {
      ctx.beginPath(); ctx.moveTo(x, CEILING_Y); ctx.lineTo(x, FLOOR_Y); ctx.stroke();
    }
    for (let y = CEILING_Y + 50; y < FLOOR_Y; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Speed lines at higher speeds
    if (state === 'playing') {
      const sf = Math.max(0, (speed - SPEED_INIT) / (SPEED_MAX - SPEED_INIT) - 0.3) / 0.7;
      if (sf > 0) {
        ctx.strokeStyle = `rgba(0,200,255,${sf * 0.12})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 7; i++) {
          const ly  = rand(CEILING_Y + 10, FLOOR_Y - 10);
          const len = rand(20, 100);
          ctx.beginPath(); ctx.moveTo(rand(0, W - len), ly); ctx.lineTo(rand(0, W - len) + len, ly); ctx.stroke();
        }
      }
    }

    // Ceiling wall
    ctx.fillStyle = C_WALL;
    ctx.fillRect(0, 0, W, CEILING_Y);
    // Ceiling tile marks
    {
      const ts = 32, cx = (W - bgScroll % ts + ts) % ts;
      ctx.strokeStyle = '#141430'; ctx.lineWidth = 0.5;
      for (let x = cx - ts; x < W; x += ts) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CEILING_Y); ctx.stroke();
      }
    }
    // Ceiling glow edge
    ctx.save();
    ctx.shadowColor = C_CEIL_GL; ctx.shadowBlur = 14;
    ctx.strokeStyle = C_CEIL_GL; ctx.lineWidth  = 2;
    ctx.beginPath(); ctx.moveTo(0, CEILING_Y); ctx.lineTo(W, CEILING_Y); ctx.stroke();
    ctx.restore();

    // Floor wall
    ctx.fillStyle = C_WALL;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    // Floor tile marks
    {
      const ts = 32, fx = (W - bgScroll % ts + ts) % ts;
      ctx.strokeStyle = '#141430'; ctx.lineWidth = 0.5;
      for (let x = fx - ts; x < W; x += ts) {
        ctx.beginPath(); ctx.moveTo(x, FLOOR_Y); ctx.lineTo(x, H); ctx.stroke();
      }
    }
    // Floor glow edge
    ctx.save();
    ctx.shadowColor = C_FLOOR_GL; ctx.shadowBlur = 14;
    ctx.strokeStyle = C_FLOOR_GL; ctx.lineWidth  = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(W, FLOOR_Y); ctx.stroke();
    ctx.restore();

    // Ghost trail
    ctx.save();
    for (const p of trailPts) {
      ctx.globalAlpha = p.alpha * 0.55;
      ctx.fillStyle   = C_PLAYER;
      ctx.fillRect(p.x, p.y, PW, PH);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Obstacles
    for (const o of obstacles) {
      if (o.x > W + 10 || o.x + OBS_W < -10) continue;
      drawObs(o);
    }

    // Player
    if (state !== 'idle') drawPlayer();

    // Particles
    ctx.save();
    for (const p of particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Screen flash on flip — tinted toward the new gravity direction
    if (flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle   = gravDir < 0 ? C_CEIL_GL : C_FLOOR_GL;
      ctx.fillRect(0, CEILING_Y, W, PLAY_H);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Speed bar (bottom strip)
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
    ctx.save();

    // Glow colour reflects current gravity direction
    ctx.shadowColor = gravDir < 0 ? C_CEIL_GL : C_FLOOR_GL;
    ctx.shadowBlur  = 16;
    ctx.fillStyle   = C_PLAYER;
    ctx.fillRect(PLAYER_X - PW / 2, pY - PH / 2, PW, PH);
    ctx.shadowBlur  = 0;

    // Inner dark panel
    const ip = 5;
    ctx.fillStyle = C_PDARK;
    ctx.fillRect(PLAYER_X - PW / 2 + ip, pY - PH / 2 + ip, PW - ip * 2, PH - ip * 2);

    // Gravity direction arrow
    ctx.fillStyle = C_PLAYER;
    const aw = 4, ah = 5;
    ctx.beginPath();
    if (gravDir > 0) {
      ctx.moveTo(PLAYER_X - aw, pY - ah * 0.5);
      ctx.lineTo(PLAYER_X + aw, pY - ah * 0.5);
      ctx.lineTo(PLAYER_X,      pY + ah * 0.5);
    } else {
      ctx.moveTo(PLAYER_X - aw, pY + ah * 0.5);
      ctx.lineTo(PLAYER_X + aw, pY + ah * 0.5);
      ctx.lineTo(PLAYER_X,      pY - ah * 0.5);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawObs(o) {
    ctx.save();

    if (o.topH > 0) {
      const x = o.x, y = CEILING_Y, w = OBS_W, h = o.topH;

      // Main body
      ctx.shadowColor = C_OBS_TOP; ctx.shadowBlur = 10;
      ctx.fillStyle   = C_OBS_TOP;
      ctx.fillRect(x, y, w, h);
      ctx.shadowBlur  = 0;

      // Outline
      ctx.strokeStyle = C_OBS_TOP2; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      // Bright danger edge (bottom face)
      ctx.fillStyle = C_OBS_TOP2;
      ctx.fillRect(x, y + h - 4, w, 4);

      // Hazard stripes on bottom strip — purely cosmetic, inside hitbox
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y + h - 14, w, 14); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 7;
      for (let s = x - 16; s < x + w + 16; s += 12) {
        ctx.beginPath(); ctx.moveTo(s, y + h - 14); ctx.lineTo(s + 14, y + h); ctx.stroke();
      }
      ctx.restore();
    }

    if (o.botH > 0) {
      const x = o.x, y = FLOOR_Y - o.botH, w = OBS_W, h = o.botH;

      ctx.shadowColor = C_OBS_BOT; ctx.shadowBlur = 10;
      ctx.fillStyle   = C_OBS_BOT;
      ctx.fillRect(x, y, w, h);
      ctx.shadowBlur  = 0;

      ctx.strokeStyle = C_OBS_BOT2; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      // Bright danger edge (top face)
      ctx.fillStyle = C_OBS_BOT2;
      ctx.fillRect(x, y, w, 4);

      // Hazard stripes on top strip
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, 14); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 7;
      for (let s = x - 16; s < x + w + 16; s += 12) {
        ctx.beginPath(); ctx.moveTo(s, y); ctx.lineTo(s + 14, y + 14); ctx.stroke();
      }
      ctx.restore();
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
    highScore = Save.load('gravityflip_best', 0);
    document.getElementById('high-score').textContent = highScore;

    initCanvas();

    // Pre-init state so idle draw() doesn't crash
    bgScroll   = 0;
    obstacles  = [];
    particles  = [];
    trailPts   = [];
    pY         = (CEILING_Y + FLOOR_Y) / 2;
    pVY        = 0;
    gravDir    = 1;
    flashAlpha = 0;

    // Controls
    canvas.addEventListener('click',      tap);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); tap(); }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault(); tap();
      }
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

    // Overlay buttons — touchstart + preventDefault suppresses the ghost
    // click that mobile browsers synthesise after a touch, which would
    // otherwise land on the canvas once the overlay is dismissed and
    // immediately flip gravity.
    function bindStartBtn(id) {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click',      e => { e.stopPropagation(); startGame(); });
      btn.addEventListener('touchstart', e => { e.stopPropagation(); e.preventDefault(); startGame(); }, { passive: false });
    }
    bindStartBtn('btn-start');
    bindStartBtn('btn-restart');

    state    = 'idle';
    lastTime = performance.now();
    draw();

    TowerLife.onMessage(msg => {
      if (msg.type === 'MUTE') GameAudio.setMuted(msg.muted);
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
