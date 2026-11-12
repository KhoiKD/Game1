// Generates the stage tilemaps in public/assets/levels from the layouts below.
// Run with: node tools/gen-levels.mjs
// The output is ordinary Tiled JSON, so a level can also be opened and edited
// in Tiled; re-running this script overwrites such edits.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/assets/levels');
const T = 32; // tile size
const H = 17; // map height in tiles
const FLOOR = 15; // row of the floor's top surface
const FLYING = new Set(['volt-firefly', 'umbra-hawkmoth', 'gale-hummingbird']);
const NEEDS_ROOM = new Set(['ember-fireant', 'ember-komodo', 'tide-bluewhale', 'umbra-blackwidow']); // chargers and hoppers

/**
 * A layout:
 *   width        map width in tiles
 *   floors       [firstCol, lastCol] floor segments; gaps between them are pits
 *   platforms    [firstCol, lastCol, row]
 *   checkpoints  four floor columns, in order
 *   floorPickups columns with a pickup on the floor (platform ends get one automatically)
 *   enemies      [kind, col, row]; row is the surface it stands on, or the hover line for flyers
 *   boss         [kind, col]
 */
const LAYOUTS = {
  level1: {
    width: 180,
    floors: [[0, 39], [43, 70], [75, 110], [114, 179]],
    platforms: [[22, 27, 12], [30, 33, 10], [52, 58, 12], [60, 64, 10], [72, 73, 13], [85, 92, 12], [95, 98, 9], [100, 106, 12], [120, 125, 12], [128, 131, 10]],
    checkpoints: [36, 66, 108, 146],
    floorPickups: [10, 14, 18, 38, 47, 50, 80, 84, 118],
    enemies: [
      ['verdant-stickinsect', 16, FLOOR], ['volt-flytrap', 32, 10], ['verdant-oak', 48, FLOOR], ['verdant-stickinsect', 55, 12],
      ['volt-flytrap', 63, 10], ['ember-fireant', 90, FLOOR], ['volt-flytrap', 97, 9], ['verdant-stickinsect', 103, 12],
      ['ember-fireant', 126, FLOOR], ['volt-flytrap', 130, 10], ['verdant-oak', 138, FLOOR],
    ],
    boss: ['komodrake', 168],
  },
  level2: {
    width: 200,
    floors: [[0, 34], [38, 60], [66, 96], [100, 128], [132, 199]],
    platforms: [[14, 18, 12], [24, 28, 10], [44, 50, 12], [54, 57, 9], [62, 64, 13], [72, 78, 12], [84, 90, 10], [104, 110, 12], [114, 118, 9], [136, 142, 12], [146, 150, 10]],
    checkpoints: [30, 58, 94, 162],
    floorPickups: [8, 21, 40, 52, 68, 82, 102, 122, 134, 156],
    enemies: [
      ['tide-pufferfish', 12, FLOOR], ['volt-firefly', 20, 8], ['gale-dandelion', 26, 10], ['gale-hummingbird', 42, 9],
      ['tide-pufferfish', 47, 12], ['umbra-blackwidow', 78, FLOOR], ['volt-firefly', 82, 7], ['gale-dandelion', 87, 10],
      ['tide-bluewhale', 114, FLOOR], ['gale-hummingbird', 120, 6], ['tide-pufferfish', 139, 12], ['umbra-blackwidow', 152, FLOOR],
      ['volt-firefly', 158, 8],
    ],
    boss: ['abyssalon', 186],
  },
  level3: {
    width: 220,
    floors: [[0, 30], [35, 62], [67, 90], [95, 120], [125, 150], [154, 219]],
    platforms: [[8, 12, 12], [16, 20, 10], [38, 43, 12], [48, 52, 9], [64, 65, 13], [70, 75, 12], [80, 85, 10], [98, 103, 12], [108, 112, 9], [122, 123, 13], [128, 133, 12], [138, 142, 10], [158, 163, 12], [170, 175, 10]],
    checkpoints: [28, 88, 148, 182],
    floorPickups: [6, 24, 37, 60, 69, 97, 118, 127, 156, 178],
    enemies: [
      ['umbra-blackwidow', 14, FLOOR], ['umbra-hawkmoth', 20, 8], ['ember-komodo', 47, FLOOR], ['volt-flytrap@2', 50, 9],
      ['umbra-hawkmoth', 56, 7], ['tide-pufferfish@2', 72, 12], ['umbra-blackwidow@2', 78, FLOOR], ['gale-hummingbird@2', 84, 7],
      ['gale-dandelion@2', 100, 12], ['ember-fireant@2', 108, FLOOR], ['verdant-oak@2', 116, FLOOR], ['tide-bluewhale', 137, FLOOR],
      ['umbra-hawkmoth@2', 142, 6], ['verdant-stickinsect@2', 160, FLOOR], ['ember-komodo@2', 172, FLOOR], ['volt-firefly@2', 176, 7],
    ],
    boss: ['atroposphinx', 206],
  },
};

