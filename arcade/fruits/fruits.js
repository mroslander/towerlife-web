/**
 * fruits.js — Fruits Slots
 *
 * Casino game: 3-reel slot machine with 5 pay lines.
 * Win lines: top row, middle row, bottom row, diagonal TL→BR, diagonal BL→TR.
 * Double-or-nothing feature after every win (same rules as Video Poker).
 *
 * Session: one TowerLife credit → STARTING_CHIPS chips.
 * Each spin costs BET chips. Session ends when chips < BET.
 *
 * Pay lines (grid[row][reel], row 0=top, reel 0=left):
 *   TOP   : [0,0]─[0,1]─[0,2]
 *   MID   : [1,0]─[1,1]─[1,2]
 *   BOT   : [2,0]─[2,1]─[2,2]
 *   DIAG1 : [0,0]─[1,1]─[2,2]  (top-left → bottom-right)
 *   DIAG2 : [2,0]─[1,1]─[0,2]  (bottom-left → top-right)
 *
 * Double-or-nothing card rules (same as Video Poker):
 *   A–6 = LOW · 7 = COLLECT (push) · 8–K = HIGH
 *   Ace counts as 1 (LOW).
 *
 * Depends on (loaded via <script> in index.html):
 *   save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────
  const STARTING_CHIPS   = 20;
  const BET              = 1;
  const SPIN_TICK_MS     = 70;   // symbol-cycle interval during spin
  const REEL_STOP_MS     = [750, 1250, 1750]; // when each reel stops after spin start
  const RESULT_PAUSE_MS  = 1400; // pause before double-or-nothing overlay

  // ── Symbols ───────────────────────────────────────────────────
  // Ordered rarest→most-common (matches pay table display order).
  const SYMBOLS = [
    { id: 'bar',    emoji: 'BAR', name: 'BAR',    weight: 1,  pay: 100 },
    { id: 'seven',  emoji: '7',   name: 'SEVEN',  weight: 2,  pay: 50  },
    { id: 'star',   emoji: '⭐',  name: 'STAR',   weight: 3,  pay: 30  },
    { id: 'bell',   emoji: '🔔',  name: 'BELL',   weight: 4,  pay: 20  },
    { id: 'wmelon', emoji: '🍉',  name: 'MELON',  weight: 5,  pay: 15  },
    { id: 'grape',  emoji: '🍇',  name: 'GRAPE',  weight: 6,  pay: 12  },
    { id: 'orange', emoji: '🍊',  name: 'ORANGE', weight: 7,  pay: 10  },
    { id: 'lemon',  emoji: '🍋',  name: 'LEMON',  weight: 8,  pay:  8  },
    { id: 'cherry', emoji: '🍒',  name: 'CHERRY', weight: 10, pay:  5  },
  ];

  // Weighted pool — each symbol appears weight-many times.
  const POOL = [];
  for (const sym of SYMBOLS) {
    for (let i = 0; i < sym.weight; i++) POOL.push(sym);
  }

  // ── Win lines: [row, reel] triples ────────────────────────────
  const WIN_LINES = [
    { name: 'TOP',  cells: [[0,0],[0,1],[0,2]], type: 'h', dotIds: ['wl-l-top','wl-r-top'] },
    { name: 'MID',  cells: [[1,0],[1,1],[1,2]], type: 'h', dotIds: ['wl-l-mid','wl-r-mid'] },
    { name: 'BOT',  cells: [[2,0],[2,1],[2,2]], type: 'h', dotIds: ['wl-l-bot','wl-r-bot'] },
    { name: 'DIAG', cells: [[0,0],[1,1],[2,2]], type: 'd', dotIds: [] },
    { name: 'DIAG', cells: [[2,0],[1,1],[0,2]], type: 'd', dotIds: [] },
  ];

  // ── Card data (for double-or-nothing) ─────────────────────────
  // Same rank ordering as Video Poker for consistency.
  const RANKS    = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const SUITS    = ['♠','♥','♦','♣'];
  const RED_SUITS = new Set(['♥','♦']);

  // ── State ─────────────────────────────────────────────────────
  let chips       = STARTING_CHIPS;
  let best        = 0;
  let muted       = false;
  let state       = 'start'; // 'start'|'idle'|'spinning'|'result'|'doubling'|'gameover'
  let grid        = [];      // grid[row][reel] = symbol object
  let cellEls     = [];      // cellEls[row][reel] = DOM element
  let spinTimer   = null;    // setInterval id for the rapid cycling
  let stopTimers  = [];      // setTimeout ids for reel stops
  let doubleStake = 0;
  let doubleCard  = null;

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    best = Save.load('fruits_best', 0);
    UI.setScore('best-display', best);
    UI.setScore('chips-display', '--');

    buildReels();
    buildPayTable();

    document.getElementById('btn-spin').addEventListener('click', onSpinClick);
    document.getElementById('btn-start').addEventListener('click', onStartClick);
    document.getElementById('btn-restart').addEventListener('click', onStartClick);
    document.getElementById('btn-mute').addEventListener('click', onMuteClick);
    document.getElementById('btn-dbl-low').addEventListener('click', () => onDoubleGuess('low'));
    document.getElementById('btn-dbl-high').addEventListener('click', () => onDoubleGuess('high'));
    document.getElementById('btn-dbl-collect').addEventListener('click', onDoubleCollect);

    TowerLife.onMessage(handleUnityMessage);
    TowerLife.onGameReady('fruits');
    enterState('start');
  }

  // ── Build reel DOM ────────────────────────────────────────────
  function buildReels() {
    const area = document.getElementById('reel-area');
    area.innerHTML = '';
    cellEls = [[], [], []];

    for (let reel = 0; reel < 3; reel++) {
      const reelEl = document.createElement('div');
      reelEl.className = 'reel';
      reelEl.id = 'reel-' + reel;

      for (let row = 0; row < 3; row++) {
        const cell = document.createElement('div');
        cell.className = 'reel-cell';
        cell.id = 'cell-' + row + '-' + reel;
        reelEl.appendChild(cell);
        cellEls[row][reel] = cell;
      }

      area.appendChild(reelEl);
    }
  }

  // ── Build pay table (JS-generated for maintainability) ────────
  function buildPayTable() {
    const body = document.getElementById('pay-table-body');
    if (!body) return;
    body.innerHTML = '';
    for (const sym of SYMBOLS) {
      const row = document.createElement('div');
      row.className = 'pt-row';
      row.id = 'pt-' + sym.id;
      const symDisplay = sym.id === 'bar' || sym.id === 'seven'
        ? sym.emoji
        : sym.emoji;
      row.innerHTML =
        '<span class="pt-sym">' + symDisplay + '×3</span>' +
        '<span class="pt-pay">' + sym.pay + '</span>';
      body.appendChild(row);
    }
  }

  // ── Session start ─────────────────────────────────────────────
  function onStartClick() {
    if (!TowerLife.Credits.consume(onStartClick)) return;
    chips = STARTING_CHIPS;
    best  = Save.load('fruits_best', 0);
    UI.setScore('chips-display', chips);
    UI.setScore('best-display', best);
    enterState('idle');
  }

  // ── Spin ──────────────────────────────────────────────────────
  function onSpinClick() {
    if (state !== 'idle' && state !== 'result') return;
    spin();
  }

  function randSym() {
    return POOL[Math.floor(Math.random() * POOL.length)];
  }

  function spin() {
    chips -= BET;
    UI.setScore('chips-display', chips);
    TowerLife.sendScore(chips);

    clearWinVisuals();
    setWinText('', '');

    state = 'spinning';
    document.getElementById('btn-spin').disabled = true;

    // Which reels are still cycling
    const active = [true, true, true];

    // Initialize grid to random symbols
    grid = [[], [], []];
    for (let row = 0; row < 3; row++) {
      for (let reel = 0; reel < 3; reel++) {
        grid[row][reel] = randSym();
      }
    }

    // Rapid symbol cycling
    spinTimer = setInterval(() => {
      for (let reel = 0; reel < 3; reel++) {
        if (!active[reel]) continue;
        for (let row = 0; row < 3; row++) {
          const sym = randSym();
          setCell(row, reel, sym, 'spinning');
        }
      }
    }, SPIN_TICK_MS);

    // Stop each reel in sequence
    for (let reelIdx = 0; reelIdx < 3; reelIdx++) {
      const id = setTimeout(() => {
        active[reelIdx] = false;
        // Pick final result for this reel
        for (let row = 0; row < 3; row++) {
          const sym = randSym();
          grid[row][reelIdx] = sym;
          setCell(row, reelIdx, sym, 'stopped');
        }
        // Bounce animation
        const reelEl = document.getElementById('reel-' + reelIdx);
        reelEl.classList.add('bouncing');
        reelEl.addEventListener('animationend', () => reelEl.classList.remove('bouncing'), { once: true });
        GameAudio.eat();

        // After the last reel
        if (reelIdx === 2) {
          clearInterval(spinTimer);
          spinTimer = null;
          setTimeout(resolveSpins, 220);
        }
      }, REEL_STOP_MS[reelIdx]);
      stopTimers.push(id);
    }
  }

  // ── Evaluate wins ─────────────────────────────────────────────
  function resolveSpins() {
    let totalWin   = 0;
    const winLines = [];
    const winNames = [];

    for (const line of WIN_LINES) {
      const syms = line.cells.map(([row, reel]) => grid[row][reel]);
      if (syms[0].id === syms[1].id && syms[1].id === syms[2].id) {
        const linePay = syms[0].pay * BET;
        totalWin += linePay;
        winLines.push(line);
        winNames.push(syms[0].name);
        document.getElementById('pt-' + syms[0].id).classList.add('highlight');
      }
    }

    if (totalWin > 0) {
      // Highlight winning cells
      for (const line of winLines) {
        const winClass = line.type === 'h' ? 'win-h' : 'win-d';
        for (const [row, reel] of line.cells) {
          cellEls[row][reel].classList.add(winClass);
        }
        // Activate side dots for horizontal lines
        for (const dotId of line.dotIds) {
          const dot = document.getElementById(dotId);
          if (dot) dot.classList.add('active');
        }
      }

      // Deduplicate win names for display (e.g. two diagonal CHERRY wins → "CHERRY×3")
      const unique = [...new Set(winNames)];
      setWinText(unique.join(' + ') + '×3', '+' + totalWin + ' CHIP' + (totalWin !== 1 ? 'S' : ''));
      GameAudio.score();

      checkAchievements(winLines, totalWin);

      setTimeout(() => enterDoublingPhase(totalWin), RESULT_PAUSE_MS);
    } else {
      setWinText('NO WIN', '');
      GameAudio.die();

      if (chips < BET) {
        setTimeout(() => enterState('gameover'), 1600);
      } else {
        document.getElementById('btn-spin').disabled = false;
        state = 'result';
      }
    }
  }

  // ── Achievements ──────────────────────────────────────────────
  function checkAchievements(winLines, totalWin) {
    for (const line of winLines) {
      const sym = line.cells.map(([row, reel]) => grid[row][reel])[0];
      if (sym.id === 'bar')   Achievements.unlock('fruits_bar',   'BAR Jackpot!');
      if (sym.id === 'seven') Achievements.unlock('fruits_seven', 'Lucky Sevens!');
    }
    if (totalWin >= 50) Achievements.unlock('fruits_bigwin', 'Big Win!');
  }

  // ── State machine ─────────────────────────────────────────────
  function enterState(newState) {
    state = newState;

    const overlayStart  = document.getElementById('overlay-start');
    const overlayOver   = document.getElementById('overlay-over');
    const overlayDouble = document.getElementById('overlay-double');
    const btnSpin       = document.getElementById('btn-spin');

    overlayStart.classList.toggle('hidden', newState !== 'start');
    overlayOver.classList.toggle('hidden',  newState !== 'gameover');
    overlayDouble.classList.toggle('hidden', newState !== 'doubling');

    btnSpin.style.display =
      (newState === 'start' || newState === 'gameover' || newState === 'doubling') ? 'none' : '';

    if (newState === 'idle' || newState === 'start') {
      clearWinVisuals();
      setWinText('', '');
      // Reset cells to blank
      for (let row = 0; row < 3; row++) {
        for (let reel = 0; reel < 3; reel++) {
          const cell = cellEls[row][reel];
          if (!cell) continue;
          cell.className = 'reel-cell';
          cell.textContent = '';
          cell.removeAttribute('data-sym');
        }
      }
    }

    if (newState === 'idle') {
      btnSpin.textContent = 'SPIN';
      btnSpin.disabled    = false;
    }

    if (newState === 'gameover') {
      UI.setScore('final-chips', chips);
      UI.setScore('final-best', best);
      TowerLife.onGameOver(chips, { best });
    }
  }

  // ── Cell helpers ──────────────────────────────────────────────
  function setCell(row, reel, sym, stateClass) {
    const cell = cellEls[row][reel];
    cell.textContent = sym.emoji;
    cell.dataset.sym = sym.id;
    cell.className   = 'reel-cell ' + stateClass;
  }

  // ── Win visual helpers ────────────────────────────────────────
  function clearWinVisuals() {
    // Remove win classes from all cells
    for (let row = 0; row < 3; row++) {
      for (let reel = 0; reel < 3; reel++) {
        const cell = cellEls[row][reel];
        if (!cell) continue;
        cell.classList.remove('win-h', 'win-d');
      }
    }
    // Deactivate side dots
    document.querySelectorAll('.wl-dot').forEach(el => el.classList.remove('active'));
    // Clear pay table highlights
    document.querySelectorAll('.pt-row').forEach(el => el.classList.remove('highlight'));
  }

  function setWinText(label, chips) {
    document.getElementById('win-label').textContent = label || '\u00a0';
    document.getElementById('win-chips').textContent = chips || '\u00a0';
  }

  // ── Double-or-nothing ─────────────────────────────────────────
  function enterDoublingPhase(stake) {
    doubleStake = stake;

    const dblCardEl = document.getElementById('dbl-card');
    dblCardEl.className = 'card face-down';
    dblCardEl.innerHTML = '';

    document.getElementById('dbl-amount').textContent = doubleStake;
    const resultEl = document.getElementById('dbl-result');
    resultEl.textContent = '';
    resultEl.className   = '';

    document.getElementById('btn-dbl-low').disabled     = false;
    document.getElementById('btn-dbl-high').disabled    = false;
    document.getElementById('btn-dbl-collect').disabled = false;

    enterState('doubling');
  }

  function onDoubleCollect() {
    chips += doubleStake;
    doubleStake = 0;
    updateBest();
    UI.setScore('chips-display', chips);
    TowerLife.sendScore(chips);
    GameAudio.eat();
    if (chips < BET) {
      enterState('gameover');
    } else {
      enterState('idle');
    }
  }

  function onDoubleGuess(guess) {
    document.getElementById('btn-dbl-low').disabled     = true;
    document.getElementById('btn-dbl-high').disabled    = true;
    document.getElementById('btn-dbl-collect').disabled = true;

    // Draw a random card
    doubleCard = {
      rank: RANKS[Math.floor(Math.random() * RANKS.length)],
      suit: SUITS[Math.floor(Math.random() * SUITS.length)],
    };

    // Brief tension pause before the reveal
    setTimeout(() => revealDoubleCard(guess), 650);
  }

  function revealDoubleCard(guess) {
    const dblCardEl = document.getElementById('dbl-card');
    const resultEl  = document.getElementById('dbl-result');
    const rankIdx   = RANKS.indexOf(doubleCard.rank);
    const isRed     = RED_SUITS.has(doubleCard.suit);

    // Flip the card face-up
    dblCardEl.className = 'card ' + (isRed ? 'red' : 'black') + ' dealing';
    dblCardEl.innerHTML =
      '<div class="corner corner-tl">' + doubleCard.rank + '<small>' + doubleCard.suit + '</small></div>' +
      '<div class="suit-center">'      + doubleCard.suit + '</div>' +
      '<div class="corner corner-br">' + doubleCard.rank + '<small>' + doubleCard.suit + '</small></div>';
    dblCardEl.addEventListener('animationend', () => dblCardEl.classList.remove('dealing'), { once: true });

    // RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
    // A (index 12) counts as LOW (ace = 1 per spec).
    // LOW  = 2–6  (indices 0–4) and A (index 12)
    // SEVEN = 7   (index 5)   → neutral collect
    // HIGH = 8–K  (indices 6–11)
    const isSeven = rankIdx === 5;
    const isLow   = rankIdx <= 4 || rankIdx === 12;
    const isHigh  = rankIdx >= 6 && rankIdx <= 11;
    const won     = (guess === 'low' && isLow) || (guess === 'high' && isHigh);

    setTimeout(() => {
      if (isSeven) {
        // Friendly outcome: collect current stake, end doubling
        chips += doubleStake;
        updateBest();
        UI.setScore('chips-display', chips);
        TowerLife.sendScore(chips);
        resultEl.textContent = 'SEVEN \u2014 COLLECT!';
        resultEl.className   = 'push';
        doubleStake          = 0;
        GameAudio.eat();
        setTimeout(endDoublingRound, 1600);
      } else if (won) {
        doubleStake *= 2;
        resultEl.textContent = 'WIN! \xd72 \u2014 ' + doubleStake + ' CHIPS';
        resultEl.className   = 'win';
        GameAudio.score();
        // Re-enable for another doubling round
        setTimeout(() => {
          document.getElementById('dbl-amount').textContent = doubleStake;
          resultEl.textContent = '';
          resultEl.className   = '';
          dblCardEl.className  = 'card face-down';
          dblCardEl.innerHTML  = '';
          document.getElementById('btn-dbl-low').disabled     = false;
          document.getElementById('btn-dbl-high').disabled    = false;
          document.getElementById('btn-dbl-collect').disabled = false;
        }, 1500);
      } else {
        resultEl.textContent = 'BUST!';
        resultEl.className   = 'lose';
        doubleStake          = 0;
        GameAudio.die();
        setTimeout(endDoublingRound, 1600);
      }
    }, 350);
  }

  function endDoublingRound() {
    UI.setScore('chips-display', chips);
    TowerLife.sendScore(chips);
    if (chips < BET) {
      enterState('gameover');
    } else {
      enterState('idle');
    }
  }

  // ── Best score ────────────────────────────────────────────────
  function updateBest() {
    if (chips > best) {
      best = chips;
      Save.save('fruits_best', best);
      UI.setScore('best-display', best);
    }
  }

  // ── Unity message handler ─────────────────────────────────────
  function handleUnityMessage(msg) {
    if (msg.type === 'MUTE') {
      muted = !!msg.muted;
      GameAudio.setMuted(muted);
      updateMuteBtn();
    }
  }

  // ── Mute ──────────────────────────────────────────────────────
  function onMuteClick() {
    muted = !muted;
    GameAudio.setMuted(muted);
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
  }

  // ── Boot ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
