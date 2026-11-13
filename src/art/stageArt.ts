import Phaser from 'phaser';
import { GAME_HEIGHT, RENDER_SCALE, TILE } from '../config';
import { displayScale } from './render';
import { paintTexture } from './effects';
import { TILE_COUNT, cellVariant, neighbourMask, paintTile, tileIndex } from './tiles';
import { themeFor, type StageTheme } from './themes';

/**
 * A stage's scenery: the detailed ground tiles (drawn over the plain collision
 * layer, which is hidden), a parallax backdrop, and soft shadows under
 * characters and creatures.
 */
const TEXELS = TILE * RENDER_SCALE;
const COLUMNS = 8;
/** Width of one repeat of a backdrop layer, in world pixels. */
const BACKDROP_WIDTH = 1024;

interface ParallaxLayer {
  images: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  factor: number;
}

interface Shadowed {
  target: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  width: number;
}

const STAGE_TEXTURE = /^(tiles-detail|backdrop-far|backdrop-mid)-(.+)$/;

/** Frees the ground and backdrop textures painted for other stages (they are repainted if needed). */
export function releaseOtherStages(scene: Phaser.Scene, keepStageId: string): void {
  for (const key of scene.textures.getTextureKeys()) {
    const match = STAGE_TEXTURE.exec(key);
    if (match && match[2] !== keepStageId) scene.textures.remove(key);
  }
}

/** The sky and the two scrolling scenery layers behind a stage (also used on the title screen). */
export class Backdrop {
  private readonly layers: ParallaxLayer[] = [];

  constructor(private readonly scene: Phaser.Scene, stageId: string) {
    const theme = themeFor(stageId);
    const far = `backdrop-far-${stageId}`;
    paintTexture(scene, far, BACKDROP_WIDTH, GAME_HEIGHT, (ctx) => {
      paintSky(ctx, theme);
      paintFar(ctx, theme);
    }, 1);
    this.addLayer(far, 0.12, -20, 1);

    const mid = `backdrop-mid-${stageId}`;
    paintTexture(scene, mid, BACKDROP_WIDTH, GAME_HEIGHT, (ctx) => paintMid(ctx, theme), RENDER_SCALE);
    this.addLayer(mid, 0.35, -10, RENDER_SCALE);
  }

  /** Low detail drops the scenery layer: one full-screen layer fewer for slow machines. */
  setDetail(high: boolean): void {
    const mid = this.layers[1];
    for (const image of mid?.images ?? []) image.setVisible(high);
  }

  /** Positions the layers for a camera scrolled to `scrollX`. */
  scrollTo(scrollX: number): void {
    for (const { images, factor } of this.layers) {
      const offset = ((scrollX * factor) % BACKDROP_WIDTH + BACKDROP_WIDTH) % BACKDROP_WIDTH;
      images[0].x = -offset;
      images[1].x = BACKDROP_WIDTH - offset;
    }
  }

  private addLayer(key: string, factor: number, depth: number, texelsPerPixel: number): void {
    const make = (): Phaser.GameObjects.Image =>
      this.scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(depth).setScale(1 / texelsPerPixel);
    this.layers.push({ images: [make(), make()], factor });
  }
}

export class StageArt {
  private readonly backdrop: Backdrop;
  private readonly shadowed: Shadowed[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    stageId: string,
    private readonly ground: Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer,
  ) {
    const theme = themeFor(stageId);
    this.buildTiles(stageId, theme);
    this.backdrop = new Backdrop(scene, stageId);
  }

  /** Moves the backdrop with the camera and keeps shadows on the floor. Call every frame. */
  update(): void {
    this.backdrop.scrollTo(this.scene.cameras.main.scrollX);
    for (let i = this.shadowed.length - 1; i >= 0; i--) {
      const entry = this.shadowed[i]!;
      if (!entry.target.scene) {
        // Destroyed (enemies are rebuilt on respawn): drop its shadow too.
        entry.shadow.destroy();
        this.shadowed.splice(i, 1);
      } else this.placeShadow(entry);
    }
  }

  setDetail(high: boolean): void {
    this.backdrop.setDetail(high);
  }

  /** Gives a sprite a soft shadow on the ground beneath it. */
  addShadow(target: Phaser.GameObjects.Sprite, width = target.displayWidth * 0.8): void {
    const shadow = this.scene.add.image(target.x, target.y, 'shadow').setDepth(0.5);
    this.shadowed.push({ target, shadow, width });
  }

