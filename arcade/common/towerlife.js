/**
 * towerlife.js — Unity ↔ WebView communication bridge
 *
 * In production this runs inside a UniWebView embedded in the Unity game.
 * In standalone browser mode (dev/testing) all calls are no-ops that log to console.
 *
 * Message protocol:
 *   Outbound (web → Unity): window.uniwebview channel messaging API
 *   Inbound  (Unity → web): Unity calls EvaluateJavaScript("window.__towerlife_onMessage(json)")
 *
 * Outbound message types (web → Unity):
 *   { type: 'GAME_READY',      gameId }
 *   { type: 'SCORE_UPDATE',    score }
 *   { type: 'GAME_OVER',       score, ...extra }
 *   { type: 'ACHIEVEMENT',     id }
 *
 * Inbound message types (Unity → web):
 *   { type: 'PAUSE' }
 *   { type: 'RESUME' }
 *   { type: 'MUTE',   muted: bool }
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
     * Register a handler for messages sent from Unity → web.
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

    // ── private ────────────────────────────────────────────────────
    _send(payload) {
      if (this.isUnity) {
        // UniWebView channel messaging: send(action, data)
        // Unity receives this via OnChannelMessageReceived with message.action == payload.type
        window.uniwebview.send(payload.type, JSON.stringify(payload));
      } else {
        console.log('[TowerLife Bridge →]', payload);
      }
    },
  };

  global.TowerLife = TowerLife;
})(window);
