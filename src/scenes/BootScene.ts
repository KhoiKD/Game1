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

    // Projectiles, one per weapon archetype family (see "projectile" in weapons.json).
    this.makeTexture('pellet', 6, 6, (g) => {
      g.fillStyle(0xffb347).fillCircle(3, 3, 3);
    });
    this.makeTexture('beam', 26, 3, (g) => {
      g.fillStyle(0xfff275).fillRect(0, 0, 26, 3);
    });
    this.makeTexture('grenade', 12, 12, (g) => {
      g.fillStyle(0xe4572e).fillCircle(6, 6, 6);
      g.fillStyle(0xffd166).fillCircle(6, 6, 2);
    });
    this.makeTexture('slash', 12, 28, (g) => {
      g.fillStyle(0x7ef7a3).fillTriangle(0, 0, 12, 14, 0, 28);
    });
    this.makeTexture('charge-shot', 30, 12, (g) => {
      g.fillStyle(0x4cc9f0).fillRect(0, 0, 30, 12);
      g.fillStyle(0xe0fbff).fillRect(8, 3, 22, 6);
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

    this.makeTexture('enemy-walker', 28, 28, (g) => {
      g.fillStyle(0xe07a5f).fillRect(0, 0, 28, 28);
      g.fillStyle(0x3d1f17).fillRect(16, 7, 7, 7);
    });

    // Turret and boss each have a "warn" variant shown during the telegraph beat.
    for (const [key, body, core] of [
      ['enemy-turret', 0xb388eb, 0x3b2a5c],
      ['enemy-turret-warn', 0xfff3b0, 0xff6b6b],
    ] as const) {
      this.makeTexture(key, 28, 28, (g) => {
        g.fillStyle(body).fillRect(0, 6, 28, 22);
        g.fillStyle(core).fillRect(9, 0, 10, 14);
      });
    }

    for (const [key, body, belly, eye] of [
      ['boss', 0xc8452c, 0xf2a65a, 0x2b0f0a],
      ['boss-warn', 0xfff3b0, 0xffd166, 0xc8452c],
    ] as const) {
      this.makeTexture(key, 128, 128, (g) => {
        g.fillStyle(body).fillRect(0, 16, 128, 112);
        g.fillStyle(belly).fillRect(24, 72, 80, 56);
        g.fillStyle(body).fillTriangle(16, 16, 40, 16, 28, 0);
        g.fillStyle(body).fillTriangle(52, 16, 76, 16, 64, 0);
        g.fillStyle(body).fillTriangle(88, 16, 112, 16, 100, 0);
        g.fillStyle(eye).fillRect(84, 36, 20, 14);
      });
    }

    this.makeTexture('enemy-bullet', 10, 10, (g) => {
      g.fillStyle(0xff6b6b).fillCircle(5, 5, 5);
      g.fillStyle(0xffe3e3).fillCircle(5, 5, 2);
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