  private placeShadow({ target, shadow, width }: Shadowed): void {
    if (!target.active || !target.visible) {
      shadow.setVisible(false);
      return;
    }
    const body = target.body as Phaser.Physics.Arcade.Body | null;
    const feet = body ? body.bottom : target.getBottomCenter().y;
    const floor = this.floorBelow(target.x, feet - 2);
    if (floor === null) {
      shadow.setVisible(false);
      return;
    }
    // Higher above the floor: smaller and fainter.
    const fade = Math.max(0, 1 - Math.max(0, floor - feet) / 220);
    const unit = displayScale('shadow');
    shadow
      .setVisible(fade > 0)
      .setPosition(target.x, floor)
      .setAlpha(0.35 + 0.55 * fade)
      .setScale((width / 32) * (0.55 + 0.45 * fade) * unit, unit * (0.6 + 0.4 * fade));
  }

  /** Top of the first solid tile at or below (x, y), or null over a pit. */
  private floorBelow(x: number, y: number): number | null {
    const layer = this.ground;
    const tx = Math.floor(x / TILE);
    for (let ty = Math.max(0, Math.floor(y / TILE)); ty < layer.layer.height; ty++) {
      if (layer.getTileAt(tx, ty)) return ty * TILE;
    }
    return null;
  }

  // ---- ground --------------------------------------------------------------

  private buildTiles(stageId: string, theme: StageTheme): void {
    const key = `tiles-detail-${stageId}`;
    const rows = Math.ceil(TILE_COUNT / COLUMNS);
    if (!this.scene.textures.exists(key)) {
      const texture = this.scene.textures.createCanvas(key, COLUMNS * TEXELS, rows * TEXELS);
      if (!texture) throw new Error(`Could not create texture "${key}"`);
      const ctx = texture.getContext();
      for (let mask = 0; mask < 16; mask++) {
        for (let variant = 0; variant < TILE_COUNT / 16; variant++) {
          const index = tileIndex(mask, variant);
          const data = paintTile(theme, mask, variant, TEXELS);
          ctx.putImageData(new ImageData(data, TEXELS, TEXELS), (index % COLUMNS) * TEXELS, Math.floor(index / COLUMNS) * TEXELS);
        }
      }
      texture.refresh();
    }

    // A second, purely visual map with double-resolution tiles, drawn at half scale.
    const layer = this.ground.layer;
    const solid = (x: number, y: number): boolean => (layer.data[y]?.[x]?.index ?? -1) >= 0;
    const data: number[][] = [];
    for (let y = 0; y < layer.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < layer.width; x++) {
        row.push(solid(x, y) ? tileIndex(neighbourMask(solid, x, y, layer.width, layer.height), cellVariant(x, y)) : -1);
      }
      data.push(row);
    }
    const map = this.scene.make.tilemap({ data, tileWidth: TEXELS, tileHeight: TEXELS });
    const tileset = map.addTilesetImage(key, key, TEXELS, TEXELS, 0, 0, 0);
    if (!tileset) throw new Error(`Could not add tileset "${key}"`);
    const visual = map.createLayer(0, tileset, 0, 0);
    if (!visual) throw new Error('Could not create the detailed ground layer');
    visual.setScale(1 / RENDER_SCALE).setDepth(0.4);
    this.ground.setVisible(false);
  }
}

// ---- painting ------------------------------------------------------------------

/** Deterministic pseudo-random numbers for scenery placement. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ridge line that repeats every BACKDROP_WIDTH, so the layer tiles seamlessly. */
function ridge(x: number, base: number, waves: Array<[number, number, number]>): number {
  let y = base;
  for (const [harmonic, amplitude, phase] of waves) y += Math.sin((x / BACKDROP_WIDTH) * Math.PI * 2 * harmonic + phase) * amplitude;
  return y;
}

function fillRidge(ctx: CanvasRenderingContext2D, colour: string | CanvasGradient, base: number, waves: Array<[number, number, number]>): void {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, GAME_HEIGHT);
  for (let x = 0; x <= BACKDROP_WIDTH; x += 4) ctx.lineTo(x, ridge(x, base, waves));
  ctx.lineTo(BACKDROP_WIDTH, GAME_HEIGHT);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws `draw` at x and again one repeat to each side, so shapes that cross
 * the seam wrap. Each copy gets the same random sequence, so the copies match.
 */
function wrapped(x: number, seed: number, draw: (x: number, random: () => number) => void): void {
  for (const dx of [-BACKDROP_WIDTH, 0, BACKDROP_WIDTH]) draw(x + dx, seeded(seed));
}

/**
 * The sky, painted into the far layer so the backdrop costs one fewer
 * full-screen layer to draw. Everything wraps at BACKDROP_WIDTH.
 */
