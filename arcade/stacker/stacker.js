/**
 * stacker.js — Ketchapp Stack-clone "Stacker"
 *
 * Controls:
 *   Touch/Click : tap anywhere to drop the current block
 *   Keyboard    : Space or Enter to drop
 *   Unity       : window.stacker_drop()
 *
 * Depends on: save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Canvas logical size ────────────────────────────────────────────
  const W = 360;
  const H = 580;

  // ── Tunable constants ──────────────────────────────────────────────
  const BLOCK_H           = 22;   // px, height of every block
  const STARTING_WIDTH    = 200;  // px, width of the foundation block
  const MIN_WIDTH         = 8;    // px, game over below this
  const PERFECT_THRESHOLD = 3;    // px, landing within this counts as perfect
  const BASE_SPEED        = 2.2;  // px/frame, initial slide speed
  const SPEED_INC         = 0.20; // px/frame added every SPEED_STEP blocks
  const SPEED_STEP        = 4;    // blocks placed between speed bumps
  const MAX_SPEED         = 10.0; // px/frame, cap
  const SLIDE_Y_FRAC      = 0.28; // fraction of H where the sliding block sits
  const STAR_COUNT        = 60;

  // Neon colour palette cycling per layer
  const PALETTE = [
    '#ff4466', '#ff7700', '#ffdd00', '#44ff88',
    '#00ccff', '#aa44ff', '#ff44cc', '#ff6633',
    '#11ffee', '#ff2255',
  ];

  // ── State ──────────────────────────────────────────────────────────
  let canvas, ctx;
  let stack;          // [{ x, width }] — layer 0 is the foundation
  let current;        // { x, width, dir, speed } — the sliding block
  let score;
  let highScore;
  let perfectStreak;  // consecutive perfect drops
  let perfectFlash;   // { timer, label } shown after a perfect drop
  let fallingChunks;  // cut-off pieces that fall off screen
  let stars;
  let state;          // 'idle' | 'playing' | 'over'
  let raf;

  // ── Utilities ──────────────────────────────────────────────────────
  const rand = (a, b) => a + Math.random() * (b - a);

  function colorForLayer(i) {
    return PALETTE[i % PALETTE.length];
  }

  function slideSpeed(layersPlaced) {
    return Math.min(BASE_SPEED + Math.floor(layersPlaced / SPEED_STEP) * SPEED_INC, MAX_SPEED);
  }

  // Screen Y of the top-left corner of a given stack layer index.
  // The sliding block (index = stack.length) always sits at SLIDE_Y_FRAC * H.
  // Each placed layer is one BLOCK_H below the previous one.
  function layerScreenY(layerIdx) {
    const slideY = Math.floor(H * SLIDE_Y_FRAC);
    const delta  = stack.length - layerIdx; // how far below the slide row
    return slideY + delta * BLOCK_H;
  }

  // ── Canvas setup ───────────────────────────────────────────────────
  function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx    = canvas.getContext('2d');

    function resize() {
      const wrapper = canvas.parentElement;
      const scale   = Math.min(wrapper.clientWidth / W, wrapper.clientHeight / H);
      canvas.width  = W;
      canvas.height = H;
      canvas.style.width  = Math.round(W * scale) + 'px';
      canvas.style.height = Math.round(H * scale) + 'px';
    }
    resize();
    window.addEventListener('resize', resize);
  }

  // ── Stars ──────────────────────────────────────────────────────────
  function initStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x:     rand(0, W),
        y:     rand(0, H),
        r:     rand(0.5, 1.8),
        alpha: rand(0.3, 1.0),
        phase: rand(0, Math.PI * 2),
        freq:  rand(0.02, 0.06),
      });
    }
  }

  // ── Game init ──────────────────────────────────────────────────────
  function initGame() {
    score         = 0;
    perfectStreak = 0;
    perfectFlash  = null;
    fallingChunks = [];

    // Foundation block
    const foundX = (W - STARTING_WIDTH) / 2;
    stack = [{ x: foundX, width: STARTING_WIDTH }];

    spawnSlider();

    UI.setScore('score', score);
    UI.setScore('high-score', highScore);
  }

  function spawnSlider() {
    const top = stack[stack.length - 1];
    current = {
      x:     -top.width,  // start off left edge
      width: top.width,
      dir:   1,
      speed: slideSpeed(stack.length - 1),
    };
  }

  // ── Drop ───────────────────────────────────────────────────────────
  function drop() {
    if (state !== 'playing') return;

    const top = stack[stack.length - 1];
    const cx  = current.x;
    const cw  = current.width;

    // Compute overlap with the block below
    const oLeft  = Math.max(cx, top.x);
    const oRight = Math.min(cx + cw, top.x + top.width);
    const overlap = oRight - oLeft;

    if (overlap <= 0) {
      // Completely missed
      endGame();
      return;
    }

    // Perfect-drop detection
    const lDiff = Math.abs(cx - top.x);
    const rDiff = Math.abs((cx + cw) - (top.x + top.width));
    const isPerfect = lDiff <= PERFECT_THRESHOLD && rDiff <= PERFECT_THRESHOLD;

    let newX, newWidth;

    if (isPerfect) {
      newX     = top.x;         // snap perfectly
      newWidth = top.width;     // no size reduction
      perfectStreak++;
      const label = perfectStreak >= 3
        ? 'PERFECT ×' + perfectStreak + '!'
        : 'PERFECT!';
      perfectFlash = { timer: 65, label };
      soundPerfect();
    } else {
      newX     = oLeft;
      newWidth = overlap;
      perfectStreak = 0;

      // Spawn a falling chunk for the cut-off piece
      const cutW = cw - overlap;
      const cutX = cx < top.x ? cx : (top.x + top.width);
      if (cutW > 0) {
        fallingChunks.push({
          x:     cutX,
          y:     layerScreenY(stack.length),
          width: cutW,
          color: colorForLayer(stack.length),
          vy:    1.5,
          life:  50,
        });
      }
      soundPlace();
    }

    if (newWidth < MIN_WIDTH) {
      endGame();
      return;
    }

    stack.push({ x: newX, width: newWidth });
    score = stack.length - 1;

    UI.setScore('score', score);
    TowerLife.sendScore(score);

    if (score > highScore) {
      highScore = score;
      Save.save('stacker_high', highScore);
      UI.setScore('high-score', highScore);
    }

    spawnSlider();
  }

  // ── Sound helpers ──────────────────────────────────────────────────
  function soundPlace() {
    GameAudio.beep({ frequency: 330, duration: 0.07, type: 'square', volume: 0.25 });
  }

  function soundPerfect() {
    GameAudio.beep({ frequency: 660, duration: 0.07, type: 'sine', volume: 0.35 });
    setTimeout(() => {
      GameAudio.beep({ frequency: 1100, duration: 0.09, type: 'sine', volume: 0.30 });
    }, 60);
  }

  // ── Game over ──────────────────────────────────────────────────────
  function endGame() {
    state = 'over';
    GameAudio.die();
    TowerLife.onGameOver(score, { highScore });

    document.getElementById('final-score').textContent = score;
    document.getElementById('final-high').textContent  = highScore;
    UI.showOverlay('overlay-over');
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  // ── Update ─────────────────────────────────────────────────────────
  function update() {
    if (state !== 'playing') return;

    // Slide current block
    current.x += current.dir * current.speed;
    if (current.x + current.width > W) {
      current.x = W - current.width;
      current.dir = -1;
    }
    if (current.x < 0) {
      current.x = 0;
      current.dir = 1;
    }

    // Perfect flash timer
    if (perfectFlash) {
      perfectFlash.timer--;
      if (perfectFlash.timer <= 0) perfectFlash = null;
    }

    // Falling chunks
    for (const c of fallingChunks) {
      c.y   += c.vy;
      c.vy  += 0.45;
      c.life--;
    }
    fallingChunks = fallingChunks.filter(c => c.life > 0 && c.y < H + 60);
  }

  // ── Draw ───────────────────────────────────────────────────────────
  function draw() {
    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 20; x < W; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 20; y < H; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Stars
    const t = Date.now() / 1000;
    for (const s of stars) {
      const a = s.alpha * (0.6 + 0.4 * Math.sin(t * s.freq * 6.28 + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fill();
    }

    // Placed stack layers (only visible ones)
    if (stack) {
      for (let i = 0; i < stack.length; i++) {
        const sy = layerScreenY(i);
        if (sy > H + BLOCK_H || sy + BLOCK_H < -20) continue;

        const layer = stack[i];
        const color = colorForLayer(i);

        drawBlock(layer.x, sy, layer.width, color);
      }
    }

    // Falling cut-off chunks
    if (fallingChunks) {
      for (const c of fallingChunks) {
        ctx.globalAlpha = Math.max(0, c.life / 50);
        drawBlock(c.x, c.y, c.width, c.color);
      }
    }
    ctx.globalAlpha = 1;

    // Sliding block
    if (state === 'playing') {
      const sy    = Math.floor(H * SLIDE_Y_FRAC);
      const color = colorForLayer(stack.length);

      drawBlock(current.x, sy, current.width, color, true);

      // Overlap preview ghost
      const top   = stack[stack.length - 1];
      const ox    = Math.max(current.x, top.x);
      const ow    = Math.min(current.x + current.width, top.x + top.width) - ox;
      if (ow > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.fillRect(ox, sy, ow, BLOCK_H);
      }
    }

    // PERFECT flash label
    if (perfectFlash) {
      const progress = perfectFlash.timer / 65;
      const alpha    = Math.min(1, progress * 3);
      const yOffset  = -30 * (1 - progress); // rises upward
      const baseY    = Math.floor(H * SLIDE_Y_FRAC) - 18 + yOffset;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font        = 'bold 26px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle   = '#ffee00';
      ctx.shadowColor = '#ffee00';
      ctx.shadowBlur  = 24;
      ctx.fillText(perfectFlash.label, W / 2, baseY);
      ctx.restore();
    }

    // Speed indicator (subtle, bottom-right)
    if (state === 'playing') {
      const spd = current.speed.toFixed(1);
      ctx.font        = '10px monospace';
      ctx.fillStyle   = 'rgba(255,255,255,0.18)';
      ctx.textAlign   = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('SPD ' + spd, W - 6, H - 4);
      ctx.textAlign   = 'left';
    }
  }

  function drawBlock(x, y, w, color, bright) {
    ctx.shadowColor = color;
    ctx.shadowBlur  = bright ? 22 : 10;
    ctx.fillStyle   = color;
    roundRect(ctx, x, y, w, BLOCK_H, 3);
    ctx.fill();

    // Top-edge highlight stripe
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,' + (bright ? '0.40' : '0.20') + ')';
    if (w > 8) {
      roundRect(ctx, x + 2, y + 2, w - 4, Math.min(5, BLOCK_H - 4), 2);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Game loop ──────────────────────────────────────────────────────
  function loop() {
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }

  // ── Controls ───────────────────────────────────────────────────────
  function setupControls() {
    // Tap / click anywhere on canvas
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (state === 'playing') drop();
    });

    // Keyboard: Space / Enter
    window.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (state === 'playing') drop();
      }
    });

    // Mute button
    const btnMute = document.getElementById('btn-mute');
    btnMute.addEventListener('click', () => {
      const muted = !GameAudio.isMuted();
      GameAudio.setMuted(muted);
      btnMute.textContent = muted ? '🔇' : '🔊';
    });
  }

  // ── Start / restart ────────────────────────────────────────────────
  function startGame() {
    UI.hideOverlay('overlay-start');
    UI.hideOverlay('overlay-over');
    state = 'playing';
    initGame();
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    raf = requestAnimationFrame(loop);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    highScore = Save.load('stacker_high', 0);
    UI.setScore('high-score', highScore);

    initCanvas();
    initStars();
    setupControls();

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', startGame);

    // Start on Enter/Space from overlays
    window.addEventListener('keydown', e => {
      if ((e.key === ' ' || e.key === 'Enter') && state !== 'playing') {
        e.preventDefault();
        startGame();
      }
    });

    // Draw idle start screen
    state = 'idle';
    (function idleLoop() {
      if (state !== 'idle') return;
      draw();
      requestAnimationFrame(idleLoop);
    })();

    TowerLife.onGameReady('stacker');
  });

  // ── Unity bridge ───────────────────────────────────────────────────
  /** Called from Unity to drop the current block. */
  window.stacker_drop = function () { drop(); };
})();
