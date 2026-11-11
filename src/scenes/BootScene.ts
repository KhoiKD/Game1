import Phaser from 'phaser';

/**
 * Loads the level assets and generates the remaining placeholder textures in
 * code (colored shapes). Real art replaces these later; see ASSETS.md.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const base = import.meta.env.BASE_URL;
    this.load.image('tiles', `${base}assets/tilesets/tiles.png`);
    this.load.tilemapTiledJSON('level1', `${base}assets/levels/level1.json`);
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

    this.makeTexture('reticle', 24, 24, (g) => {
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeCircle(12, 12, 8);
      g.lineBetween(12, 0, 12, 6);
      g.lineBetween(12, 18, 12, 24);
      g.lineBetween(0, 12, 6, 12);
      g.lineBetween(18, 12, 24, 12);
    });

    // Checkpoint: pole with a flag. Grey when inactive, gold once reached.
    for (const [key, pole, flag] of [
      ['checkpoint-off', 0x586179, 0x7a8199],
      ['checkpoint-on', 0xffe29a, 0xffd166],
    ] as const) {
      this.makeTexture(key, 32, 96, (g) => {
        g.fillStyle(pole).fillRect(4, 0, 4, 96);
        g.fillStyle(flag).fillTriangle(8, 4, 8, 28, 28, 16);
      });
    }

    this.makeTexture('pickup', 16, 16, (g) => {
      g.fillStyle(0x7ef7a3);
      g.fillTriangle(8, 0, 16, 8, 8, 16);
      g.fillTriangle(8, 0, 0, 8, 8, 16);
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
