/**
 * towerlife.js — Unity <-> WebView communication bridge
 *
 * In production this runs inside a UniWebView embedded in the Unity game.
 * In standalone browser mode (dev/testing) all calls are no-ops that log to console.
 *
 * Message protocol:
 *   Outbound (web -> Unity): window.uniwebview Channel Messaging API (UniWebView v6+)
 *   Inbound  (Unity -> web): Unity calls EvaluateJavaScript on the webview instance
 *
 * Outbound message types (web -> Unity):
 *   { type: 'GAME_READY',    gameId }
 *   { type: 'SCORE_UPDATE',  score }
 *   { type: 'GAME_OVER',     score, ...extra }
 *   { type: 'ACHIEVEMENT',   id }
 *   { type: 'CREDIT_SPENT',  credits }  -- fired when a credit is consumed to start a game
 *   { type: 'REQUEST_TICKET' }          -- fired when player has no credits
 *
 * Inbound message types (Unity -> web):
 *   { type: 'PAUSE' }
 *   { type: 'RESUME' }
 *   { type: 'MUTE', muted: bool }
 *
 * Unity -> web: adding credits
 *   webView.EvaluateJavaScript("TowerLife.Credits.add(1)", null)
 *   -- or the global alias --
 *   webView.EvaluateJavaScript("__towerlife_addCredit(1)", null)
 *
 * Unity -> web: general messages
 *   webView.EvaluateJavaScript("window.__towerlife_onMessage('" + json + "')", null)
 */
(function (global) {
  'use strict';

  const TowerLife = {
    /** True when running inside UniWebView. */
    get isUnity() {
      return typeof window.uniwebview !== 'undefined';
    },

    /**
     * Call once when the game canvas is ready to receive input.
     * @param {string} gameId  e.g. 'snake'
     */
    onGameReady(gameId) {
      this._send({ type: 'GAME_READY', gameId });
    },

    /**
     * Report the live score (call on every point change).
     * @param {number} score
     */
    sendScore(score) {
      this._send({ type: 'SCORE_UPDATE', score });
    },

    /**
     * Call when the game session ends.
     * @param {number} score
     * @param {Object} [extra]  Any additional metadata to pass through.
     */
    onGameOver(score, extra = {}) {
      this._send({ type: 'GAME_OVER', score, ...extra });
    },

    /**
     * Unlock an achievement on the Unity side.
     * @param {string} id  Achievement identifier string.
     */
    unlockAchievement(id) {
      this._send({ type: 'ACHIEVEMENT', id });
    },

    /**
     * Register a handler for messages sent from Unity -> web.
     * Unity side must call:
     *   webView.EvaluateJavaScript("window.__towerlife_onMessage('" + json + "')", null);
     * @param {function({ type: string, ...}): void} handler
     */
    onMessage(handler) {
      if (!this.isUnity) return;
      window.__towerlife_onMessage = function (data) {
        try {
          handler(typeof data === 'string' ? JSON.parse(data) : data);
        } catch (e) {
          console.warn('[TowerLife] Failed to parse inbound message:', data);
        }
      };
    },

    // ── Credits / ticket system ────────────────────────────────────────
    /**
     * Credit management for the ticket-based play system.
     *
     * Unity adds credits by calling (via EvaluateJavaScript):
     *   TowerLife.Credits.add(1)
     *   -- or the global alias --
     *   __towerlife_addCredit(1)
     *
     * Games call Credits.consume(retryFn) before starting a session.
     * If no credits are available the INSERT TICKET screen is shown and
     * retryFn is stored; it will be called automatically once a credit arrives.
     */
    Credits: {
      _count: 0,
      _pending: null,    // callback to invoke once a credit is added
      _listeners: [],

      /** Current credit count. */
      get count() { return this._count; },

      /**
       * Add credits. Called by Unity via EvaluateJavaScript.
       * @param {number} [n=1]
       */
      add(n) {
        const amount = Math.max(1, parseInt(n, 10) || 1);
        this._count += amount;
        this._updateDisplay();
        this._notify();
        TowerLife._send({ type: 'CREDIT_ADDED', credits: this._count });

        if (this._pending) {
          const fn = this._pending;
          this._pending = null;
          this._hideScreen();
          fn();   // resume the queued start action
        }
      },

      /**
       * Try to consume one credit to start a game session.
       *
       * Returns true if a credit was available (and consumed).
       * Returns false if not; in that case the INSERT TICKET screen is shown
       * and pendingFn will be called automatically when a credit arrives.
       *
       * Usage in each game's start function:
       *   function startGame() {
       *     if (!TowerLife.Credits.consume(startGame)) return;
       *     // ... rest of start logic
       *   }
       *
       * @param {Function} [pendingFn]  Called automatically when credit arrives.
       * @returns {boolean}
       */
      consume(pendingFn) {
        if (this._count > 0) {
          this._count--;
          this._updateDisplay();
          this._notify();
          TowerLife._send({ type: 'CREDIT_SPENT', credits: this._count });
          return true;
        }
        // No credits — request one from Unity and wait
        this._pending = pendingFn || null;
        this._showScreen();
        TowerLife._send({ type: 'REQUEST_TICKET' });
        return false;
      },

      /**
       * Register a listener that fires whenever the credit count changes.
       * @param {function(count: number): void} fn
       */
      onChange(fn) {
        this._listeners.push(fn);
      },

      // ── private ───────────────────────────────────────────────

      _notify() {
        for (const fn of this._listeners) fn(this._count);
      },

      _getOrCreateScreen() {
        let el = document.getElementById('__tl_credit_screen');
        if (el) return el;

        el = document.createElement('div');
        el.id        = '__tl_credit_screen';
        el.className = 'tl-credit-screen';
        el.innerHTML =
          '<div class="tl-credit-box">' +
            '<div class="tl-credit-label">CREDITS</div>' +
            '<div class="tl-credit-count" id="__tl_credit_count">0</div>' +
            '<div class="tl-credit-title">INSERT TICKET</div>' +
            '<p class="tl-credit-hint">Use a ticket at the arcade machine to play</p>' +
            '<button class="tl-credit-dev-btn" id="__tl_credit_dev_btn">+ ADD CREDIT (DEV)</button>' +
          '</div>';
        document.body.appendChild(el);

        // Dev-only helper button — hidden inside Unity WebView
        const devBtn = el.querySelector('#__tl_credit_dev_btn');
        if (TowerLife.isUnity) {
          devBtn.style.display = 'none';
        } else {
          devBtn.addEventListener('click', function () { TowerLife.Credits.add(1); });
        }

        return el;
      },

      _showScreen() {
        const el = this._getOrCreateScreen();
        el.style.display = 'flex';
        this._updateDisplay();
      },

      _hideScreen() {
        const el = document.getElementById('__tl_credit_screen');
        if (el) el.style.display = 'none';
      },

      _updateDisplay() {
        const el = document.getElementById('__tl_credit_count');
        if (el) el.textContent = this._count;
      },
    },

    // ── private ────────────────────────────────────────────────────────
    _send(payload) {
      if (this.isUnity) {
        // UniWebView Channel Messaging (v6+):
        //   Unity receives via OnChannelMessageReceived; message.action == payload.type
        window.uniwebview.send(payload.type, JSON.stringify(payload));
      } else {
        console.log('[TowerLife ->]', payload);
      }
    },
  };

  // Global shorthand so Unity can call:
  //   webView.EvaluateJavaScript("__towerlife_addCredit(1)", null)
  global.__towerlife_addCredit = function (n) {
    TowerLife.Credits.add(n);
  };

  global.TowerLife = TowerLife;
})(window);
