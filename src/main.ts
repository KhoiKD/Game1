import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GRAVITY, RENDER_SCALE } from './config';
import { BootScene } from './scenes/BootScene';
import { ClassSelectScene } from './scenes/ClassSelectScene';
import { HubScene } from './scenes/HubScene';
import { InventoryScene } from './scenes/InventoryScene';
import { LevelScene } from './scenes/LevelScene';
import { SpiritsScene } from './scenes/SpiritsScene';
import { TitleScene } from './scenes/TitleScene';
import { PauseScene } from './scenes/PauseScene';
import { installAudio } from './audio/director';
import { sharpenText } from './ui/detailCamera';

sharpenText();
setFavicon();

/** A small spirit-crystal icon for the browser tab, drawn in code like the rest of the art. */
function setFavicon(): void {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const glow = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  glow.addColorStop(0, '#b8ffd0');
  glow.addColorStop(1, '#5fd38d00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 32, 32);
  const facets: Array<[string, number[]]> = [
    ['#d6ffe4', [16, 2, 7, 16, 16, 16]],
    ['#7ef7a3', [16, 2, 25, 16, 16, 16]],
    ['#3fb26a', [7, 16, 16, 30, 16, 16]],
    ['#1f7a48', [25, 16, 16, 30, 16, 16]],
  ];
  for (const [colour, p] of facets) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(p[0]!, p[1]!);
    ctx.lineTo(p[2]!, p[3]!);
    ctx.lineTo(p[4]!, p[5]!);
    ctx.fill();
  }
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = canvas.toDataURL();
  document.head.appendChild(link);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // Scenes lay out in GAME_WIDTH x GAME_HEIGHT; the canvas is larger so detailed art is sharp.
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: '#10131c',
  roundPixels: true,
  // Raw frame deltas: Phaser's smoothing clamps slow frames to 1/60 s, which
  // made the whole game run in slow motion on slow machines. Arcade physics
  // still steps at a fixed 60 Hz, several steps per frame when needed.
  fps: { smoothStep: false, min: 10 },
  render: { powerPreference: 'high-performance' },
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
  scene: [BootScene, TitleScene, ClassSelectScene, HubScene, LevelScene, InventoryScene, SpiritsScene, PauseScene],
});

// Handle for the browser console and automated smoke tests.
(window as unknown as { __tamerunner?: Phaser.Game }).__tamerunner = game;
installAudio(game);
