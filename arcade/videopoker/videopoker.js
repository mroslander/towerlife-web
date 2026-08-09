/**
 * videopoker.js — Jacks or Better Video Poker
 *
 * Casino game: 5-card draw poker against the house.
 * One TowerLife credit buys a session of STARTING_CHIPS chips.
 * Each hand costs BET chips; wins pay BET × multiplier.
 * Session ends when chips drop below BET.
 *
 * Hand rankings (Jacks or Better pay table):
 *   Royal Flush      800×   Flush           6×
 *   Straight Flush    50×   Straight        4×
 *   Four of a Kind    25×   Three of a Kind 3×
 *   Full House         9×   Two Pair        2×
 *                           Jacks or Better 1×
 *
 * Depends on (loaded via <script> in index.html):
 *   save.js, towerlife.js, audio.js, achievements.js, ui.js
 */
(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────
  const STARTING_CHIPS = 20;   // chips granted at session start
  const BET            = 1;    // fixed bet per hand
  const DEAL_DELAY_MS  = 90;   // ms between each card being dealt / drawn

  // ── Card data ──────────────────────────────────────────────────
  const RANKS    = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const SUITS    = ['♠','♥','♦','♣'];
  const RED_SUITS = new Set(['♥','♦']);

  // ── Pay table ──────────────────────────────────────────────────
  // Ordered from best to worst; evaluateHand() returns the first match.
  const HANDS = [
    { id: 'royal',  name: 'Royal Flush',      mult: 800, elId: 'pr-royal' },
    { id: 'sf',     name: 'Straight Flush',   mult: 50,  elId: 'pr-sf'    },
    { id: 'foak',   name: 'Four of a Kind',   mult: 25,  elId: 'pr-4k'    },
    { id: 'fh',     name: 'Full House',       mult: 9,   elId: 'pr-fh'    },
    { id: 'flush',  name: 'Flush',            mult: 6,   elId: 'pr-fl'    },
    { id: 'str',    name: 'Straight',         mult: 4,   elId: 'pr-st'    },
    { id: 'toak',   name: 'Three of a Kind',  mult: 3,   elId: 'pr-3k'    },
    { id: 'tp',     name: 'Two Pair',         mult: 2,   elId: 'pr-2p'    },
    { id: 'jb',     name: 'Jacks or Better',  mult: 1,   elId: 'pr-jb'    },
    { id: 'none',   name: '',                 mult: 0,   elId: null        },
  ];

  // ── State ──────────────────────────────────────────────────────
  let deck  = [];
  let hand  = [];      // Array<{rank, suit}> — 5 cards
  let held  = [];      // Array<boolean>       — 5 hold flags
  let chips = STARTING_CHIPS;
  let best  = 0;
  let state = 'start'; // 'start' | 'idle' | 'holding' | 'result' | 'gameover'
  let muted = false;

  // DOM references
  let cardEls    = []; // 5 .card elements
  let holdLabels = []; // 5 .hold-label elements
  let btnDeal;

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    best = Save.load('vp_best', 0);
    UI.setScore('best-display', best);
    UI.setScore('chips-display', '--');

    buildCardSlots();

    btnDeal = document.getElementById('btn-deal');
    btnDeal.addEventListener('click', onDealClick);

    document.getElementById('btn-start').addEventListener('click', onStartClick);
    document.getElementById('btn-restart').addEventListener('click', onStartClick);
    document.getElementById('btn-mute').addEventListener('click', onMuteClick);

    TowerLife.onMessage(handleUnityMessage);
    TowerLife.onGameReady('videopoker');
    enterState('start');
  }

  // ── Build card DOM ─────────────────────────────────────────────
  function buildCardSlots() {
    const area = document.getElementById('cards-area');
    area.innerHTML = '';
    cardEls    = [];
    holdLabels = [];

    for (let i = 0; i < 5; i++) {
      const slot = document.createElement('div');
      slot.className = 'card-slot';

      const holdLabel = document.createElement('div');
      holdLabel.className = 'hold-label';
      holdLabel.textContent = 'HOLD';

      const card = document.createElement('div');
      card.className = 'card face-down';
      card.dataset.index = String(i);
      card.addEventListener('click', () => onCardClick(i));
      card.addEventListener('touchend', (e) => { e.preventDefault(); onCardClick(i); });

      slot.appendChild(holdLabel);
      slot.appendChild(card);
      area.appendChild(slot);

      cardEls.push(card);
      holdLabels.push(holdLabel);
    }
  }

  // ── Credit-guarded session start ───────────────────────────────
  function onStartClick() {
    if (!TowerLife.Credits.consume(onStartClick)) return;
    chips = STARTING_CHIPS;
    best  = Save.load('vp_best', 0);
    UI.setScore('chips-display', chips);
    UI.setScore('best-display', best);
    clearPayHighlight();
    setInfoBar('', '');
    enterState('idle');
  }

  // ── Deal / Draw button ─────────────────────────────────────────
  function onDealClick() {
    if (state === 'idle' || state === 'result') {
      dealHand();
    } else if (state === 'holding') {
      drawCards();
    }
  }

  // ── Card tap — toggle hold ──────────────────────────────────────
  function onCardClick(i) {
    if (state !== 'holding') return;
    held[i] = !held[i];
    refreshCardClass(i);
    holdLabels[i].classList.toggle('visible', held[i]);
  }

  // ── Deck helpers ───────────────────────────────────────────────
  function buildDeck() {
    const d = [];
    for (const suit of SUITS)
      for (const rank of RANKS)
        d.push({ rank, suit });
    return d;
  }

  function shuffle(d) {
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  // ── Deal initial 5 cards ───────────────────────────────────────
  function dealHand() {
    chips -= BET;
    UI.setScore('chips-display', chips);
    TowerLife.sendScore(chips);

    deck = shuffle(buildDeck());
    hand = deck.splice(0, 5);
    held = [false, false, false, false, false];

    clearPayHighlight();
    setInfoBar('', '');
    btnDeal.disabled    = true;
    btnDeal.textContent = 'DRAW';

    for (let i = 0; i < 5; i++) {
      holdLabels[i].classList.remove('visible');
      cardEls[i].className = 'card face-down'; // reset to back before animating in
    }

    let idx = 0;
    function dealNext() {
      if (idx >= 5) {
        state            = 'holding';
        btnDeal.disabled = false;
        return;
      }
      renderCardFaceUp(idx, hand[idx], false, true);
      idx++;
      setTimeout(dealNext, DEAL_DELAY_MS);
    }
    dealNext();
  }

  // ── Draw replacement cards ─────────────────────────────────────
  function drawCards() {
    btnDeal.disabled = true;

    let idx = 0;
    function drawNext() {
      // Advance past held cards
      while (idx < 5 && held[idx]) idx++;
      if (idx >= 5) { resolveHand(); return; }

      const newCard = deck.splice(0, 1)[0];
      hand[idx] = newCard;
      renderCardFaceUp(idx, newCard, false, true);
      idx++;
      setTimeout(drawNext, DEAL_DELAY_MS);
    }
    drawNext();
  }

  // ── Evaluate and pay ───────────────────────────────────────────
  function resolveHand() {
    const result    = evaluateHand(hand);
    const winAmount = BET * result.mult;

    clearPayHighlight();
    if (result.elId) {
      document.getElementById(result.elId).classList.add('highlight');
    }

    if (winAmount > 0) {
      chips += winAmount;
      setInfoBar(result.name, '+' + winAmount + ' CHIP' + (winAmount !== 1 ? 'S' : ''));
      GameAudio.score();
    } else {
      setInfoBar('NO WIN', '');
      GameAudio.die();
    }

    if (chips > best) {
      best = chips;
      Save.save('vp_best', best);
      UI.setScore('best-display', best);
      Achievements.unlock('vp_new_best', 'New Best!');
    }

    UI.setScore('chips-display', chips);
    TowerLife.sendScore(chips);
    checkAchievements(result);

    if (chips < BET) {
      // Session ends — wait a moment so player can see the result
      setTimeout(() => enterState('gameover'), 1800);
    } else {
      btnDeal.textContent = 'DEAL';
      btnDeal.disabled    = false;
      state = 'result';
    }
  }

  // ── State machine ──────────────────────────────────────────────
  function enterState(newState) {
    state = newState;

    const overlayStart = document.getElementById('overlay-start');
    const overlayOver  = document.getElementById('overlay-over');

    overlayStart.classList.toggle('hidden', newState !== 'start');
    overlayOver.classList.toggle('hidden', newState !== 'gameover');

    // Hide the deal button while an overlay is showing
    btnDeal.style.display =
      (newState === 'start' || newState === 'gameover') ? 'none' : '';

    if (newState === 'start' || newState === 'idle') {
      for (let i = 0; i < 5; i++) {
        cardEls[i].className = 'card face-down';
        holdLabels[i].classList.remove('visible');
      }
    }

    if (newState === 'idle') {
      clearPayHighlight();
      setInfoBar('', '');
      btnDeal.textContent = 'DEAL';
      btnDeal.disabled    = false;
    }

    if (newState === 'gameover') {
      UI.setScore('final-chips', chips);
      UI.setScore('final-best', best);
      TowerLife.onGameOver(chips, { best });
    }
  }

  // ── Card rendering ─────────────────────────────────────────────
  function renderCardFaceUp(i, card, isHeld, animate) {
    const el    = cardEls[i];
    const isRed = RED_SUITS.has(card.suit);

    el.className = 'card' +
      (isRed  ? ' red'   : ' black') +
      (isHeld ? ' held'  : '') +
      (animate ? ' dealing' : '');

    el.innerHTML =
      '<div class="corner corner-tl">' + card.rank + '<small>' + card.suit + '</small></div>' +
      '<div class="suit-center">'      + card.suit + '</div>' +
      '<div class="corner corner-br">' + card.rank + '<small>' + card.suit + '</small></div>';

    if (animate) {
      el.addEventListener('animationend', () => el.classList.remove('dealing'), { once: true });
    }
  }

  // Refresh only the CSS classes (held/unheld) without touching innerHTML
  function refreshCardClass(i) {
    const card  = hand[i];
    const isRed = RED_SUITS.has(card.suit);
    cardEls[i].className =
      'card' + (isRed ? ' red' : ' black') + (held[i] ? ' held' : '');
  }

  // ── Info bar helpers ───────────────────────────────────────────
  function setInfoBar(handName, winText) {
    document.getElementById('hand-name').textContent   = handName || '\u00a0';
    document.getElementById('win-display').textContent = winText  || '\u00a0';
  }

  function clearPayHighlight() {
    document.querySelectorAll('#pay-table .pay-row').forEach((r) =>
      r.classList.remove('highlight')
    );
  }

  // ── Hand evaluation (Jacks or Better) ──────────────────────────
  function evaluateHand(cards) {
    // Rank indices: 2→0, 3→1, … 10→8, J→9, Q→10, K→11, A→12
    const ri    = cards.map((c) => RANKS.indexOf(c.rank));
    const suits = cards.map((c) => c.suit);

    ri.sort((a, b) => a - b);

    // Count occurrences of each rank
    const counts = {};
    ri.forEach((r) => { counts[r] = (counts[r] || 0) + 1; });
    const cv = Object.values(counts).sort((a, b) => b - a); // e.g. [4,1] for quads

    const isFlush    = suits.every((s) => s === suits[0]);
    const isStraight = cv.length === 5 && ri[4] - ri[0] === 4;
    // Wheel: A-2-3-4-5 → indices [0,1,2,3,12]
    const isWheel    = ri[0] === 0 && ri[1] === 1 && ri[2] === 2 && ri[3] === 3 && ri[4] === 12;
    const anyStraight = isStraight || isWheel;
    // Royal: 10-J-Q-K-A same suit → sorted indices start at 8
    const isRoyal    = isFlush && isStraight && ri[0] === 8;

    if (isRoyal)                    return HANDS[0]; // Royal Flush
    if (isFlush && anyStraight)     return HANDS[1]; // Straight Flush
    if (cv[0] === 4)                return HANDS[2]; // Four of a Kind
    if (cv[0] === 3 && cv[1] === 2) return HANDS[3]; // Full House
    if (isFlush)                    return HANDS[4]; // Flush
    if (anyStraight)                return HANDS[5]; // Straight
    if (cv[0] === 3)                return HANDS[6]; // Three of a Kind
    if (cv[0] === 2 && cv[1] === 2) return HANDS[7]; // Two Pair

    // Jacks or Better: pair of J (idx 9), Q (10), K (11), or A (12)
    if (cv[0] === 2) {
      const pairRank = +Object.keys(counts).find((k) => counts[k] === 2);
      if (pairRank >= 9) return HANDS[8];
    }

    return HANDS[9]; // No win
  }

  // ── Achievements ───────────────────────────────────────────────
  function checkAchievements(result) {
    if (result.id === 'royal') Achievements.unlock('vp_royal_flush',    'Royal Flush!');
    if (result.id === 'sf')    Achievements.unlock('vp_straight_flush', 'Straight Flush!');
    if (result.id === 'foak')  Achievements.unlock('vp_four_of_a_kind', 'Four of a Kind!');
    if (chips >=  50)          Achievements.unlock('vp_chips_50',       '50 Chips!');
    if (chips >= 100)          Achievements.unlock('vp_chips_100',      '100 Chips!');
  }

  // ── Unity message handler ──────────────────────────────────────
  function handleUnityMessage(msg) {
    if (msg.type === 'MUTE') {
      muted = !!msg.muted;
      GameAudio.setMuted(muted);
      updateMuteBtn();
    }
  }

  // ── Mute ───────────────────────────────────────────────────────
  function onMuteClick() {
    muted = !muted;
    GameAudio.setMuted(muted);
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
  }

  // ── Boot ───────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
