# Project: TowerLife Minigames Web

## Purpose
A static website hosting HTML5 arcade minigames for the Unity game **Tower Life**. In Tower Life, players explore arcade floors with arcade machines; interacting with a machine opens a WebView that loads one of these games. The site is hosted on GitHub Pages.

## Goals
- Implement individual arcade games (Snake, Breakout, Tetris, Pac-Man, etc.) as self-contained HTML5 games.
- Provide shared common libraries for communication with the Unity host, UI, audio, save state, and achievements.
- Keep each game isolated in its own folder while sharing common infrastructure.
- Support bi-directional communication between the web games and the Unity WebView.

## Tech Stack
- Vanilla HTML5 / JavaScript (no build step required, static site)
- Phaser (game framework, used per-game as needed)
- GitHub Pages for hosting

## Project Structure
```
arcade/
│
├── index.html          # Game launcher / arcade menu
├── arcade.js           # Entry point logic
│
├── css/
├── images/
├── sounds/
├── fonts/
│
├── common/             # Shared libraries used by all games
│     towerlife.js      # Unity <-> WebView communication bridge
│     ui.js             # Shared UI components
│     audio.js          # Shared audio utilities
│     save.js           # Save/load state helpers
│     achievements.js   # Achievement system
│
├── snake/
│     snake.js
├── breakout/
│     breakout.js
├── tetris/
│     tetris.js
└── pacman/
      pacman.js
```

## Conventions
- Each game lives in its own subfolder and is fully self-contained except for imports from `common/`.
- Common libraries are plain ES modules or scripts; avoid heavy dependencies in shared code.
- `towerlife.js` is the single point of contact with the Unity host (postMessage / WebView bridge).
