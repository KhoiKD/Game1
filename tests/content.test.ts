import { describe, expect, it } from 'vitest';
import level1 from '../public/assets/levels/level1.json';
import level2 from '../public/assets/levels/level2.json';
import level3 from '../public/assets/levels/level3.json';
import { getFamily, loreFor } from '../src/data/creatureData';
import { ELEMENTS } from '../src/data/elementData';
import { BEHAVIORS, behaviorOf, bossKinds, enemyKinds, getBossStats, getEnemyStats, parseKind } from '../src/data/enemyData';
import { progression } from '../src/data/progressionData';
import { ARCHETYPE_IDS, weaponData } from '../src/data/weaponData';
import { parseLevelObjects, type RawObject } from '../src/level/parseLevelObjects';

/** The content milestone: three stages, six enemy types, three bosses, 20 weapons, 12 families. */
interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  layers: Array<{ name: string; data?: number[]; objects?: RawObject[] }>;
}
const LEVELS: Record<string, unknown> = { level1, level2, level3 };
const loadLevel = (map: string): TiledMap => {
  const level = LEVELS[map];
  if (!level) throw new Error(`No level file imported for map "${map}"; add it to tests/content.test.ts`);
  return level as TiledMap;
};

describe('weapons', () => {
  it('has at least 20, with unique names', () => {
    expect(weaponData.weapons.length).toBeGreaterThanOrEqual(20);
    expect(new Set(weaponData.weapons.map((w) => w.name)).size).toBe(weaponData.weapons.length);
  });

  it('covers every archetype at least twice and every element', () => {
    for (const archetype of ARCHETYPE_IDS) {
      expect(weaponData.weapons.filter((w) => w.archetype === archetype).length, archetype).toBeGreaterThanOrEqual(2);
    }
    for (const element of ['kinetic', ...ELEMENTS]) {
      expect(weaponData.weapons.some((w) => w.element === element), element).toBe(true);
    }
  });
});

describe('enemies', () => {
  it('uses all six behaviors', () => {
    expect(BEHAVIORS).toHaveLength(6);
    const used = new Set(enemyKinds().map((kind) => behaviorOf(kind)));
    for (const behavior of BEHAVIORS) expect(used.has(behavior), behavior).toBe(true);
  });

  it('implements 12 families, two per element, each reachable at all three stages', () => {
    expect(enemyKinds()).toHaveLength(12);
    for (const element of ELEMENTS) {
      expect(enemyKinds().filter((kind) => getFamily(kind).elements[0] === element), element).toHaveLength(2);
    }
    const creatures = new Set<string>();
    for (const kind of enemyKinds()) {
      for (const bonus of [0, 1, 2]) {
        const ref = getEnemyStats(kind, bonus).creature;
        creatures.add(getFamily(ref.family).stages[ref.stage - 1]!);
      }
    }
    expect(creatures.size).toBe(36);
  });

  it('has a lore line for each of the 36 creatures', () => {
    for (const kind of enemyKinds()) {
      for (const name of getFamily(kind).stages) {
        const lore = loreFor(name);
        expect(lore, name).toBeTruthy();
        expect(lore!.length, name).toBeLessThanOrEqual(120);
      }
    }
    expect(loreFor('Nobody')).toBeNull();
  });
});

describe('bosses', () => {
  it('has three, from different families and elements, each among the implemented families', () => {
    const bosses = bossKinds().map((kind) => getBossStats(kind));
    expect(bosses).toHaveLength(3);
    expect(new Set(bosses.map((b) => b.family)).size).toBe(3);
    expect(new Set(bosses.map((b) => b.element)).size).toBe(3);
    for (const boss of bosses) {
      expect(enemyKinds(), boss.name).toContain(boss.family);
      expect(boss.name, boss.family).toBe(getFamily(boss.family).stages[2]);
    }
  });

  it('uses every attack pattern across the bosses', () => {
    const patterns = new Set(bossKinds().flatMap((kind) => getBossStats(kind).phases.map((p) => p.pattern)));
    expect([...patterns].sort()).toEqual(['aimed', 'rain', 'ring']);
  });

  it('gets tougher from stage to stage', () => {
    const hp = progression.stages.map((stage) => {
      const objects = loadLevel(stage.map).layers.find((l) => l.name === 'objects')!.objects!;
      const boss = parseLevelObjects(objects).enemies.find((e) => e.boss)!;
      return getBossStats(boss.kind).hp;
    });
    expect([...hp].sort((a, b) => a - b)).toEqual(hp);
    expect(new Set(hp).size).toBe(hp.length);
  });
});

