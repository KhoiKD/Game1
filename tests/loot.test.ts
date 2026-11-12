import { describe, expect, it } from 'vitest';
import {
  dropData,
  getPerk,
  lootRules,
  perkList,
  resolveWeaponInstance,
  rollDropFor,
  sanitizeInventory,
  starterInventory,
  validateDrops,
  validatePerks,
} from '../src/data/lootData';
import rawDrops from '../src/data/drops.json';
import rawPerks from '../src/data/perks.json';
import { enemyKinds, bossKinds, getBossStats, getEnemyStats } from '../src/data/enemyData';
import { ARCHETYPE_IDS, RARITIES, getWeapon, resolveWeapon, weaponData, type Rarity } from '../src/data/weaponData';
import {
  EQUIP_SLOTS,
  INVENTORY_CAPACITY,
  addItem,
  backpackItems,
  createInventory,
  discard,
  equip,
  equippedItems,
  isFull,
} from '../src/systems/inventory';
import {
  PERK_SLOTS,
  applyPerks,
  perkFitsArchetype,
  pickWeighted,
  rollDrop,
  rollPerks,
  rollWeapon,
  type WeaponInstance,
} from '../src/systems/loot';
import {
  activateCheckpoint,
  createRunState,
  die,
  secureAll,
  setInventory,
  unsecuredWeaponCount,
} from '../src/systems/runState';
import { createRng } from '../src/util/rng';

const weapon = (uid: string, baseId = 'pocket-sting'): WeaponInstance => ({
  uid,
  baseId,
  rarity: 'common',
  damageRoll: 1,
  perks: [],
});
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('perk data', () => {
  it('offers at least one perk in every slot for every archetype', () => {
    for (const archetype of ARCHETYPE_IDS) {
      for (const slot of PERK_SLOTS) {
        const pool = perkList.filter((p) => p.slot === slot && perkFitsArchetype(p, archetype));
        expect(pool.length, `${archetype} ${slot}`).toBeGreaterThan(0);
      }
    }
  });

  it('rejects bad perks', () => {
    const duplicate = clone(rawPerks);
    duplicate.perks.push(clone(duplicate.perks[0]!));
    expect(() => validatePerks(duplicate)).toThrow(/duplicate id/);

    const badStat = clone(rawPerks);
    badStat.perks[0]!.mods[0]!.stat = 'coolness';
    expect(() => validatePerks(badStat)).toThrow(/cannot modify/);

    const badArchetype = clone(rawPerks);
    badArchetype.perks[0]!.archetypes = ['railgun'];
    expect(() => validatePerks(badArchetype)).toThrow(/unknown archetype/);

    const zeroMultiplier = clone(rawPerks);
    zeroMultiplier.perks[0]!.mods[0]!.value = 0;
    expect(() => validatePerks(zeroMultiplier)).toThrow(/multiplier/);
  });
});

describe('drop data', () => {
  it('has a drop table for every enemy and boss', () => {
    for (const kind of enemyKinds()) expect(dropData.tables[getEnemyStats(kind).dropTable], kind).toBeDefined();
    for (const kind of bossKinds()) expect(dropData.tables[getBossStats(kind).dropTable], kind).toBeDefined();
    for (const rarity of RARITIES) expect(dropData.tables[rarity], rarity).toBeDefined();
  });

  it('gives rarer weapons at least as many perk slots and higher damage rolls', () => {
    for (let i = 1; i < RARITIES.length; i++) {
      const lower = dropData.rarities[RARITIES[i - 1]!];
      const higher = dropData.rarities[RARITIES[i]!];
      expect(higher.perkSlots.length).toBeGreaterThanOrEqual(lower.perkSlots.length);
      expect(higher.damageRoll[0]).toBeGreaterThan(lower.damageRoll[0]);
      expect(higher.damageRoll[1]).toBeGreaterThan(lower.damageRoll[1]);
    }
    expect(dropData.rarities.common.perkSlots.length).toBeGreaterThanOrEqual(2);
    expect(dropData.rarities.legendary.perkSlots.length).toBeLessThanOrEqual(4);
  });

  it('rejects bad drop tables', () => {
    const badChance = clone(rawDrops);
    badChance.tables.common.dropChance = 1.5;
    expect(() => validateDrops(badChance)).toThrow(/dropChance/);

    const noWeights = clone(rawDrops) as { tables: Record<string, { rarityWeights: Record<string, number> }> };
    noWeights.tables.common!.rarityWeights = {};
    expect(() => validateDrops(noWeights)).toThrow(/rarity weight/);

    const badRoll = clone(rawDrops);
    badRoll.rarities.rare.damageRoll = [1.3, 1.1];
    expect(() => validateDrops(badRoll)).toThrow(/damageRoll/);
  });
});

