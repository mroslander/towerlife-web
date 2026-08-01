/**
 * towerlife.js — Unity ↔ WebView communication bridge
 *
 * In production this runs inside a Vuplex WebView embedded in the Unity game.
 * In standalone browser mode (dev/testing) all calls are no-ops that log to console.
 *
 * Message protocol: JSON strings posted over window.vuplex (Vuplex WebView API).
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
    /** True when running inside the Vuplex WebView. */
    get isUnity() {
      return typeof window.vuplex !== 'undefined';
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
     * Register a handler for messages sent from Unity.
     * @param {function({ type: string, ...}): void} handler
     */
    onMessage(handler) {
      if (!this.isUnity) return;
      window.vuplex.addEventListener('message', (event) => {
        try {
          handler(JSON.parse(event.data));
        } catch (e) {
          console.warn('[TowerLife] Failed to parse inbound message:', event.data);
        }
      });
    },

    // ── private ────────────────────────────────────────────────────
    _send(payload) {
      if (this.isUnity) {
        window.vuplex.postMessage(JSON.stringify(payload));
      } else {
        console.log('[TowerLife Bridge →]', payload);
      }
    },
  };

  global.TowerLife = TowerLife;
})(window);
