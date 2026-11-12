import { describe, expect, it } from 'vitest';
import rawClasses from '../src/data/classes.json';
import { bossKinds, enemyKinds, getBossStats, getEnemyStats } from '../src/data/enemyData';
import rawProgression from '../src/data/progression.json';
import { classDefs, classIds, findClass, getStage, progression, validateClasses, validateProgression } from '../src/data/progressionData';
import { ARCHETYPE_IDS, getWeapon } from '../src/data/weaponData';
import { createInventory } from '../src/systems/inventory';
import type { WeaponInstance } from '../src/systems/loot';
import {
  levelForXp,
  levelProgress,
  powerScore,
  tierRule,
  tierStatus,
  withClassAndLevel,
  xpForLevel,
} from '../src/systems/progression';
import { NO_BONUSES, applyBonuses } from '../src/systems/spirits';

const rules = progression;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const weapon = (uid: string, rarity: WeaponInstance['rarity']): WeaponInstance => ({ uid, baseId: 'pocket-sting', rarity, damageRoll: 1, perks: [] });

describe('levels', () => {
  it('starts at level 1 and needs base x level experience for each next level', () => {
    expect(levelForXp(0, rules)).toBe(1);
    expect(xpForLevel(1, rules)).toBe(0);
    expect(xpForLevel(2, rules)).toBe(rules.xp.base);
    expect(xpForLevel(3, rules) - xpForLevel(2, rules)).toBe(rules.xp.base * 2);
    expect(levelForXp(rules.xp.base - 1, rules)).toBe(1);
    expect(levelForXp(rules.xp.base, rules)).toBe(2);
  });

  it('never goes past the maximum level', () => {
    expect(levelForXp(1e12, rules)).toBe(rules.xp.maxLevel);
    expect(levelProgress(1e12, rules)).toEqual({ level: rules.xp.maxLevel, into: 0, needed: 0 });
  });

  it('reports progress through the current level', () => {
    const xp = xpForLevel(3, rules) + 7;
    expect(levelProgress(xp, rules)).toEqual({ level: 3, into: 7, needed: rules.xp.base * 3 });
  });

  it('is consistent between levelForXp and xpForLevel at every level', () => {
    for (let level = 1; level <= rules.xp.maxLevel; level++) {
      expect(levelForXp(xpForLevel(level, rules), rules)).toBe(level);
      if (level > 1) expect(levelForXp(xpForLevel(level, rules) - 1, rules)).toBe(level - 1);
    }
  });
});

describe('power and tiers', () => {
  it('averages weapon power over the three slots and adds the level', () => {
    const two = createInventory([weapon('a', 'common'), weapon('b', 'common')]);
    expect(powerScore(two, 1, rules)).toBe(Math.round((2 * rules.weaponPower.common) / 3) + 1);
    const three = createInventory([weapon('a', 'legendary'), weapon('b', 'legendary'), weapon('c', 'legendary')]);
    expect(powerScore(three, 5, rules)).toBe(rules.weaponPower.legendary + 5);
    expect(powerScore(createInventory(), 1, rules)).toBe(1);
  });

  it('counts only equipped weapons', () => {
    const withBackpack = createInventory([weapon('a', 'common'), weapon('b', 'common'), weapon('c', 'common'), weapon('d', 'legendary')]);
    const without = createInventory([weapon('a', 'common'), weapon('b', 'common'), weapon('c', 'common')]);
    expect(powerScore(withBackpack, 1, rules)).toBe(powerScore(without, 1, rules));
  });

  it('opens tier 1 for a new player', () => {
    const starter = createInventory([weapon('a', 'common'), weapon('b', 'common')]);
    expect(tierStatus(1, powerScore(starter, 1, rules), 0, rules)).toBe('open');
  });

  it('needs the tier below cleared, then enough Power', () => {
    const need = tierRule(2, rules).requiredPower;
    expect(tierStatus(2, 999, 0, rules)).toBe('needs-clear');
    expect(tierStatus(2, need - 1, 1, rules)).toBe('needs-power');
    expect(tierStatus(2, need, 1, rules)).toBe('open');
    expect(tierStatus(3, 999, 1, rules)).toBe('needs-clear');
  });

  it('keeps tier 2 out of reach of the starting loadout but within reach of normal play', () => {
    const starter = createInventory([weapon('a', 'common'), weapon('b', 'common')]);
    expect(powerScore(starter, 1, rules)).toBeLessThan(tierRule(2, rules).requiredPower);
    const afterOneRun = createInventory([weapon('a', 'common'), weapon('b', 'uncommon'), weapon('c', 'uncommon')]);
    expect(powerScore(afterOneRun, 4, rules)).toBeGreaterThanOrEqual(tierRule(2, rules).requiredPower);
  });

  it('throws for an unknown tier or stage', () => {
    expect(() => tierRule(99, rules)).toThrow();
    expect(() => getStage('nowhere')).toThrow();
  });
});

