/**
 * ui.js — Shared UI utilities.
 *
 * Provides:
 *  - Achievement toast notifications
 *  - Overlay show / hide helpers (keyed by element id)
 *  - Score display updater
 *
 * Depends on:  style.css (for .achievement-toast, .hidden classes)
 */
(function (global) {
  'use strict';

  const UI = {
    /**
     * Display a temporary achievement toast in the top-right corner.
     * @param {string} label
     */
    showAchievement(label) {
      const el = document.createElement('div');
      el.className = 'achievement-toast';
      el.textContent = '\u{1F3C6} ' + label;
      document.body.appendChild(el);
      // Trigger transition on next frame
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
      setTimeout(() => {
        el.classList.remove('show');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
      }, 2600);
    },

    /**
     * Make an overlay element visible.
     * @param {string} id  Element id
     */
    showOverlay(id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    },

    /**
     * Hide an overlay element.
     * @param {string} id  Element id
     */
    hideOverlay(id) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    },

    /**
     * Update a score / counter display element.
     * @param {string} id     Element id
     * @param {number|string} value
     */
    setScore(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    },
  };

  global.UI = UI;
})(window);
