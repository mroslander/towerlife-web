/**
 * save.js — Save / load helpers backed by localStorage.
 *
 * All keys are namespaced under 'towerlife_' to avoid collisions
 * with other page-level storage.
 */
(function (global) {
  'use strict';

  const Save = {
    /**
     * Persist an arbitrary value under the given key.
     * @param {string} key
     * @param {*} value  Must be JSON-serialisable.
     */
    save(key, value) {
      try {
        localStorage.setItem('towerlife_' + key, JSON.stringify(value));
      } catch (e) {
        console.warn('[Save] Could not persist key:', key, e);
      }
    },

    /**
     * Load a previously saved value.
     * @param {string} key
     * @param {*} [defaultValue=null]  Returned when the key does not exist.
     * @returns {*}
     */
    load(key, defaultValue = null) {
      try {
        const raw = localStorage.getItem('towerlife_' + key);
        return raw !== null ? JSON.parse(raw) : defaultValue;
      } catch (e) {
        console.warn('[Save] Could not load key:', key, e);
        return defaultValue;
      }
    },

    /**
     * Remove a saved value.
     * @param {string} key
     */
    remove(key) {
      localStorage.removeItem('towerlife_' + key);
    },
  };

  global.Save = Save;
})(window);