describe('class and level bonuses', () => {
  it('adds level damage and health on top of spirit bonuses', () => {
    const b = withClassAndLevel(NO_BONUSES, null, 6, rules);
    expect(b.damageMult).toBeCloseTo(1 + 5 * rules.perLevel.damage);
    expect(b.maxHpBonus).toBe(Math.floor(6 / rules.perLevel.hpEvery));
    expect(withClassAndLevel(NO_BONUSES, null, 1, rules)).toEqual(NO_BONUSES);
  });

  it('applies each class passive', () => {
    const vanguard = withClassAndLevel(NO_BONUSES, classDefs.vanguard!, 1, rules);
    expect(vanguard.maxHpBonus).toBe(classDefs.vanguard!.passive.maxHp);
    const skirmisher = withClassAndLevel(NO_BONUSES, classDefs.skirmisher!, 1, rules);
    expect(skirmisher.moveSpeedMult).toBeCloseTo(classDefs.skirmisher!.passive.moveSpeedMult);
    expect(skirmisher.reloadMult).toBeCloseTo(classDefs.skirmisher!.passive.reloadMult);
    const warden = withClassAndLevel(NO_BONUSES, classDefs.warden!, 1, rules);
    expect(warden.statusBuildupMult).toBeCloseTo(classDefs.warden!.passive.statusBuildupMult);
    expect(warden.cooldownMult).toBeCloseTo(classDefs.warden!.passive.spiritCooldownMult);
  });

  it('boosts only the weapon archetypes the class favours', () => {
    const b = withClassAndLevel(NO_BONUSES, classDefs.vanguard!, 1, rules);
    const favoured = getWeapon('scattermaw');
    const other = getWeapon('pocket-sting');
    expect(applyBonuses(favoured, b).damage).toBeCloseTo(favoured.damage * (1 + classDefs.vanguard!.affinity.damage));
    expect(applyBonuses(other, b).damage).toBeCloseTo(other.damage);
  });

  it('applies the status build-up bonus to weapons', () => {
    const b = withClassAndLevel(NO_BONUSES, classDefs.warden!, 1, rules);
    expect(applyBonuses(getWeapon('volt-lance'), b).statusBuildup).toBeCloseTo(classDefs.warden!.passive.statusBuildupMult);
  });

  it('stacks with existing spirit bonuses instead of replacing them', () => {
    const spirit = { ...NO_BONUSES, damageMult: 1.1, maxHpBonus: 1, moveSpeedMult: 1.05 };
    const b = withClassAndLevel(spirit, classDefs.skirmisher!, 3, rules);
    expect(b.damageMult).toBeCloseTo(1.1 * (1 + 2 * rules.perLevel.damage));
    expect(b.moveSpeedMult).toBeCloseTo(1.05 * classDefs.skirmisher!.passive.moveSpeedMult);
    expect(b.maxHpBonus).toBe(1);
  });
});

describe('class and progression data', () => {
  it('defines the three classes, each with a different ability effect', () => {
    expect(classIds.sort()).toEqual(['skirmisher', 'vanguard', 'warden']);
    expect(new Set(classIds.map((id) => classDefs[id]!.ability.effect)).size).toBe(3);
    expect(findClass('vanguard')!.name).toBe('Vanguard');
    expect(findClass('nobody')).toBeNull();
    expect(findClass(null)).toBeNull();
  });

  it('gives every weapon archetype to exactly one class', () => {
    for (const archetype of ARCHETYPE_IDS) {
      const owners = classIds.filter((id) => classDefs[id]!.affinity.archetypes.includes(archetype));
      expect(owners, archetype).toHaveLength(1);
    }
  });

  it('awards experience for every enemy and boss', () => {
    for (const kind of enemyKinds()) expect(getEnemyStats(kind).xp, kind).toBeGreaterThan(0);
    for (const kind of bossKinds()) expect(getBossStats(kind).xp, kind).toBeGreaterThan(getEnemyStats('walker').xp);
  });

  it('rejects bad progression data', () => {
    const easierTier = clone(rawProgression);
    easierTier.tiers[1]!.enemyHpMult = 0.5;
    expect(() => validateProgression(easierTier)).toThrow(/must not be easier/);

    const gatedStart = clone(rawProgression);
    gatedStart.tiers[0]!.requiredPower = 3;
    expect(() => validateProgression(gatedStart)).toThrow(/tier 1 must need no Power/);

    const misnumbered = clone(rawProgression);
    misnumbered.tiers[1]!.tier = 5;
    expect(() => validateProgression(misnumbered)).toThrow(/numbered/);

    const fallingPower = clone(rawProgression);
    fallingPower.weaponPower.rare = 1;
    expect(() => validateProgression(fallingPower)).toThrow(/rise with rarity/);
  });

  it('rejects bad class data', () => {
    const badArchetype = clone(rawClasses);
    badArchetype.classes.vanguard.affinity.archetypes = ['railgun'];
    expect(() => validateClasses(badArchetype)).toThrow(/unknown archetype/);

    const badEffect = clone(rawClasses);
    badEffect.classes.warden.ability.effect = 'teleport';
    expect(() => validateClasses(badEffect)).toThrow(/bad ability/);

    const dashWithoutSpeed = clone(rawClasses) as { classes: Record<string, { ability: Record<string, unknown> }> };
    delete dashWithoutSpeed.classes.skirmisher!.ability.speed;
    expect(() => validateClasses(dashWithoutSpeed)).toThrow(/dash needs/);
  });
});
