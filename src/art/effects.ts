import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../config';
import { RARITIES, WEAPON_ELEMENTS, type WeaponElement } from '../data/weaponData';
import { RARITY_COLOR } from '../ui/rarity';
import { ELEMENT_RAMPS, OUTLINE } from './palette';
import { registerDetail } from './render';

/**
 * Projectiles, pickups, loot crates, checkpoint flags, the reticle, and the
 * soft shadow, painted with canvas gradients at the canvas's full resolution.
 * Sizes are in world pixels.
 */
type Paint = (ctx: CanvasRenderingContext2D) => void;

export function paintTexture(scene: Phaser.Scene, key: string, width: number, height: number, paint: Paint, texelsPerPixel = RENDER_SCALE): void {
  registerDetail(key, texelsPerPixel);
  if (scene.textures.exists(key)) return; // Boot runs again after a save reset
  const texture = scene.textures.createCanvas(key, Math.ceil(width * texelsPerPixel), Math.ceil(height * texelsPerPixel));
  if (!texture) throw new Error(`Could not create texture "${key}"`);
  const ctx = texture.getContext();
  ctx.scale(texelsPerPixel, texelsPerPixel);
  paint(ctx);
  texture.refresh();
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function glowBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: Array<[number, string]>): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Colours of a player shot: kinetic shots burn gold, elemental shots take their element's hue. */
function shotColours(element: WeaponElement): { core: string; body: string; edge: string } {
  const [light, mid, dark] = element === 'kinetic' ? ['#fff4c8', '#ffc94d', '#d0761f'] : ELEMENT_RAMPS[element];
  return { core: '#ffffff', body: element === 'kinetic' ? mid : light, edge: element === 'kinetic' ? dark : mid };
}

/** Every player projectile shape, once per element: "<shape>" is kinetic, "<shape>-<Element>" the rest. */
function paintProjectiles(scene: Phaser.Scene): void {
  for (const element of WEAPON_ELEMENTS) {
    const { core, body, edge } = shotColours(element);
    const key = (shape: string): string => (element === 'kinetic' ? shape : `${shape}-${element}`);
    const fade = (c: string): string => `${c}00`;

    // Tracer: a capsule with a hot core and a fading tail.
    paintTexture(scene, key('bullet'), 10, 4, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 10, 0);
      g.addColorStop(0, fade(edge));
      g.addColorStop(0.45, edge);
      g.addColorStop(0.8, body);
      g.addColorStop(1, core);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(5, 2, 5, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.ellipse(7.2, 2, 2.4, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    paintTexture(scene, key('pellet'), 6, 6, (ctx) => glowBlob(ctx, 3, 3, 3, [[0, core], [0.35, body], [0.75, edge], [1, fade(edge)]]));
    paintTexture(scene, key('beam'), 26, 3, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 3);
      g.addColorStop(0, fade(edge));
      g.addColorStop(0.3, body);
      g.addColorStop(0.5, core);
      g.addColorStop(0.7, body);
      g.addColorStop(1, fade(edge));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 26, 3);
    });
    paintTexture(scene, key('grenade'), 12, 12, (ctx) => {
      glowBlob(ctx, 6, 6, 6, [[0, `${body}cc`], [1, fade(edge)]]);
      const shell = ctx.createRadialGradient(4.5, 4.5, 0.5, 6, 6, 4.5);
      shell.addColorStop(0, '#d8dde8');
      shell.addColorStop(0.5, '#7c8599');
      shell.addColorStop(1, '#2a2f3d');
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.arc(6, 6, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.fillStyle = edge;
      ctx.fillRect(3.2, 5.4, 5.6, 1.2); // band
      glowBlob(ctx, 8.6, 3.2, 1.8, [[0, core], [0.5, body], [1, fade(body)]]); // lit fuse
    });
    paintTexture(scene, key('slash'), 12, 28, (ctx) => {
      // A crescent of light, brightest along its leading edge.
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(15, 14, 0, 28);
      ctx.quadraticCurveTo(7, 14, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 12, 0);
      g.addColorStop(0, fade(edge));
      g.addColorStop(0.5, body);
      g.addColorStop(1, core);
      ctx.fillStyle = g;
      ctx.fill();
    });
    paintTexture(scene, key('charge-shot'), 30, 12, (ctx) => {
      // A comet: glowing head, tapering tail.
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.quadraticCurveTo(14, 0.5, 24, 1);
      ctx.lineTo(24, 11);
      ctx.quadraticCurveTo(14, 11.5, 0, 6);
      const tail = ctx.createLinearGradient(0, 0, 24, 0);
      tail.addColorStop(0, fade(edge));
      tail.addColorStop(1, `${body}dd`);
      ctx.fillStyle = tail;
      ctx.fill();
      glowBlob(ctx, 24, 6, 6, [[0, core], [0.4, body], [0.8, edge], [1, fade(edge)]]);
    });
  }
}

