import Phaser from 'phaser';
import { ELEMENTS } from '../data/elementData';
import { progression } from '../data/progressionData';
import { RARITIES } from '../data/weaponData';
import { ELEMENT_COLOR } from '../ui/elementColors';
import { drawAllArt } from '../art/render';
import { getSession } from '../state/session';
import { RARITY_COLOR } from '../ui/rarity';

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
    for (const stage of progression.stages) {
      this.load.tilemapTiledJSON(stage.map, `${base}assets/levels/${stage.map}.json`);
    }
  }

  create(): void {
    drawAllArt(this);

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

    // Dropped weapons: a crate whose band shows the rarity.
    for (const rarity of RARITIES) {
      this.makeTexture(`loot-${rarity}`, 22, 18, (g) => {
        g.fillStyle(0x1c2233).fillRect(0, 0, 22, 18);
        g.fillStyle(RARITY_COLOR[rarity]).fillRect(0, 6, 22, 6);
        g.lineStyle(2, RARITY_COLOR[rarity]).strokeRect(1, 1, 20, 16);
      });
    }

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

    this.makeEnemyTextures();

    this.makeTexture('enemy-bullet', 10, 10, (g) => {
      g.fillStyle(0xff6b6b).fillCircle(5, 5, 5);
      g.fillStyle(0xffe3e3).fillCircle(5, 5, 2);
    });

    // New players pick a class first; a stage in progress resumes; otherwise the hub.
    const session = getSession();
    if (!session.profile.classId) this.scene.start('ClassSelect');
    else if (session.run) this.scene.start('Level', { stageId: session.run.stageId, tier: session.run.tier });
    else this.scene.start('Hub');
  }

  /**
   * Every enemy shape and the boss, in each element's colours, plus a pale
   * "-warn" variant shown during the telegraph beat before an attack.
   */
  private makeEnemyTextures(): void {
    type Draw = (g: Phaser.GameObjects.Graphics, body: number, dark: number) => void;
    const shapes: Record<string, { w: number; h: number; draw: Draw }> = {
      walker: { w: 28, h: 28, draw: (g, body, dark) => {
        g.fillStyle(body).fillRect(0, 0, 28, 28);
        g.fillStyle(dark).fillRect(16, 7, 7, 7);
      } },
      turret: { w: 28, h: 28, draw: (g, body, dark) => {
        g.fillStyle(body).fillRect(0, 6, 28, 22);
        g.fillStyle(dark).fillRect(9, 0, 10, 14);
      } },
      hopper: { w: 30, h: 22, draw: (g, body, dark) => {
        g.fillStyle(body).fillTriangle(0, 22, 15, 0, 30, 22);
        g.fillStyle(dark).fillRect(17, 10, 5, 5);
        g.fillStyle(dark).fillRect(0, 19, 8, 3).fillRect(22, 19, 8, 3);
      } },
      flyer: { w: 34, h: 18, draw: (g, body, dark) => {
        g.fillStyle(dark).fillTriangle(0, 0, 14, 9, 0, 14).fillTriangle(34, 0, 20, 9, 34, 14);
        g.fillStyle(body).fillTriangle(8, 9, 17, 0, 26, 9).fillTriangle(8, 9, 17, 18, 26, 9);
      } },
      charger: { w: 34, h: 24, draw: (g, body, dark) => {
        g.fillStyle(body).fillRect(0, 4, 24, 20).fillTriangle(24, 4, 34, 14, 24, 24);
        g.fillStyle(dark).fillRect(18, 9, 5, 5).fillTriangle(26, 2, 34, 0, 30, 9);
      } },
      lobber: { w: 26, h: 30, draw: (g, body, dark) => {
        g.fillStyle(body).fillCircle(13, 17, 13);
        g.fillStyle(dark).fillRect(9, 0, 8, 9).fillRect(15, 13, 5, 5);
      } },
      boss: { w: 128, h: 128, draw: (g, body, dark) => {
        g.fillStyle(body).fillRect(0, 16, 128, 112);
        g.fillStyle(body).fillTriangle(16, 16, 40, 16, 28, 0).fillTriangle(52, 16, 76, 16, 64, 0).fillTriangle(88, 16, 112, 16, 100, 0);
        g.fillStyle(dark).fillRect(24, 72, 80, 56).fillRect(84, 36, 20, 14);
      } },
    };
    const shade = (color: number, factor: number): number => {
      const channel = (shift: number): number => Math.round(((color >> shift) & 0xff) * factor) << shift;
      return channel(16) | channel(8) | channel(0);
    };
    const palettes: Array<[string, number]> = [['none', 0xc8ccd6], ...ELEMENTS.map((e): [string, number] => [e, ELEMENT_COLOR[e]])];
    for (const [shape, { w, h, draw }] of Object.entries(shapes)) {
      for (const [name, color] of palettes) {
        this.makeTexture(`enemy-${shape}-${name}`, w, h, (g) => draw(g, shade(color, 0.85), shade(color, 0.35)));
        this.makeTexture(`enemy-${shape}-${name}-warn`, w, h, (g) => draw(g, 0xfff3b0, shade(color, 0.7)));
      }
    }
  }

  private makeTexture(
    key: string,
    width: number,
    height: number,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): void {
    if (this.textures.exists(key)) return; // Boot runs again after a save reset
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, width, height);
    g.destroy();
  }
}
