/**
 * achievements.js — Client-side achievement tracking.
 *
 * Persists unlocked achievements via Save and notifies the Unity host via
 * TowerLife.  Each achievement can only be unlocked once per device.
 *
 * Depends on:  save.js, towerlife.js, ui.js
 *
 * Usage:
 *   Achievements.unlock('snake_score_100', 'Score 100!');
 *   Achievements.isUnlocked('snake_score_100'); // → true | false
 */
(function (global) {
  'use strict';

  const SAVE_KEY = 'achievements';

  const Achievements = {
    _data: null,

    /**
     * Unlock an achievement.  No-op if already unlocked.
     * @param {string} id     Stable unique identifier (never change after shipping).
     * @param {string} label  Human-readable display name shown in the toast.
     */
    unlock(id, label) {
      this._ensure();
      if (this._data[id]) return;          // already unlocked
      this._data[id] = Date.now();
      Save.save(SAVE_KEY, this._data);
      TowerLife.unlockAchievement(id);
      UI.showAchievement(label || id);
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    isUnlocked(id) {
      this._ensure();
      return !!this._data[id];
    },

    /** Wipe all achievements (dev / testing only). */
    reset() {
      this._data = {};
      Save.save(SAVE_KEY, this._data);
    },

    // ── Private ────────────────────────────────────────────────────
    _ensure() {
      if (!this._data) {
        this._data = Save.load(SAVE_KEY, {});
      }
    },
  };

  global.Achievements = Achievements;
})(window);