function build(name, layout) {
  const W = layout.width;
  const data = new Array(W * H).fill(0);
  const solid = (c, r) => data[r * W + c] === 1;
  for (const [a, b] of layout.floors) for (let c = a; c <= b; c++) data[FLOOR * W + c] = data[(FLOOR + 1) * W + c] = 1;
  for (const [a, b, r] of layout.platforms) for (let c = a; c <= b; c++) data[r * W + c] = 1;
  const fail = (message) => {
    throw new Error(`${name}: ${message}`);
  };

  const objects = [];
  let id = 1;
  const point = (objName, type, x, y, properties) =>
    objects.push({ id: id++, name: objName, type, x, y, width: 0, height: 0, point: true, rotation: 0, visible: true, ...(properties ? { properties } : {}) });
  const kindProp = (kind) => [{ name: 'kind', type: 'string', value: kind }];

  point('spawn', 'spawn', 3 * T, FLOOR * T);

  layout.checkpoints.forEach((col, i) => {
    if (!solid(col, FLOOR)) fail(`checkpoint ${i + 1} at column ${col} is not on the floor`);
    objects.push({
      id: id++, name: `cp-${i + 1}`, type: 'checkpoint', x: col * T, y: FLOOR * T - 96, width: T, height: 96, rotation: 0, visible: true,
      properties: [{ name: 'order', type: 'int', value: i + 1 }],
    });
  });

  const pickups = layout.floorPickups.map((col) => [col * T + T / 2, FLOOR * T - 32]);
  for (const [a, b, r] of layout.platforms) {
    pickups.push([a * T + T / 2, r * T - 24]);
    if (b > a) pickups.push([b * T + T / 2, r * T - 24]);
  }
  pickups.sort((p, q) => p[0] - q[0]);
  pickups.forEach(([x, y], i) => point(`pickup-${String(i + 1).padStart(2, '0')}`, 'pickup', x, y));

  layout.enemies.forEach(([kind, col, row], i) => {
    const family = kind.split('@')[0];
    if (FLYING.has(family)) {
      if (solid(col, row) || solid(col, row - 1)) fail(`flyer ${kind} at column ${col} hovers inside a platform`);
    } else {
      if (!solid(col, row)) fail(`${kind} at column ${col}, row ${row} has nothing to stand on`);
      if (solid(col, row - 1)) fail(`${kind} at column ${col}, row ${row} is inside a tile`);
    }
    if (NEEDS_ROOM.has(family)) {
      // Chargers and hoppers roam: they need unbroken ground well to either side.
      for (let c = col - 9; c <= col + 9; c++) if (!solid(c, row)) fail(`${kind} at column ${col} needs ground from ${col - 9} to ${col + 9}`);
    }
    point(`enemy-${String(i + 1).padStart(2, '0')}`, 'enemy', col * T + T / 2, row * T, kindProp(kind));
  });

  const [bossKind, bossCol] = layout.boss;
  for (let c = bossCol - 12; c <= Math.min(W - 1, bossCol + 12); c++) if (!solid(c, FLOOR)) fail('the boss arena needs unbroken floor');
  if (bossCol - layout.checkpoints[layout.checkpoints.length - 1] < 18) fail('the last checkpoint is too close to the boss');
  point('boss-01', 'boss', bossCol * T + T / 2, FLOOR * T, kindProp(bossKind));

  return {
    compressionlevel: -1, height: H, width: W, tilewidth: T, tileheight: T, infinite: false,
    orientation: 'orthogonal', renderorder: 'right-down', type: 'map', version: '1.10', tiledversion: '1.10.2',
    nextlayerid: 3, nextobjectid: id,
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data },
      { id: 2, name: 'objects', type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects },
    ],
    tilesets: [{
      firstgid: 1, name: 'tiles', image: '../tilesets/tiles.png', imagewidth: T, imageheight: T,
      tilewidth: T, tileheight: T, tilecount: 1, columns: 1, margin: 0, spacing: 0,
    }],
  };
}

mkdirSync(OUT, { recursive: true });
for (const [name, layout] of Object.entries(LAYOUTS)) {
  const level = build(name, layout);
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(level));
  console.log(`${name}: ${layout.width} tiles wide, ${layout.enemies.length} enemies, boss ${layout.boss[0]}`);
}