export function paintEffects(scene: Phaser.Scene): void {
  paintProjectiles(scene);

  // Hostile shots are always the same hot magenta, so they read against any element.
  paintTexture(scene, 'enemy-bullet', 10, 10, (ctx) => {
    glowBlob(ctx, 5, 5, 5, [[0, '#ffffff'], [0.25, '#ffd0e0'], [0.55, '#ff4f7a'], [0.85, '#a3124a'], [1, '#a3124a00']]);
  });

  // Dropped weapons: an iron-bound chest; the lock gem and glow show the rarity.
  RARITIES.forEach((rarity, rank) => {
    const colour = hex(RARITY_COLOR[rarity]);
    paintTexture(scene, `loot-${rarity}`, 22, 18, (ctx) => {
      if (rank >= 2) glowBlob(ctx, 11, 10, 11, [[0, `${colour}aa`], [1, `${colour}00`]]);
      const wood = ctx.createLinearGradient(0, 4, 0, 17);
      wood.addColorStop(0, '#b07a48');
      wood.addColorStop(1, '#5a3520');
      ctx.fillStyle = wood;
      ctx.fillRect(2, 6, 18, 11);
      const lid = ctx.createLinearGradient(0, 2, 0, 8);
      lid.addColorStop(0, '#c99260');
      lid.addColorStop(1, '#7a4b2c');
      ctx.fillStyle = lid;
      ctx.beginPath();
      ctx.moveTo(2, 8);
      ctx.quadraticCurveTo(11, 0, 20, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9aa6bd'; // iron bands
      ctx.fillRect(5, 3.6, 1.6, 13.4);
      ctx.fillRect(15.4, 3.6, 1.6, 13.4);
      ctx.fillStyle = colour;
      ctx.fillRect(2, 8, 18, 1.4); // rarity trim on the seam
      glowBlob(ctx, 11, 10, 2.6, [[0, '#ffffff'], [0.4, colour], [1, `${colour}88`]]);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(2, 17);
      ctx.lineTo(2, 8);
      ctx.quadraticCurveTo(11, 0, 20, 8);
      ctx.lineTo(20, 17);
      ctx.closePath();
      ctx.stroke();
    });
  });

  paintTexture(scene, 'reticle', 24, 24, (ctx) => {
    ctx.strokeStyle = 'rgba(20, 15, 31, 0.6)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(12, 12, 7.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    for (const [x1, y1, x2, y2] of [[12, 0.5, 12, 5.5], [12, 18.5, 12, 23.5], [0.5, 12, 5.5, 12], [18.5, 12, 23.5, 12]] as const) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    glowBlob(ctx, 12, 12, 1.4, [[0, '#ffffff'], [1, '#ff4f7a']]);
  });

  // Checkpoint: a stone post with a lantern and banner. Unlit until reached, then gold.
  for (const [key, lit] of [['checkpoint-off', false], ['checkpoint-on', true]] as const) {
    paintTexture(scene, key, 32, 96, (ctx) => {
      if (lit) glowBlob(ctx, 8, 14, 16, [[0, '#ffe7a0cc'], [1, '#ffd16600']]);
      const stone = ctx.createLinearGradient(3, 0, 11, 0);
      stone.addColorStop(0, '#a9a3bd');
      stone.addColorStop(1, '#4d4863');
      ctx.fillStyle = stone;
      ctx.fillRect(5, 20, 6, 74);
      ctx.fillRect(2, 88, 12, 8); // foot
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(4, 8, 8, 2); // lantern cap
      const glass = ctx.createRadialGradient(8, 14, 0.5, 8, 14, 5);
      glass.addColorStop(0, lit ? '#ffffff' : '#7a8199');
      glass.addColorStop(0.5, lit ? '#ffe29a' : '#4a5066');
      glass.addColorStop(1, lit ? '#e09a2a' : '#2a3042');
      ctx.fillStyle = glass;
      ctx.fillRect(4.5, 10, 7, 9);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(4.5, 10, 7, 9);
      // Banner, rippling.
      ctx.beginPath();
      ctx.moveTo(11, 24);
      ctx.bezierCurveTo(18, 22, 24, 27, 30, 25);
      ctx.lineTo(28, 33);
      ctx.lineTo(30, 41);
      ctx.bezierCurveTo(24, 43, 18, 38, 11, 40);
      ctx.closePath();
      const cloth = ctx.createLinearGradient(11, 24, 30, 40);
      cloth.addColorStop(0, lit ? '#ffe9a8' : '#8a90a8');
      cloth.addColorStop(1, lit ? '#c98a1e' : '#4a5066');
      ctx.fillStyle = cloth;
      ctx.fill();
      ctx.stroke();
      ctx.strokeRect(5, 20, 6, 74);
    });
  }

  // Health shard pickup: a faceted green crystal with a halo.
  paintTexture(scene, 'pickup', 16, 16, (ctx) => {
    glowBlob(ctx, 8, 8, 8, [[0, '#b8ffd0aa'], [1, '#5fd38d00']]);
    const facets: Array<[string, number[]]> = [
      ['#d6ffe4', [8, 1.5, 3.5, 8, 8, 8]],
      ['#7ef7a3', [8, 1.5, 12.5, 8, 8, 8]],
      ['#3fb26a', [3.5, 8, 8, 14.5, 8, 8]],
      ['#1f7a48', [12.5, 8, 8, 14.5, 8, 8]],
    ];
    for (const [colour, p] of facets) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(p[0]!, p[1]!);
      ctx.lineTo(p[2]!, p[3]!);
      ctx.lineTo(p[4]!, p[5]!);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(8, 1.5);
    ctx.lineTo(12.5, 8);
    ctx.lineTo(8, 14.5);
    ctx.lineTo(3.5, 8);
    ctx.closePath();
    ctx.stroke();
  });

  // Particles: a soft white spark (tinted per element) and a thin ring.
  paintTexture(scene, 'spark', 8, 8, (ctx) => glowBlob(ctx, 4, 4, 4, [[0, '#ffffff'], [0.35, '#ffffffcc'], [1, '#ffffff00']]));
  paintTexture(scene, 'ring', 64, 64, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 32, 29, 0, Math.PI * 2);
    ctx.stroke();
  });
  // Screen-edge red glow shown when the player is hurt.
  paintTexture(
    scene,
    'vignette',
    GAME_WIDTH,
    GAME_HEIGHT,
    (ctx) => {
      const g = ctx.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.35, GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 0.62);
      g.addColorStop(0, 'rgba(200, 20, 40, 0)');
      g.addColorStop(1, 'rgba(200, 20, 40, 0.85)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    },
    0.5,
  );

  // Soft contact shadow under feet.
  paintTexture(scene, 'shadow', 32, 10, (ctx) => {
    ctx.save();
    ctx.scale(1, 10 / 32);
    glowBlob(ctx, 16, 16, 16, [[0, 'rgba(10, 6, 20, 0.55)'], [0.6, 'rgba(10, 6, 20, 0.3)'], [1, 'rgba(10, 6, 20, 0)']]);
    ctx.restore();
  });
}