describe('stages', () => {
  it('has three, unlocked in order', () => {
    expect(progression.stages).toHaveLength(3);
    expect(progression.stages[0]!.requires).toBeNull();
    expect(progression.stages[1]!.requires).toBe(progression.stages[0]!.id);
    expect(progression.stages[2]!.requires).toBe(progression.stages[1]!.id);
  });

  for (const stage of progression.stages) {
    describe(`${stage.name} (${stage.map})`, () => {
      const map = loadLevel(stage.map);
      const tiles = map.layers.find((l) => l.name === 'ground')!.data!;
      const level = parseLevelObjects(map.layers.find((l) => l.name === 'objects')!.objects!);
      const solid = (x: number, y: number): boolean => {
        const col = Math.floor(x / map.tilewidth);
        const row = Math.floor(y / map.tilewidth);
        return row >= 0 && row < map.height && col >= 0 && col < map.width && tiles[row * map.width + col] !== 0;
      };

      it('has a spawn on solid ground, four checkpoints in order, and pickups', () => {
        expect(solid(level.spawn.x, level.spawn.y)).toBe(true);
        expect(level.checkpoints.map((c) => c.order)).toEqual([1, 2, 3, 4]);
        const xs = level.checkpoints.map((c) => c.rect.x);
        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
        for (const cp of level.checkpoints) expect(solid(cp.rect.x, cp.rect.y + cp.rect.height), cp.id).toBe(true);
        expect(level.pickups.length).toBeGreaterThan(10);
      });

      it('places only known enemies, standing on ground unless they fly', () => {
        const enemies = level.enemies.filter((e) => !e.boss);
        expect(enemies.length).toBeGreaterThanOrEqual(10);
        for (const enemy of enemies) {
          const stats = getEnemyStats(enemy.kind);
          expect(enemyKinds(), enemy.id).toContain(parseKind(enemy.kind).family);
          if (stats.behavior === 'flyer') expect(solid(enemy.x, enemy.y - 1), `${enemy.id} hovers in open air`).toBe(false);
          else expect(solid(enemy.x, enemy.y), `${enemy.id} (${enemy.kind}) stands on ground`).toBe(true);
        }
      });

      it('mixes at least three enemy behaviors', () => {
        const behaviors = new Set(level.enemies.filter((e) => !e.boss).map((e) => getEnemyStats(e.kind).behavior));
        expect(behaviors.size).toBeGreaterThanOrEqual(3);
      });

      it('ends with exactly one boss after the last checkpoint, in an arena with solid floor', () => {
        const bosses = level.enemies.filter((e) => e.boss);
        expect(bosses).toHaveLength(1);
        const boss = bosses[0]!;
        expect(bossKinds()).toContain(boss.kind);
        const lastCheckpoint = level.checkpoints[level.checkpoints.length - 1]!;
        expect(boss.x - lastCheckpoint.rect.x).toBeGreaterThan(500);
        for (let x = boss.x - 320; x <= boss.x + 320; x += map.tilewidth) expect(solid(x, boss.y), `floor at ${x}`).toBe(true);
      });

      it('gives every object a unique id', () => {
        const ids = [...level.checkpoints.map((c) => c.id), ...level.pickups.map((p) => p.id), ...level.enemies.map((e) => e.id)];
        expect(new Set(ids).size).toBe(ids.length);
      });
    });
  }

  it('shows every implemented family in at least one stage', () => {
    const seen = new Set<string>();
    for (const stage of progression.stages) {
      const objects = loadLevel(stage.map).layers.find((l) => l.name === 'objects')!.objects!;
      for (const enemy of parseLevelObjects(objects).enemies) {
        seen.add(enemy.boss ? getBossStats(enemy.kind).family : parseKind(enemy.kind).family);
      }
    }
    for (const kind of enemyKinds()) expect(seen.has(kind), kind).toBe(true);
  });
});
