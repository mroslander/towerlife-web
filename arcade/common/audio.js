/**
 * audio.js — Shared audio utilities.
 *
 * Uses the Web Audio API to synthesise simple sound effects at runtime —
 * no asset files required.  All sounds degrade gracefully if the browser
 * does not support AudioContext or if the user's gesture hasn't yet unlocked
 * the audio context.
 *
 * Usage:
 *   GameAudio.eat();   // food collected
 *   GameAudio.die();   // player died
 *   GameAudio.score(); // milestone / level up
 *   GameAudio.beep(options);  // custom tone
 */
(function (global) {
  'use strict';

  const GameAudio = {
    _ctx: null,
    _muted: false,

    // ── Public API ─────────────────────────────────────────────────

    setMuted(muted) {
      this._muted = !!muted;
    },

    isMuted() {
      return this._muted;
    },

    /**
     * Play a synthesised beep.
     * @param {object} [opts]
     * @param {number} [opts.frequency=440]  Hz
     * @param {number} [opts.duration=0.1]   Seconds
     * @param {OscillatorType} [opts.type='square']
     * @param {number} [opts.volume=0.3]     0–1
     */
    beep({ frequency = 440, duration = 0.1, type = 'square', volume = 0.3 } = {}) {
      if (this._muted) return;
      const ctx = this._context();
      if (!ctx) return;
      try {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      } catch (e) {
        // AudioContext may be blocked before a user gesture — fail silently.
      }
    },

    // ── Preset sounds ──────────────────────────────────────────────

    /** Short high-pitched blip — food collected. */
    eat() {
      this.beep({ frequency: 660, duration: 0.06, type: 'square',   volume: 0.22 });
    },

    /** Low descending noise — player died. */
    die() {
      this.beep({ frequency: 180, duration: 0.35, type: 'sawtooth', volume: 0.28 });
    },

    /** Bright accent — milestone or level up. */
    score() {
      this.beep({ frequency: 880, duration: 0.08, type: 'square',   volume: 0.18 });
      setTimeout(() => this.beep({ frequency: 1100, duration: 0.08, type: 'square', volume: 0.18 }), 90);
    },

    // ── Private ────────────────────────────────────────────────────

    _context() {
      try {
        if (!this._ctx) {
          this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this._ctx.state === 'suspended') {
          this._ctx.resume();
        }
        return this._ctx;
      } catch (e) {
        return null;
      }
    },
  };

  global.GameAudio = GameAudio;
})(window);
