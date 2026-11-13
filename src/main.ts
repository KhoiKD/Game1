import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GRAVITY, RENDER_SCALE } from './config';
import { BootScene } from './scenes/BootScene';
import { ClassSelectScene } from './scenes/ClassSelectScene';
import { HubScene } from './scenes/HubScene';
import { InventoryScene } from './scenes/InventoryScene';
import { LevelScene } from './scenes/LevelScene';
import { SpiritsScene } from './scenes/SpiritsScene';
import { TitleScene } from './scenes/TitleScene';
import { installAudio } from './audio/director';
import { sharpenText } from './ui/detailCamera';

sharpenText();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // Scenes lay out in GAME_WIDTH x GAME_HEIGHT; the canvas is larger so detailed art is sharp.
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: '#10131c',
  roundPixels: true,
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
  scene: [BootScene, TitleScene, ClassSelectScene, HubScene, LevelScene, InventoryScene, SpiritsScene],
});

// Handle for the browser console and automated smoke tests.
(window as unknown as { __tamerunner?: Phaser.Game }).__tamerunner = game;
installAudio(game);
