/**
 * taprush.js — Tapper-clone "Tap Rush"
 *
 * 4 horizontal bar lanes. Customers walk left toward the bartender.
 * Tap a lane to shoot a drink right — it serves the first customer it hits.
 * The empty glass slides back left; tap to catch it for bonus points.
 * Let a customer reach the bar end → lose a life. 3 lives. Game over on 0.
 * Difficulty ramps continuously: faster customers, shorter spawn intervals.
 *
 * Controls:
 *   Touch / Click   : tap anywhere in a bar row to serve that bar
 *   Keyboard        : keys 1–4 or A/S/D/F to serve lanes 0–3
 *   Unity bridge    : window.tapRush_tap(laneIndex)
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas ─────────────────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Palette ────────────────────────────────────────────────────────
  const C_BG         = '#04040e';
  const C_BAR_BG     = '#090920';
  const C_BAR_ALT    = '#060618';
  const C_BAR_SURF   = '#00ccff';
  const C_SERVE_ZONE = '#001828';
  const C_DRINK      = '#00ffff';
  const C_GLASS      = '#556677';
  const C_SCORE_HIT  = '#ffff55';
  const C_MISS       = '#ff3344';
  const C_CATCH      = '#aaffff';
  const C_LIVES      = '#ff3355';
  const C_LIVES_DEAD = '#222233';

  // Customer neon colours (one per lane)
  const CUST_COLORS = ['#ff6b35', '#dd44ff', '#35ff8a', '#ffd700'];

  // ── Layout ─────────────────────────────────────────────────────────
  //   4 lanes; each lane has a "floor" Y coordinate.
  const LANE_FLOORS  = [115, 210, 305, 400];  // bar surface Y
  const LANE_H       = 80;   // half-height band for tap detection (each dir)
  const BAR_LEFT_X   = 60;   // left edge of the bar surface
  const BAR_RIGHT_X  = W - 8;
  const SERVE_X      = BAR_LEFT_X + 4;  // x where drinks are launched / customers die
  const CATCH_THRESH = BAR_LEFT_X + 64; // glass must be left of this to be catchable

  // Customer geometry
  const CUST_W = 22;
  const CUST_BODY_H = 24;
  const CUST_HEAD_R = 9;
  const CUST_TOTAL_H = CUST_BODY_H + CUST_HEAD_R * 2 + 4; // feet to top of head

  // Drink / glass geometry
  const DRINK_W = 12;
  const DRINK_H = 15;

  // ── Difficulty constants ────────────────────────────────────────────
  const LIVES_MAX = 3;

  const CUST_SPEED_INIT = 38;   // px/s at game start
  const CUST_SPEED_MAX  = 130;  // px/s at full difficulty

  const DRINK_SPEED     = 420;  // px/s (constant, always feels responsive)

  const GLASS_SPEED_INIT = 160; // px/s at game start
  const GLASS_SPEED_MAX  = 290; // px/s at full difficulty

  const SPAWN_INTERVAL_INIT = 2.6;  // seconds between spawns at start
  const SPAWN_INTERVAL_MIN  = 0.85; // minimum spawn interval

  const RAMP_DURATION = 90;  // seconds until max difficulty

  // ── Scoring ────────────────────────────────────────────────────────
  const PTS_SERVE = 100;
  const PTS_CATCH = 30;
  const COMBO_BONUS = 15;    // extra pts per combo count above 1
  const COMBO_TIMEOUT = 3.5; // seconds before combo resets

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let score, highScore, lives;
  let playTime, spawnTimer, combo, comboTimer;
  let state; // 'idle' | 'playing' | 'over'
  let lastTime, raf;

  /*
   * Lane state:
   *   customers   : array of { x, color }
   *   drinkState  : 'none' | 'flying' | 'returning'
   *   drinkX      : x position of the drink/glass
   */
  let lanes;

  // Visual effects
  let floats;     // [{x, y, text, color, life, vy}]
  let particles;  // [{x, y, vx, vy, r, life, color}]

  // Flash state per lane (brief flash when life is lost)
  let laneFlash; // [{ timer }]   timer > 0 → red flash

  // ── Helpers ────────────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t; }

  function difficulty() {
    return Math.min(playTime / RAMP_DURATION, 1);
  }

  function custSpeed()    { return lerp(CUST_SPEED_INIT,    CUST_SPEED_MAX,    difficulty()); }
  function glassSpeed()   { return lerp(GLASS_SPEED_INIT,   GLASS_SPEED_MAX,   difficulty()); }
  function spawnInterval(){ return lerp(SPAWN_INTERVAL_INIT, SPAWN_INTERVAL_MIN, difficulty()); }

  // ── Initialisation ─────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');
    canvas.width  = W;
    canvas.height = H;

    highScore = Save.load('tapRush_high', 0);
    document.getElementById('high-score').textContent = highScore;

    setupInput();
    TowerLife.onGameReady('tapRush');
    showOverlay('overlay-start');
    // Draw idle frame so canvas isn't blank
    drawIdleFrame();
  }

  function resetGame() {
    score      = 0;
    lives      = LIVES_MAX;
    playTime   = 0;
    spawnTimer = 1.0;  // first customer after 1 second
    combo      = 0;
    comboTimer = 0;
    floats     = [];
    particles  = [];

    lanes = LANE_FLOORS.map(() => ({
      customers:  [],
      drinkState: 'none',
      drinkX:     0,
    }));

    laneFlash = LANE_FLOORS.map(() => ({ timer: 0 }));

    refreshHUD();
  }

  // ── Input ──────────────────────────────────────────────────────────
  function setupInput() {
    canvas.addEventListener('pointerdown', onPointer);

    document.addEventListener('keydown', (e) => {
      if (state !== 'playing') return;
      const map = {
        '1': 0, '2': 1, '3': 2, '4': 3,
        'a': 0, 's': 1, 'd': 2, 'f': 3,
      };
      const li = map[e.key.toLowerCase()];
      if (li !== undefined) tapLane(li);
    });
  }

  function onPointer(e) {
    if (state !== 'playing') return;
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const py = (e.clientY - rect.top) * (H / rect.height);

    // Find lane closest to tap (within LANE_H/2 of the floor)
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < LANE_FLOORS.length; i++) {
      const dist = Math.abs(py - LANE_FLOORS[i]);
      if (dist < LANE_H / 2 && dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0) tapLane(best);
  }

  /** Main serve / catch action for a lane. */
  function tapLane(li) {
    if (state !== 'playing') return;
    const lane = lanes[li];

    if (lane.drinkState === 'returning' && lane.drinkX <= CATCH_THRESH) {
      catchGlass(li);
    } else if (lane.drinkState === 'none') {
      launchDrink(li);
    }
    // If drink is flying or glass hasn't returned far enough yet → no-op
  }

  // ── Game logic ─────────────────────────────────────────────────────
  function launchDrink(li) {
    const lane = lanes[li];
    lane.drinkState = 'flying';
    lane.drinkX     = SERVE_X;
  }

  function catchGlass(li) {
    const lane   = lanes[li];
    lane.drinkState = 'none';

    const pts = PTS_CATCH;
    score += pts;

    const ly = LANE_FLOORS[li];
    addFloat(SERVE_X + 30, ly - 30, `+${pts} CATCH`, C_CATCH);
    spawnBurst(SERVE_X + 20, ly, C_CATCH, 5);
    refreshHUD();
  }

  function serveCustomer(li, ci, cx) {
    const lane = lanes[li];
    lane.customers.splice(ci, 1);

    combo++;
    comboTimer = COMBO_TIMEOUT;
    const pts = PTS_SERVE + (combo > 1 ? (combo - 1) * COMBO_BONUS : 0);
    score += pts;

    const ly   = LANE_FLOORS[li];
    const label = combo > 1 ? `+${pts} x${combo}` : `+${pts}`;
    addFloat(cx, ly - 35, label, C_SCORE_HIT);
    spawnBurst(cx, ly, C_SCORE_HIT, 10);

    // Launch empty glass back from where customer was
    lane.drinkState = 'returning';
    lane.drinkX     = cx - CUST_W / 2 - 4;

    TowerLife.sendScore(score);
    refreshHUD();
  }

  function loseLife(li) {
    lives--;
    laneFlash[li].timer = 0.45;

    // Cancel any drink in that lane (the crash clears the bar)
    lanes[li].drinkState = 'none';

    const ly = LANE_FLOORS[li];
    addFloat(SERVE_X + 25, ly - 35, 'MISS!', C_MISS);
    spawnBurst(SERVE_X + 30, ly, C_MISS, 14);

    // Reset combo
    combo = 0;

    refreshHUD();

    if (lives <= 0) {
      endGame();
    }
  }

  function spawnCustomer() {
    // Prefer lanes that don't already have a customer near the right edge
    const eligible = [];
    for (let i = 0; i < LANE_FLOORS.length; i++) {
      const tooClose = lanes[i].customers.some(c => c.x > BAR_RIGHT_X - 50);
      if (!tooClose) eligible.push(i);
    }
    if (eligible.length === 0) return;

    const li = eligible[Math.floor(Math.random() * eligible.length)];
    lanes[li].customers.push({
      x:     BAR_RIGHT_X + 12,
      color: CUST_COLORS[li],
    });
  }

  function update(dt) {
    playTime   += dt;
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;

    // Customer spawning
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnCustomer();
      // At higher difficulty occasionally spawn on two lanes at once
      if (difficulty() > 0.5 && Math.random() < 0.35) spawnCustomer();
      spawnTimer = spawnInterval() * (0.75 + Math.random() * 0.5);
    }

    const cs = custSpeed();
    const gs = glassSpeed();

    for (let li = 0; li < LANE_FLOORS.length; li++) {
      const lane = lanes[li];

      // Advance customers
      for (let ci = lane.customers.length - 1; ci >= 0; ci--) {
        const c = lane.customers[ci];
        c.x -= cs * dt;

        if (c.x < SERVE_X) {
          // Reached the bar! Remove and deduct a life.
          lane.customers.splice(ci, 1);
          loseLife(li);
          if (state !== 'playing') return; // game ended
        }
      }

      // Advance drink
      if (lane.drinkState === 'flying') {
        lane.drinkX += DRINK_SPEED * dt;

        // Collision: hit the leftmost (closest) customer in this lane
        for (let ci = 0; ci < lane.customers.length; ci++) {
          const c = lane.customers[ci];
          if (lane.drinkX + DRINK_W >= c.x - CUST_W / 2) {
            serveCustomer(li, ci, c.x);
            break;
          }
        }

        // Drink flew off-screen with no customer to hit
        if (lane.drinkState === 'flying' && lane.drinkX > BAR_RIGHT_X + 20) {
          lane.drinkState = 'none';
        }
      }

      // Advance returning glass
      if (lane.drinkState === 'returning') {
        lane.drinkX -= gs * dt;

        if (lane.drinkX < SERVE_X - 8) {
          // Glass missed — no life penalty, just an indicator
          lane.drinkState = 'none';
          addFloat(SERVE_X + 20, LANE_FLOORS[li] - 28, 'MISS GLASS', '#445566');
        }
      }

      // Tick lane flash
      if (laneFlash[li].timer > 0) laneFlash[li].timer -= dt;
    }

    // Advance floats
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.y    += f.vy * dt;
      f.life -= dt;
      if (f.life <= 0) floats.splice(i, 1);
    }

    // Advance particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x    += p.vx * dt;
      p.y    += p.vy * dt;
      p.vy   += 700 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ── Effects helpers ────────────────────────────────────────────────
  function addFloat(x, y, text, color) {
    floats.push({ x, y, text, color, life: 1.1, vy: -55 });
  }

  function spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n;
      const spd   = 70 + Math.random() * 90;
      particles.push({
        x, y,
        vx:    Math.cos(angle) * spd,
        vy:    Math.sin(angle) * spd - 50,
        r:     2 + Math.random() * 3,
        life:  0.5 + Math.random() * 0.3,
        color,
      });
    }
  }

  // ── HUD ────────────────────────────────────────────────────────────
  function refreshHUD() {
    document.getElementById('score').textContent      = score;
    document.getElementById('high-score').textContent = highScore;
  }

  // ── Draw ───────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#060614');
    bgGrad.addColorStop(1, C_BG);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Lanes
    for (let li = 0; li < LANE_FLOORS.length; li++) {
      drawLane(li);
    }

    // Floating score text
    ctx.textAlign = 'center';
    for (const f of floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.font        = 'bold 14px "Courier New", monospace';
      ctx.fillStyle   = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Lives display at bottom
    drawLives();
  }

  function drawLane(li) {
    const lane  = lanes[li];
    const ly    = LANE_FLOORS[li];
    const flash = laneFlash[li].timer > 0;

    // Lane background band
    const rowTop = ly - LANE_H / 2 + 4;
    const rowH   = LANE_H - 8;
    ctx.fillStyle = li % 2 === 0 ? C_BAR_BG : C_BAR_ALT;
    ctx.fillRect(BAR_LEFT_X, rowTop, BAR_RIGHT_X - BAR_LEFT_X, rowH);

    // Serve zone highlight (left block)
    ctx.fillStyle = flash
      ? `rgba(255,40,40,${0.35 + laneFlash[li].timer})` : C_SERVE_ZONE;
    ctx.fillRect(BAR_LEFT_X, rowTop, 56, rowH);

    // Serve zone border
    ctx.strokeStyle = flash ? '#ff3344' : 'rgba(0,204,255,0.25)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(BAR_LEFT_X + 1, rowTop + 1, 54, rowH - 2);
    ctx.setLineDash([]);

    // Bar surface — glowing neon line
    ctx.save();
    ctx.shadowColor = C_BAR_SURF;
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = C_BAR_SURF;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT_X, ly + 15);
    ctx.lineTo(BAR_RIGHT_X, ly + 15);
    ctx.stroke();
    ctx.restore();

    // Bartender silhouette on the very left
    drawBartender(BAR_LEFT_X - 4, ly);

    // Lane number hint (very subtle)
    ctx.fillStyle   = 'rgba(0,204,255,0.18)';
    ctx.font        = '11px "Courier New", monospace';
    ctx.textAlign   = 'center';
    ctx.fillText(`${li + 1}`, BAR_LEFT_X + 28, ly + 5);

    // Customers
    for (const c of lane.customers) {
      drawCustomer(c.x, ly, c.color);
    }

    // Drink in flight
    if (lane.drinkState === 'flying') {
      drawCup(lane.drinkX, ly, C_DRINK, /*glow*/ true);
    }

    // Empty glass returning
    if (lane.drinkState === 'returning') {
      drawCup(lane.drinkX, ly, C_GLASS, /*glow*/ false);
    }
  }

  function drawBartender(rightX, ly) {
    // Simple silhouette: torso + head + arm reaching to bar
    const x = rightX - 18;
    ctx.fillStyle = '#00aa88';

    // Head
    ctx.beginPath();
    ctx.arc(x, ly - 22, 8, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillRect(x - 7, ly - 14, 14, 20);

    // Hat (bartender visor)
    ctx.fillStyle = '#007766';
    ctx.fillRect(x - 9, ly - 30, 18, 4);
    ctx.fillRect(x - 5, ly - 34, 10, 5);

    // Arm on bar
    ctx.fillStyle = '#00aa88';
    ctx.fillRect(x + 4, ly + 2, 14, 5);
  }

  function drawCustomer(cx, ly, color) {
    const footY = ly + 12;

    // Legs
    ctx.fillStyle = darken(color);
    ctx.fillRect(cx - 8, footY - 14, 6, 14);
    ctx.fillRect(cx + 2,  footY - 14, 6, 14);

    // Body
    ctx.fillStyle = color;
    ctx.fillRect(cx - CUST_W / 2, footY - 14 - CUST_BODY_H, CUST_W, CUST_BODY_H);

    // Head
    ctx.beginPath();
    ctx.arc(cx, footY - 14 - CUST_BODY_H - CUST_HEAD_R, CUST_HEAD_R, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeY = footY - 14 - CUST_BODY_H - CUST_HEAD_R;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(cx - 3, eyeY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 3, eyeY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Mouth (open, wanting a drink)
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, eyeY + 4, 3, 0.1, Math.PI - 0.1);
    ctx.stroke();
  }

  function drawCup(x, ly, color, glow) {
    const top  = ly - 4;
    const bot  = ly + 12;
    const half = DRINK_W / 2;

    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 12;
    }
    ctx.fillStyle = color;

    // Trapezoid cup body
    ctx.beginPath();
    ctx.moveTo(x - half + 2, top);
    ctx.lineTo(x + half - 2, top);
    ctx.lineTo(x + half,     bot);
    ctx.lineTo(x - half,     bot);
    ctx.closePath();
    ctx.fill();

    // Liquid shimmer (lighter top third)
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(x - half + 2, top);
    ctx.lineTo(x + half - 2, top);
    ctx.lineTo(x + half - 1, top + 5);
    ctx.lineTo(x - half + 1, top + 5);
    ctx.closePath();
    ctx.fill();

    // Handle
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = glow ? 8 : 0;
    ctx.beginPath();
    ctx.arc(x + half + 4, ly + 4, 5, -Math.PI * 0.7, Math.PI * 0.7);
    ctx.stroke();

    ctx.restore();
  }

  function drawLives() {
    const totalW  = LIVES_MAX * 26;
    const startX  = (W - totalW) / 2 + 10;
    const y       = H - 22;

    for (let i = 0; i < LIVES_MAX; i++) {
      const x     = startX + i * 26;
      const alive = i < lives;
      ctx.fillStyle = alive ? C_LIVES : C_LIVES_DEAD;
      if (alive) {
        ctx.save();
        ctx.shadowColor = C_LIVES;
        ctx.shadowBlur  = 10;
      }
      drawHeart(x, y, 9);
      if (alive) ctx.restore();
    }
  }

  function drawHeart(cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.3);
    ctx.bezierCurveTo(cx,       cy - r * 0.3, cx - r, cy - r * 0.3, cx - r, cy + r * 0.15);
    ctx.bezierCurveTo(cx - r,   cy + r * 0.7, cx,     cy + r,       cx,     cy + r);
    ctx.bezierCurveTo(cx,       cy + r,       cx + r, cy + r * 0.7, cx + r, cy + r * 0.15);
    ctx.bezierCurveTo(cx + r,   cy - r * 0.3, cx,     cy - r * 0.3, cx,     cy + r * 0.3);
    ctx.fill();
  }

  /** Darken a hex colour string by ~30% for leg/shadow tones. */
  function darken(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, ((n >> 16) & 0xff) * 0.6) | 0;
    const g = Math.max(0, ((n >> 8)  & 0xff) * 0.6) | 0;
    const b = Math.max(0, ( n        & 0xff) * 0.6) | 0;
    return `rgb(${r},${g},${b})`;
  }

  function drawIdleFrame() {
    ctx.clearRect(0, 0, W, H);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#060614');
    bgGrad.addColorStop(1, C_BG);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Draw empty bar lanes for the start screen backdrop
    for (let li = 0; li < LANE_FLOORS.length; li++) {
      const ly = LANE_FLOORS[li];
      ctx.fillStyle = li % 2 === 0 ? C_BAR_BG : C_BAR_ALT;
      ctx.fillRect(BAR_LEFT_X, ly - 36, BAR_RIGHT_X - BAR_LEFT_X, 72);
      ctx.save();
      ctx.shadowColor = C_BAR_SURF;
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = C_BAR_SURF;
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(BAR_LEFT_X, ly + 15);
      ctx.lineTo(BAR_RIGHT_X, ly + 15);
      ctx.stroke();
      ctx.restore();
      drawBartender(BAR_LEFT_X - 4, ly);
    }
  }

  // ── Game loop ──────────────────────────────────────────────────────
  function loop(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.08);
    lastTime = ts;

    update(dt);
    draw();

    if (state === 'playing') {
      raf = requestAnimationFrame(loop);
    }
  }

  function startGame() {
    resetGame();
    hideOverlays();
    state    = 'playing';
    lastTime = performance.now();
    raf      = requestAnimationFrame(loop);
  }

  function endGame() {
    state = 'over';
    cancelAnimationFrame(raf);

    if (score > highScore) {
      highScore = score;
      Save.save('tapRush_high', highScore);
    }

    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    TowerLife.onGameOver(score);
    showOverlay('overlay-over');
  }

  // ── Overlay helpers ────────────────────────────────────────────────
  function showOverlay(id) {
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  }
  function hideOverlays() {
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
  }

  // ── Button wiring ──────────────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);

  document.getElementById('btn-mute').addEventListener('click', () => {
    const btn = document.getElementById('btn-mute');
    btn.textContent = btn.textContent === '🔊' ? '🔇' : '🔊';
  });

  // ── Unity bridge ───────────────────────────────────────────────────
  /** Called from Unity to serve a specific lane (0-based index). */
  window.tapRush_tap = function (laneIndex) {
    tapLane(laneIndex);
  };

  // ── Boot ───────────────────────────────────────────────────────────
  function boot() {
    state = 'idle';
    init();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
