/**
 * arcade.js — Game launcher entry point.
 *
 * Populates the game grid from the GAMES registry and wires
 * up any launcher-level logic.
 */
(function () {
  'use strict';

  /** Registry — add new games here as they are implemented. */
  const GAMES = [
    {
      id:          'snake',
      title:       'Snake',
      description: 'Classic snake. Eat, grow, don\'t crash.',
      path:        'snake/index.html',
      ready:       true,
    },
    {
      id:          'jewelrumble',
      title:       'Jewel Rumble',
      description: 'Swap gems, match 3+, beat the clock.',
      path:        'jewelrumble/index.html',
      ready:       true,
    },
    {
      id:          'marblemanic',
      title:       'Marble Manic',
      description: 'Shoot marbles, match 3+, buy more time.',
      path:        'marblemanic/index.html',
      ready:       true,
    },
    {
      id:          'breakout',
      title:       'Breakout',
      description: 'Break all the bricks.',
      path:        'breakout/index.html',
      ready:       false,
    },
    {
      id:          'tetris',
      title:       'Tetris',
      description: 'Clear lines, beat gravity.',
      path:        'tetris/index.html',
      ready:       false,
    },
    {
      id:          'pacman',
      title:       'Pac-Man',
      description: 'Eat dots, dodge ghosts.',
      path:        'pacman/index.html',
      ready:       false,
    },
  ];

  function buildGrid() {
    const grid = document.getElementById('game-grid');
    if (!grid) return;

    GAMES.forEach((game) => {
      const card = document.createElement('a');
      card.className = 'game-card' + (game.ready ? '' : ' coming-soon');
      if (game.ready) {
        card.href = game.path;
      } else {
        card.href        = '#';
        card.onclick     = (e) => e.preventDefault();
        card.tabIndex    = -1;
        card.setAttribute('aria-disabled', 'true');
      }

      card.innerHTML = `
        <div class="card-title">${game.title}</div>
        <div class="card-desc">${game.description}</div>
        ${!game.ready ? '<div class="card-badge">Coming soon</div>' : ''}
      `;

      grid.appendChild(card);
    });
  }

  window.addEventListener('DOMContentLoaded', buildGrid);
})();
