import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GRAVITY } from './config';
import { BootScene } from './scenes/BootScene';
import { LevelScene } from './scenes/LevelScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#10131c',
  roundPixels: true, // pixel-snapped rendering (see Art Direction in CLAUDE.md)
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GRAVITY },
      debug: false,
    },
  },
  scene: [BootScene, LevelScene],
});

// Handle for the browser console and automated smoke tests.
(window as unknown as { __tamerunner?: Phaser.Game }).__tamerunner = game;