describe('applyPerks', () => {
  const base = getWeapon('scattermaw');

  it('applies multipliers and additions', () => {
    const result = applyPerks(base, [getPerk('heavy-slugs'), getPerk('steady-brace')]);
    expect(result.damage).toBeCloseTo(base.damage * 1.1);
    expect(result.stability).toBe(base.stability + 15);
  });

  it('keeps whole-number stats whole and at least 1', () => {
    const result = applyPerks(base, [getPerk('heavy-slugs')]);
    expect(Number.isInteger(result.magazine)).toBe(true);
    expect(result.magazine).toBe(Math.round(base.magazine * 0.85));
    const tiny = applyPerks({ ...base, magazine: 1 }, [getPerk('heavy-slugs')]);
    expect(tiny.magazine).toBe(1);
  });

  it('caps stability and handling at 100 and never goes below 0', () => {
    const capped = applyPerks({ ...base, stability: 95, handling: 2 }, [getPerk('steady-brace'), getPerk('long-bore')]);
    expect(capped.stability).toBe(100);
    expect(capped.handling).toBe(0);
  });

  it('does not change the weapon it was given', () => {
    const before = clone(base);
    applyPerks(base, [getPerk('overbore')]);
    expect(base).toEqual(before);
  });

  it('leaves untouched stats exactly as they were', () => {
    const result = applyPerks(base, [getPerk('swift-feed')]);
    expect(result.damage).toBe(base.damage);
    expect(result.magazine).toBe(base.magazine);
  });
});

describe('rolling', () => {
  it('pickWeighted respects the weights and never picks a zero weight', () => {
    const rng = createRng(11);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 6000; i++) counts[pickWeighted({ a: 3, b: 1, c: 0 }, rng)]! += 1;
    expect(counts.c).toBe(0);
    expect(counts.a! / counts.b!).toBeGreaterThan(2.6);
    expect(counts.a! / counts.b!).toBeLessThan(3.4);
    expect(() => pickWeighted({}, rng)).toThrow();
  });

  it('rolls one fitting perk per slot the rarity grants', () => {
    const rng = createRng(3);
    for (const archetype of ARCHETYPE_IDS) {
      for (const rarity of RARITIES) {
        for (let i = 0; i < 20; i++) {
          const perks = rollPerks(archetype, rarity, lootRules, rng).map(getPerk);
          expect(perks.map((p) => p.slot)).toEqual(dropData.rarities[rarity].perkSlots);
          for (const perk of perks) expect(perkFitsArchetype(perk, archetype), `${perk.id} on ${archetype}`).toBe(true);
        }
      }
    }
  });

  it('is repeatable for a seed', () => {
    const roll = (seed: number) => rollWeapon('epic', lootRules, createRng(seed));
    expect(roll(99)).toEqual(roll(99));
    expect(roll(99)).not.toEqual(roll(100));
  });

  it('rolls damage inside the rarity range and treats a base rarity as a floor', () => {
    const rng = createRng(5);
    for (let i = 0; i < 400; i++) {
      const drop = rollWeapon('common', lootRules, rng);
      const base = weaponData.weapons.find((w) => w.id === drop.baseId)!;
      expect(RARITIES.indexOf(drop.rarity)).toBeGreaterThanOrEqual(RARITIES.indexOf(base.rarity));
      const [low, high] = dropData.rarities[drop.rarity].damageRoll;
      expect(drop.damageRoll).toBeGreaterThanOrEqual(low);
      expect(drop.damageRoll).toBeLessThanOrEqual(high);
    }
  });

  it('honours the drop chance', () => {
    const rng = createRng(21);
    const weights = { common: 1 };
    expect(rollDrop({ dropChance: 0, rarityWeights: weights }, lootRules, rng)).toBeNull();
    expect(rollDrop({ dropChance: 1, rarityWeights: weights }, lootRules, rng)).not.toBeNull();
    let drops = 0;
    for (let i = 0; i < 4000; i++) if (rollDropFor('common', rng)) drops += 1;
    const rate = drops / 4000;
    expect(rate).toBeGreaterThan(dropData.tables.common!.dropChance - 0.04);
    expect(rate).toBeLessThan(dropData.tables.common!.dropChance + 0.04);
  });

  it('drops only rare or better from the boss, and nothing from an unknown source', () => {
    const rng = createRng(8);
    for (let i = 0; i < 300; i++) {
      const drop = rollDropFor('boss', rng);
      expect(drop).not.toBeNull();
      expect(RARITIES.indexOf(drop!.rarity)).toBeGreaterThanOrEqual(RARITIES.indexOf('rare'));
    }
    expect(rollDropFor('nobody', rng)).toBeNull();
  });

  it('matches the rarity weights over many rolls', () => {
    const rng = createRng(77);
    const table = { dropChance: 1, rarityWeights: { common: 60, legendary: 40 } as Partial<Record<Rarity, number>> };
    // Only weapons with a common floor, so the rolled rarity is the final one.
    const rules = { ...lootRules, weapons: weaponData.weapons.filter((w) => w.rarity === 'common') };
    let legendary = 0;
    for (let i = 0; i < 5000; i++) if (rollDrop(table, rules, rng)!.rarity === 'legendary') legendary += 1;
    expect(legendary / 5000).toBeGreaterThan(0.36);
    expect(legendary / 5000).toBeLessThan(0.44);
  });
});