function paintSky(ctx: CanvasRenderingContext2D, theme: StageTheme): void {
  const g = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  g.addColorStop(0, theme.sky[0]);
  g.addColorStop(0.6, theme.sky[1]);
  g.addColorStop(1, theme.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BACKDROP_WIDTH, GAME_HEIGHT);
  const random = seeded(7);
  if (theme.stars) {
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = `rgba(230, 220, 255, ${0.2 + random() * 0.6})`;
      ctx.fillRect(random() * BACKDROP_WIDTH, random() * GAME_HEIGHT * 0.7, 1, 1);
    }
  }
  const { colour, y, radius } = theme.orb;
  wrapped(BACKDROP_WIDTH * 0.72, 1, (ox) => {
    const oy = GAME_HEIGHT * y;
    const halo = ctx.createRadialGradient(ox, oy, radius * 0.6, ox, oy, radius * 4);
    halo.addColorStop(0, `${colour}aa`);
    halo.addColorStop(1, `${colour}00`);
    ctx.fillStyle = halo;
    ctx.fillRect(ox - radius * 4, oy - radius * 4, radius * 8, radius * 8);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(ox, oy, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  if (!theme.stars) {
    // Soft cloud banks.
    for (let i = 0; i < 10; i++) {
      wrapped(random() * BACKDROP_WIDTH, 500 + i, (cx, rand) => {
        const cy = 40 + rand() * GAME_HEIGHT * 0.4;
        for (let j = 0; j < 5; j++) {
          const r = 18 + rand() * 30;
          const puff = ctx.createRadialGradient(cx + j * 22, cy, 0, cx + j * 22, cy, r);
          puff.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
          puff.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = puff;
          ctx.fillRect(cx + j * 22 - r, cy - r, r * 2, r * 2);
        }
      });
    }
  }
}

function paintFar(ctx: CanvasRenderingContext2D, theme: StageTheme): void {
  const [far] = theme.layers;
  const haze = ctx.createLinearGradient(0, 200, 0, GAME_HEIGHT);
  haze.addColorStop(0, far);
  haze.addColorStop(1, theme.haze);
  if (theme.scenery === 'fungus-cavern') {
    // Cavern roof with hanging stalactites, and a distant floor.
    ctx.fillStyle = far;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= BACKDROP_WIDTH; x += 4) ctx.lineTo(x, ridge(x, 70, [[3, 22, 0.4], [7, 10, 1.3], [13, 6, 2]]));
    ctx.lineTo(BACKDROP_WIDTH, 0);
    ctx.fill();
    const random = seeded(11);
    for (let i = 0; i < 26; i++) {
      wrapped(random() * BACKDROP_WIDTH, 100 + i, (x, random) => {
        const len = 30 + random() * 90;
        ctx.beginPath();
        ctx.moveTo(x - 9, 60);
        ctx.lineTo(x, 60 + len);
        ctx.lineTo(x + 9, 60);
        ctx.fill();
      });
    }
    fillRidge(ctx, haze, 400, [[2, 30, 0.2], [5, 14, 1.1], [11, 6, 0.5]]);
    return;
  }
  fillRidge(ctx, haze, theme.scenery === 'sea-stacks' ? 330 : 300, [[2, 40, 0.3], [5, 18, 1.7], [9, 8, 0.9]]);
  if (theme.scenery === 'sea-stacks') {
    // Open sea below the far cliffs, with glints.
    const sea = ctx.createLinearGradient(0, 380, 0, GAME_HEIGHT);
    sea.addColorStop(0, '#5f7d9c');
    sea.addColorStop(1, '#2b3f5c');
    ctx.fillStyle = sea;
    ctx.fillRect(0, 380, BACKDROP_WIDTH, GAME_HEIGHT - 380);
    const random = seeded(5);
    ctx.fillStyle = 'rgba(230, 245, 255, 0.5)';
    for (let i = 0; i < 90; i++) ctx.fillRect(random() * BACKDROP_WIDTH, 384 + random() * 150, 6 + random() * 14, 1);
  }
}

function paintMid(ctx: CanvasRenderingContext2D, theme: StageTheme): void {
  const [, mid, near] = theme.layers;
  const random = seeded(theme.scenery.length * 17);
  const light = (x: number, y: number, r: number, colour: string, alpha: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${colour}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
    g.addColorStop(1, `${colour}00`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  if (theme.scenery === 'thorn-forest') {
    fillRidge(ctx, mid, 400, [[3, 20, 0.5], [7, 9, 2.1]]);
    // Great trunks with crowns of leaves, ringed by thorny vines.
    for (let i = 0; i < 7; i++) {
      wrapped(i * (BACKDROP_WIDTH / 7) + random() * 60, 200 + i, (x, random) => {
        const w = 22 + random() * 18;
        const trunk = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        trunk.addColorStop(0, '#3e5a44');
        trunk.addColorStop(1, near);
        ctx.fillStyle = trunk;
        ctx.fillRect(x - w / 2, 120, w, GAME_HEIGHT);
        for (let j = 0; j < 6; j++) {
          const cx = x + (random() - 0.5) * 120;
          const cy = 90 + random() * 80;
          const r = 40 + random() * 30;
          const crown = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
          crown.addColorStop(0, '#5f8f5a');
          crown.addColorStop(1, near);
          ctx.fillStyle = crown;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#2a4632';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let t = 0; t < 1; t += 0.02) {
          const vy = 180 + t * 340;
          const vx = x + Math.sin(t * 18) * (w * 0.7);
          if (t === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.stroke();
      });
    }
    fillRidge(ctx, near, 470, [[4, 12, 0.1], [11, 6, 1.4]]);
  } else if (theme.scenery === 'sea-stacks') {
    // Rock pillars standing in the surf, lit from the upper left.
    for (let i = 0; i < 6; i++) {
      wrapped(i * (BACKDROP_WIDTH / 6) + random() * 80, 300 + i, (x, random) => {
        const w = 50 + random() * 50;
        const top = 150 + random() * 140;
        const rock = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
        rock.addColorStop(0, '#7f93ad');
        rock.addColorStop(0.4, mid);
        rock.addColorStop(1, near);
        ctx.fillStyle = rock;
        ctx.beginPath();
        ctx.moveTo(x - w / 2 - 10, GAME_HEIGHT);
        ctx.lineTo(x - w / 2, top + 20);
        for (let k = 0; k <= 6; k++) ctx.lineTo(x - w / 2 + (w * k) / 6, top + (k % 2 === 0 ? 0 : 14) + random() * 10);
        ctx.lineTo(x + w / 2 + 12, GAME_HEIGHT);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(30, 40, 60, 0.35)'; // ledges
        for (let k = 0; k < 5; k++) ctx.fillRect(x - w / 2 + 4, top + 50 + k * 50, w - 8, 3);
      });
    }
    // Rolling surf with a foam line.
    fillRidge(ctx, near, 470, [[9, 6, 0.4], [17, 3, 1.1]]);
    ctx.fillStyle = 'rgba(235, 248, 255, 0.55)';
    for (let x = 0; x < BACKDROP_WIDTH; x += 3) ctx.fillRect(x, ridge(x, 468, [[9, 6, 0.4], [17, 3, 1.1]]), 3, 2);
  } else {
    // Giant fungi with glowing caps and drifting spores.
    fillRidge(ctx, mid, 420, [[3, 24, 1.2], [8, 10, 0.4]]);
    for (let i = 0; i < 8; i++) {
      wrapped(i * (BACKDROP_WIDTH / 8) + random() * 60, 400 + i, (x, random) => {
        const h = 150 + random() * 170;
        const w = 14 + random() * 10;
        const capR = 40 + random() * 40;
        const base = 470;
        ctx.fillStyle = near;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, base);
        ctx.quadraticCurveTo(x - w / 4, base - h / 2, x - w / 3, base - h);
        ctx.lineTo(x + w / 3, base - h);
        ctx.quadraticCurveTo(x + w / 4, base - h / 2, x + w / 2, base);
        ctx.fill();
        light(x, base - h, capR * 1.8, theme.accent, 0.25);
        const cap = ctx.createRadialGradient(x - capR * 0.3, base - h - capR * 0.4, 2, x, base - h, capR);
        cap.addColorStop(0, '#e0c8ff');
        cap.addColorStop(0.5, '#7a52b3');
        cap.addColorStop(1, '#2a1d48');
        ctx.fillStyle = cap;
        ctx.beginPath();
        ctx.ellipse(x, base - h, capR, capR * 0.45, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = theme.accent; // glowing gills
        for (let k = -3; k <= 3; k++) ctx.fillRect(x + k * capR * 0.25 - 1, base - h - 1, 2, 3);
      });
    }
    for (let i = 0; i < 70; i++) light(random() * BACKDROP_WIDTH, 80 + random() * 380, 3 + random() * 4, theme.accent, 0.7);
    fillRidge(ctx, near, 478, [[5, 10, 0.7], [13, 5, 2.2]]);
  }
}
