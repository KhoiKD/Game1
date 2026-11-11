import Phaser from 'phaser';
import { TILE } from '../config';

/**
 * Generates placeholder textures in code (colored shapes) so the game runs
 * with zero external assets. Real art replaces these later; see ASSETS.md.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeTexture('player', 32, 64, (g) => {
      g.fillStyle(0x4cc9f0).fillRect(0, 0, 32, 64);
      g.fillStyle(0x0b3954).fillRect(20, 10, 8, 8); // "eye" marks facing direction
    });

    this.makeTexture('gun', 22, 6, (g) => {
      g.fillStyle(0xf1f5f9).fillRect(0, 0, 22, 6);
    });

    this.makeTexture('bullet', 10, 4, (g) => {
      g.fillStyle(0xffd166).fillRect(0, 0, 10, 4);
    });

    this.makeTexture('tile', TILE, TILE, (g) => {
      g.fillStyle(0x3a4256).fillRect(0, 0, TILE, TILE);
      g.lineStyle(2, 0x586179).strokeRect(1, 1, TILE - 2, TILE - 2);
    });

    this.makeTexture('reticle', 24, 24, (g) => {
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(12, 12, 8);
      g.lineBetween(12, 0, 12, 6);
      g.lineBetween(12, 18, 12, 24);
      g.lineBetween(0, 12, 6, 12);
      g.lineBetween(18, 12, 24, 12);
    });

    this.scene.start('Level');
  }

  private makeTexture(
    key: string,
    width: number,
    height: number,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, width, height);
    g.destroy();
  }
}