describe('resolved instances', () => {
  it('a starter weapon plays exactly like its base weapon', () => {
    for (const item of starterInventory().items) {
      expect(resolveWeaponInstance(item)).toEqual(getWeapon(item.baseId));
    }
  });

  it('applies the damage roll and perks on top of the base weapon', () => {
    const base = getWeapon('pocket-sting');
    const resolved = resolveWeaponInstance({
      uid: 'x', baseId: 'pocket-sting', rarity: 'legendary', damageRoll: 1.3, perks: ['overbore', 'steady-brace'],
    });
    expect(resolved.damage).toBeCloseTo(base.damage * 1.3 * 1.2);
    expect(resolved.stability).toBe(100);
    expect(resolved.rarity).toBe('legendary');
    expect(resolved.name).toBe(base.name);
  });

  it('every weapon stays valid under every perk it can roll, alone and all together', () => {
    for (const def of weaponData.weapons) {
      const fitting = perkList.filter((p) => perkFitsArchetype(p, def.archetype));
      const check = (perks: string[]) => {
        const resolved = resolveWeaponInstance({ uid: 'x', baseId: def.id, rarity: 'legendary', damageRoll: 1.42, perks });
        // resolveWeapon re-validates when given the resolved stats as overrides.
        expect(() => resolveWeapon({ ...def, stats: resolved }, weaponData.archetypes), `${def.id} + ${perks.join(',')}`).not.toThrow();
      };
      for (const perk of fitting) check([perk.id]);
      check(fitting.map((p) => p.id));
    }
  });

  it('throws for an unknown base weapon or perk', () => {
    expect(() => resolveWeaponInstance(weapon('x', 'nope'))).toThrow(/Unknown base weapon/);
    expect(() => resolveWeaponInstance({ ...weapon('x'), perks: ['nope'] })).toThrow(/Unknown perk/);
  });
});

