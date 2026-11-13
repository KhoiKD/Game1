import Phaser from 'phaser';
import { ELEMENTS } from '../data/elementData';
import { progression } from '../data/progressionData';
import { ELEMENT_COLOR } from '../ui/elementColors';
import { paintEffects } from '../art/effects';
import { drawAllArt } from '../art/render';

/**
 * Loads the level assets and draws every texture: sprites (art/render.ts),
 * effects (art/effects.ts), and fallback shapes for creatures without art.
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

    paintEffects(this);
    this.makeEnemyTextures();

    this.scene.start('Title');
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
