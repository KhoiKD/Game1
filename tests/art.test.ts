import { describe, expect, it } from 'vitest';
import { getFamily } from '../src/data/creatureData';
import { bossKinds, enemyKinds, getBossStats } from '../src/data/enemyData';
import { classIds } from '../src/data/progressionData';
import { ARCHETYPE_IDS, WEAPON_ELEMENTS } from '../src/data/weaponData';
import { OUTLINE } from '../src/art/palette';
import { gridProblems, gridSize, layer, mirror, rasterize, replaceRows, swapChars } from '../src/art/pixel';
import {
  BOSS_FAMILIES,
  CHARACTER_CLASSES,
  CHARACTER_FRAMES,
  CREATURE_FAMILIES,
  NPC_ART,
  bossArt,
  characterArt,
  creatureArt,
  weaponArt,
  type SpriteArt,
} from '../src/art/sprites';

/** Every frame is rectangular, the same size as the others, and uses only colours in its palette. */
function expectWellFormed(art: SpriteArt, label: string): void {
  expect(art.frames.length, label).toBeGreaterThan(0);
  const { width, height } = gridSize(art.frames[0]!);
  expect(width, label).toBeGreaterThan(0);
  art.frames.forEach((frame, i) => {
    expect(gridProblems(frame, art.palette), `${label} frame ${i}`).toEqual([]);
    expect(gridSize(frame), `${label} frame ${i} size`).toEqual({ width, height });
  });
  expect(art.scale, label).toBeGreaterThanOrEqual(1);
}

describe('pixel helpers', () => {
  it('reports uneven rows and unknown colours', () => {
    expect(gridProblems(['ab', 'a'], { a: '#000', b: '#fff' })).toEqual(['row 1 is 1 wide, expected 2']);
    expect(gridProblems(['aZ'], { a: '#000' })).toEqual(['row 0 uses "Z", which has no colour']);
    expect(gridProblems(['a.'], { a: '#000' })).toEqual([]);
  });

  it('mirrors, replaces rows, and swaps letters', () => {
    expect(mirror(['ab.'])).toEqual(['ab..ba']);
    expect(replaceRows(['aa', 'bb', 'cc'], 1, ['xx'])).toEqual(['aa', 'xx', 'cc']);
    expect(replaceRows(['aa'], 0, ['xx', 'yy'])).toEqual(['xx']);
    expect(swapChars(['ab'], { a: 'b', b: 'a' })).toEqual(['ba']);
  });

  it('layers a top grid over a bottom grid, opaque pixels winning', () => {
    expect(layer(['bb', 'bb'], ['t.'], 0, 3)).toEqual(['t.', 'bb', 'bb']);
    expect(layer(['bb', 'bb'], ['t.'], 1, 3)).toEqual(['..', 'tb', 'bb']);
  });

  it('adds a one-pixel outline around every opaque pixel', () => {
    const result = rasterize(['a'], { a: '#fff' }, OUTLINE);
    expect(result.width).toBe(3);
    expect(result.height).toBe(3);
    const at = (x: number, y: number) => result.pixels.find(([px, py]) => px === x && py === y)?.[2];
    expect(at(1, 1)).toBe('#fff');
    expect([at(0, 1), at(2, 1), at(1, 0), at(1, 2)]).toEqual([OUTLINE, OUTLINE, OUTLINE, OUTLINE]);
    expect(at(0, 0)).toBeUndefined(); // corners stay clear, for a rounded look
  });
});

describe('characters', () => {
  it('has art for every class', () => {
    expect([...CHARACTER_CLASSES].sort()).toEqual([...classIds].sort());
  });

  for (const classId of CHARACTER_CLASSES) {
    it(`${classId}: well formed, 32 x 64 pixels, with idle, run, and jump frames`, () => {
      const art = characterArt(classId);
      expectWellFormed(art, classId);
      const { width, height } = gridSize(art.frames[0]!);
      // The player's physics body assumes a 32 x 64 sprite.
      expect((width + 2) * art.scale).toBe(32);
      expect((height + 2) * art.scale).toBe(64);
      const used = [...CHARACTER_FRAMES.idle, ...CHARACTER_FRAMES.run, ...CHARACTER_FRAMES.jump];
      expect(Math.max(...used)).toBe(art.frames.length - 1);
      // Idle frames differ (the bob), and run frames are not all the same.
      expect(art.frames[0]).not.toEqual(art.frames[1]);
      expect(new Set(CHARACTER_FRAMES.run.map((i) => art.frames[i]!.join('|'))).size).toBeGreaterThan(2);
    });
  }
});

describe('NPCs', () => {
  it('draws the wayfinder at character size with an animated second frame', () => {
    const art = NPC_ART.wayfinder!;
    expectWellFormed(art, 'wayfinder');
    expect(gridSize(art.frames[0]!)).toEqual({ width: 14, height: 30 });
    expect(art.frames[0]).not.toEqual(art.frames[1]);
  });
});

describe('weapons', () => {
  it('has art for every archetype in every element', () => {
    for (const archetype of ARCHETYPE_IDS) {
      for (const element of WEAPON_ELEMENTS) expectWellFormed(weaponArt(archetype, element), `${archetype} ${element}`);
    }
  });

  it('colours the glowing parts by element', () => {
    expect(weaponArt('beam', 'Ember').palette.b).not.toBe(weaponArt('beam', 'Tide').palette.b);
  });
});

describe('creatures', () => {
  it('has art for every family that appears as an enemy', () => {
    for (const kind of enemyKinds()) expect(CREATURE_FAMILIES, kind).toContain(kind);
  });

  it('has art for every boss', () => {
    for (const kind of bossKinds()) expect(BOSS_FAMILIES, kind).toContain(getBossStats(kind).family);
  });

  for (const familyId of CREATURE_FAMILIES) {
    it(`${familyId}: two distinct well-formed frames, plus a warning version`, () => {
      const element = getFamily(familyId).elements[0]!;
      const art = creatureArt(familyId, element)!;
      expectWellFormed(art, familyId);
      expect(art.frames).toHaveLength(2);
      expect(art.frames[0]).not.toEqual(art.frames[1]);
      const warn = creatureArt(familyId, element, true)!;
      expect(warn.frames).toEqual(art.frames);
      expect(warn.palette.b).not.toBe(art.palette.b);
      // Small enough to read as a 1-tile creature, as the art direction asks.
      const { width, height } = gridSize(art.frames[0]!);
      expect((width + 2) * art.scale).toBeLessThanOrEqual(40);
      expect((height + 2) * art.scale).toBeLessThanOrEqual(32);
    });
  }

  for (const familyId of BOSS_FAMILIES) {
    it(`boss ${familyId}: two distinct well-formed frames, at least 4 tiles wide`, () => {
      const element = getFamily(familyId).elements[0]!;
      const art = bossArt(familyId, element)!;
      expectWellFormed(art, familyId);
      expect(art.frames[0]).not.toEqual(art.frames[1]);
      expect((gridSize(art.frames[0]!).width + 2) * art.scale).toBeGreaterThanOrEqual(128);
    });
  }

  it('returns null for a family without art, so the game can fall back to a plain shape', () => {
    expect(creatureArt('tide-axolotl', 'Tide')).toBeNull();
    expect(bossArt('tide-axolotl', 'Tide')).toBeNull();
  });
});