describe('inventory', () => {
  it('starts with the first weapons equipped', () => {
    const inv = createInventory([weapon('a'), weapon('b')]);
    expect(inv.equipped).toEqual(['a', 'b', null]);
    expect(inv.equipped).toHaveLength(EQUIP_SLOTS);
    expect(backpackItems(inv)).toEqual([]);
  });

  it('puts a new weapon in an empty slot, otherwise in the backpack', () => {
    let inv = createInventory([weapon('a'), weapon('b')]);
    inv = addItem(inv, weapon('c'))!;
    expect(inv.equipped).toEqual(['a', 'b', 'c']);
    inv = addItem(inv, weapon('d'))!;
    expect(inv.equipped).toEqual(['a', 'b', 'c']);
    expect(backpackItems(inv).map((i) => i.uid)).toEqual(['d']);
  });

  it('refuses a duplicate uid and anything past capacity', () => {
    let inv = createInventory([weapon('a')]);
    expect(addItem(inv, weapon('a'))).toBeNull();
    for (let i = 1; i < INVENTORY_CAPACITY; i++) inv = addItem(inv, weapon(`w${i}`))!;
    expect(isFull(inv)).toBe(true);
    expect(addItem(inv, weapon('one-too-many'))).toBeNull();
  });

  it('equips from the backpack and swaps two equipped slots', () => {
    let inv = createInventory([weapon('a'), weapon('b'), weapon('c'), weapon('d')]);
    inv = equip(inv, 'd', 0);
    expect(inv.equipped).toEqual(['d', 'b', 'c']);
    expect(backpackItems(inv).map((i) => i.uid)).toEqual(['a']);
    inv = equip(inv, 'c', 0);
    expect(inv.equipped).toEqual(['c', 'b', 'd']);
    expect(equippedItems(inv).map((i) => i.uid)).toEqual(['c', 'b', 'd']);
  });

  it('ignores an equip that changes nothing or is invalid', () => {
    const inv = createInventory([weapon('a'), weapon('b')]);
    expect(equip(inv, 'a', 0)).toBe(inv);
    expect(equip(inv, 'missing', 0)).toBe(inv);
    expect(equip(inv, 'a', 7)).toBe(inv);
  });

  it('discards backpack weapons but never equipped ones', () => {
    const inv = createInventory([weapon('a'), weapon('b'), weapon('c'), weapon('d')]);
    expect(discard(inv, 'a')).toBe(inv);
    expect(discard(inv, 'missing')).toBe(inv);
    expect(discard(inv, 'd').items.map((i) => i.uid)).toEqual(['a', 'b', 'c']);
  });
});

describe('inventory and the checkpoint rule', () => {
  const start = createInventory([weapon('a'), weapon('b')]);

  it('loses weapons picked up since the last checkpoint on death', () => {
    let run = activateCheckpoint(createRunState(start), 'cp-1', 1);
    run = setInventory(run, addItem(run.inventory, weapon('found'))!);
    expect(unsecuredWeaponCount(run)).toBe(1);
    run = die(run);
    expect(run.inventory.items.map((i) => i.uid)).toEqual(['a', 'b']);
    expect(unsecuredWeaponCount(run)).toBe(0);
  });

  it('keeps weapons banked at a checkpoint', () => {
    let run = setInventory(createRunState(start), addItem(start, weapon('found'))!);
    run = activateCheckpoint(run, 'cp-1', 1);
    expect(unsecuredWeaponCount(run)).toBe(0);
    expect(die(run).inventory.items.map((i) => i.uid)).toEqual(['a', 'b', 'found']);
  });

  it('restores a discarded weapon and the old loadout on death', () => {
    const four = createInventory([weapon('a'), weapon('b'), weapon('c'), weapon('d')]);
    let run = activateCheckpoint(createRunState(four), 'cp-1', 1);
    run = setInventory(run, equip(discard(run.inventory, 'd'), 'c', 0));
    run = die(run);
    expect(run.inventory).toBe(four);
  });

  it('banks the inventory on stage clear and when re-touching the current checkpoint', () => {
    let run = activateCheckpoint(createRunState(start), 'cp-1', 1);
    run = setInventory(run, addItem(run.inventory, weapon('x'))!);
    expect(secureAll(run).securedInventory).toBe(run.inventory);
    expect(activateCheckpoint(run, 'cp-1', 1).securedInventory).toBe(run.inventory);
  });
});

describe('sanitizeInventory', () => {
  it('returns a valid inventory unchanged', () => {
    const inv = starterInventory();
    expect(sanitizeInventory(inv)).toBe(inv);
  });

  it('removes weapons whose base weapon or perks no longer exist', () => {
    const inv = createInventory([weapon('ok'), weapon('gone', 'deleted-weapon'), { ...weapon('badperk'), perks: ['deleted-perk'] }]);
    const cleaned = sanitizeInventory(inv);
    expect(cleaned.items.map((i) => i.uid)).toEqual(['ok']);
    expect(cleaned.equipped).toEqual(['ok', null, null]);
  });

  it('falls back to the starter weapons when nothing usable is left', () => {
    const cleaned = sanitizeInventory(createInventory([weapon('gone', 'deleted-weapon')]));
    expect(cleaned.items.map((i) => i.baseId)).toEqual(weaponData.starterLoadout);
  });
});
