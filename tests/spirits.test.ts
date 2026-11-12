import { describe, expect, it } from 'vitest';
import rawBalance from '../src/data/balance.json';
import { balance, creatureFamilies, findFamily, getFamily, validateBalance } from '../src/data/creatureData';
import { ELEMENTS } from '../src/data/elementData';
import { bossKinds, enemyKinds, getBossStats, getEnemyStats } from '../src/data/enemyData';
import { RARITIES, getWeapon } from '../src/data/weaponData';
import { createInventory } from '../src/systems/inventory';
import {
  activateCheckpoint,
  createRunState,
  die,
  secureAll,
  setSpirits,
  unsecuredSpiritCount,
} from '../src/systems/runState';
import { SAVE_VERSION, parseSave, restoreRun, serializeRun } from '../src/systems/save';
import { SPIRIT_STATS, computeSpiritStats, statBudget, targetBudget, type Stage } from '../src/systems/spiritStats';
import {
  activeAbility,
  addKillXp,
  applyBonuses,
  bossPerkMult,
  captureGrowth,
  captureSpirit,
  emptyCollection,
  equipSpirit,
  equippedSpirits,
  levelOf,
  nextAttunement,
  playerBonuses,
  sanitizeCollection,
  slotList,
  slotOf,
  spiritName,
  spiritStats,
  stageOf,
  unequipSlot,
  type SpiritCollection,
} from '../src/systems/spirits';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const STAGES: Stage[] = [1, 2, 3];
const twig = getFamily('verdant-stickinsect'); // common, Verdant/Gale, Evader
const flytrap = getFamily('volt-flytrap'); // uncommon, Volt/Verdant, Trap
const komodo = getFamily('ember-komodo'); // rare, Ember, Tank
const whale = getFamily('tide-bluewhale'); // legendary, Tide
const capture = (c: SpiritCollection, family = twig, stage: Stage = 1, perkMult = 1) =>
  captureSpirit(c, family, stage, perkMult, balance).collection;
const captureTimes = (c: SpiritCollection, family: typeof twig, times: number) => {
  for (let i = 0; i < times; i++) c = capture(c, family);
  return c;
};

describe('creature roster', () => {
  it('has 50 families and 150 uniquely named creatures', () => {
    expect(creatureFamilies).toHaveLength(50);
    expect(new Set(creatureFamilies.flatMap((f) => f.stages)).size).toBe(150);
  });

  it('gives every role a stat shape and an ability', () => {
    for (const family of creatureFamilies) {
      expect(balance.roleBase[family.role], family.id).toBeDefined();
      expect(balance.abilities.byRole[family.role], family.id).toBeDefined();
    }
  });
});

describe('balance data', () => {
  it('rejects unbalanced or incomplete data', () => {
    const unevenRole = clone(rawBalance);
    unevenRole.roleBase.Tank.vitality = 80;
    expect(() => validateBalance(unevenRole)).toThrow(/same total stat budget/);

    const unevenTilt = clone(rawBalance);
    unevenTilt.elementTilt.Ember.power = 1.6;
    expect(() => validateBalance(unevenTilt)).toThrow(/same total/);

    const noAbility = clone(rawBalance) as { abilities: { byRole: Record<string, string> } };
    delete noAbility.abilities.byRole.Tank;
    expect(() => validateBalance(noAbility)).toThrow(/needs an ability/);

    const badThresholds = clone(rawBalance);
    badThresholds.slots.attunementThresholds = [5, 5, 30];
    expect(() => validateBalance(badThresholds)).toThrow(/ascend/);
  });
});

describe('stat formula', () => {
  it('multiplies role base by rarity, stage, and element tilt', () => {
    const stats = computeSpiritStats({ role: 'Tank', rarity: 'rare', stage: 3, elements: ['Ember'] }, balance);
    const size = balance.rarityMult.rare * balance.stageMult[2];
    for (const stat of SPIRIT_STATS) {
      expect(stats[stat]).toBeCloseTo(balance.roleBase.Tank![stat] * size * balance.elementTilt.Ember[stat]);
    }
  });

  it('averages the tilts of a dual-element creature', () => {
    const dual = computeSpiritStats({ role: 'Evader', rarity: 'common', stage: 1, elements: ['Verdant', 'Gale'] }, balance);
    const expected = balance.roleBase.Evader!.agility * (balance.elementTilt.Verdant.agility + balance.elementTilt.Gale.agility) / 2;
    expect(dual.agility).toBeCloseTo(expected);
  });

  it('grows with rarity and with stage', () => {
    const budget = (rarity: (typeof RARITIES)[number], stage: Stage) =>
      statBudget(computeSpiritStats({ role: 'Striker', rarity, stage, elements: ['Volt'] }, balance));
    for (let i = 1; i < RARITIES.length; i++) expect(budget(RARITIES[i]!, 1)).toBeGreaterThan(budget(RARITIES[i - 1]!, 1));
    expect(budget('common', 2)).toBeGreaterThan(budget('common', 1));
    expect(budget('common', 3)).toBeGreaterThan(budget('common', 2));
  });

  it('throws for an unknown role', () => {
    expect(() => computeSpiritStats({ role: 'Wizard', rarity: 'common', stage: 1, elements: ['Ember'] }, balance)).toThrow();
  });
});

describe('balance simulation over all 150 creatures', () => {
  const BAND = 0.1; // each creature within 10% of its rarity-and-stage target
  const GROUP_BAND = 0.06; // no element or role averages more than 6% off the mean
  const ratios: Array<{ name: string; role: string; elements: readonly string[]; ratio: number }> = [];
  for (const family of creatureFamilies) {
    for (const stage of STAGES) {
      const stats = computeSpiritStats({ role: family.role, rarity: family.rarity, stage, elements: family.elements }, balance);
      ratios.push({
        name: family.stages[stage - 1]!,
        role: family.role,
        elements: family.elements,
        ratio: statBudget(stats) / targetBudget(family.role, family.rarity, stage, balance),
      });
    }
  }

  it('covers every creature', () => {
    expect(ratios).toHaveLength(150);
  });

  it('keeps every creature inside the budget band for its rarity and stage', () => {
    for (const entry of ratios) {
      expect(Math.abs(entry.ratio - 1), `${entry.name} is ${(entry.ratio * 100).toFixed(1)}% of target`).toBeLessThanOrEqual(BAND);
    }
  });

  it('lets no element dominate', () => {
    for (const element of ELEMENTS) {
      const group = ratios.filter((entry) => entry.elements.includes(element));
      expect(group.length, element).toBeGreaterThan(0);
      const mean = group.reduce((sum, entry) => sum + entry.ratio, 0) / group.length;
      expect(Math.abs(mean - 1), `${element} averages ${(mean * 100).toFixed(1)}%`).toBeLessThanOrEqual(GROUP_BAND);
    }
  });

  it('lets no role dominate', () => {
    for (const role of new Set(ratios.map((entry) => entry.role))) {
      const group = ratios.filter((entry) => entry.role === role);
      const mean = group.reduce((sum, entry) => sum + entry.ratio, 0) / group.length;
      expect(Math.abs(mean - 1), `${role} averages ${(mean * 100).toFixed(1)}%`).toBeLessThanOrEqual(GROUP_BAND);
    }
  });
});

describe('capture', () => {
  it('adds a new spirit at the captured stage and equips it in a free slot', () => {
    const result = captureSpirit(emptyCollection(), twig, 1, 1, balance);
    expect(result.isNew).toBe(true);
    expect(result.collection.spirits).toEqual([{ familyId: twig.id, capturedStage: 1, growth: captureGrowth('common', 1, balance), perkMult: 1 }]);
    expect(result.collection.equipped).toEqual({ u0: twig.id });
  });

  it('grows the existing spirit instead of adding a second copy', () => {
    const once = capture(emptyCollection());
    const twice = captureSpirit(once, twig, 1, 1, balance);
    expect(twice.isNew).toBe(false);
    expect(twice.collection.spirits).toHaveLength(1);
    expect(twice.collection.spirits[0]!.growth).toBe(2 * captureGrowth('common', 1, balance));
  });

  it('awards more growth for rarer and more evolved creatures', () => {
    expect(captureGrowth('common', 1, balance)).toBe(balance.growth.base);
    expect(captureGrowth('legendary', 3, balance)).toBe(balance.growth.base * 6 * 4);
    expect(captureGrowth('rare', 1, balance)).toBeGreaterThan(captureGrowth('uncommon', 1, balance));
    expect(captureGrowth('common', 2, balance)).toBeGreaterThan(captureGrowth('common', 1, balance));
  });

  it('gives a spirit first captured at a later stage that stage from the start', () => {
    const collection = capture(emptyCollection(), komodo, 3);
    const spirit = collection.spirits[0]!;
    expect(stageOf(spirit, komodo, balance)).toBe(3);
    expect(spiritName(spirit, komodo, balance)).toBe('Komodrake');
    expect(spirit.growth).toBe(captureGrowth('rare', 3, balance));
  });

  it('keeps the higher stage and perk multiplier when a stronger version is captured later', () => {
    let collection = capture(emptyCollection(), komodo, 1);
    collection = capture(collection, komodo, 3, 1.5);
    expect(collection.spirits[0]).toMatchObject({ capturedStage: 3, perkMult: 1.5 });
    collection = capture(collection, komodo, 1, 1);
    expect(collection.spirits[0]).toMatchObject({ capturedStage: 3, perkMult: 1.5 });
  });

  it('leaves a new spirit unequipped when no slot is free', () => {
    let collection = capture(emptyCollection(), twig);
    collection = capture(collection, flytrap);
    collection = capture(collection, komodo);
    expect(Object.values(collection.equipped)).toEqual([twig.id, flytrap.id]);
    expect(slotOf(collection, komodo.id)).toBeNull();
  });
});

describe('levels and evolution', () => {
  it('gains a level every perLevel growth, up to the cap', () => {
    const spirit = { familyId: twig.id, capturedStage: 1 as Stage, growth: 0, perkMult: 1 };
    expect(levelOf(spirit, balance)).toBe(1);
    expect(levelOf({ ...spirit, growth: balance.growth.perLevel * 3 }, balance)).toBe(4);
    expect(levelOf({ ...spirit, growth: 1e9 }, balance)).toBe(balance.growth.maxLevel);
  });

  it('evolves at the family levels and changes name', () => {
    const atLevel = (level: number) => ({ familyId: twig.id, capturedStage: 1 as Stage, growth: (level - 1) * balance.growth.perLevel, perkMult: 1 });
    expect(stageOf(atLevel(twig.evolvesAt[0] - 1), twig, balance)).toBe(1);
    expect(stageOf(atLevel(twig.evolvesAt[0]), twig, balance)).toBe(2);
    expect(stageOf(atLevel(twig.evolvesAt[1]), twig, balance)).toBe(3);
    expect(spiritName(atLevel(twig.evolvesAt[1]), twig, balance)).toBe(twig.stages[2]);
  });

  it('reports evolution from a capture and from kill experience', () => {
    const almost = (twig.evolvesAt[0] - 1) * balance.growth.perLevel - balance.growth.killXp;
    const collection: SpiritCollection = {
      spirits: [{ familyId: twig.id, capturedStage: 1, growth: almost, perkMult: 1 }],
      equipped: { u0: twig.id },
      captures: {},
    };
    const killed = addKillXp(collection, findFamily, balance);
    expect(killed.evolved).toEqual([twig.stages[1]]);
    expect(captureSpirit(collection, twig, 1, 1, balance).evolved).toBe(true);
  });

  it('gives kill experience only to equipped spirits', () => {
    let collection = capture(capture(capture(emptyCollection(), twig), flytrap), komodo);
    const before = collection.spirits.map((s) => s.growth);
    collection = addKillXp(collection, findFamily, balance).collection;
    expect(collection.spirits.map((s, i) => s.growth - before[i]!)).toEqual([balance.growth.killXp, balance.growth.killXp, 0]);
    expect(addKillXp(emptyCollection(), findFamily, balance).collection).toEqual(emptyCollection());
  });

  it('makes an evolved spirit stronger', () => {
    const stage1 = spiritStats({ familyId: twig.id, capturedStage: 1, growth: 0, perkMult: 1 }, twig, balance);
    const stage2 = spiritStats({ familyId: twig.id, capturedStage: 2, growth: 0, perkMult: 1 }, twig, balance);
    expect(statBudget(stage2) / statBudget(stage1)).toBeCloseTo(balance.stageMult[1] / balance.stageMult[0]);
  });
});

describe('slots grow by capturing creatures of the same element', () => {
  const [first, second, third] = balance.slots.attunementThresholds as [number, number, number];

  it('starts with only the universal slots', () => {
    expect(slotList(emptyCollection(), balance)).toEqual([{ key: 'u0', element: null }, { key: 'u1', element: null }]);
  });

  it('unlocks an element slot at each threshold, counting both elements of a dual creature', () => {
    let collection = captureTimes(emptyCollection(), twig, first - 1);
    expect(slotList(collection, balance)).toHaveLength(2);
    expect(nextAttunement(collection, 'Verdant', balance)).toEqual({ have: first - 1, need: first });

    const unlocking = captureSpirit(collection, twig, 1, 1, balance);
    expect(unlocking.slotsUnlocked.sort()).toEqual(['Gale', 'Verdant']);
    collection = unlocking.collection;
    expect(slotList(collection, balance).map((s) => s.key)).toEqual(['u0', 'u1', 'Verdant0', 'Gale0']);

    collection = captureTimes(collection, twig, second - first);
    expect(slotList(collection, balance).map((s) => s.key)).toContain('Verdant1');
    collection = captureTimes(collection, twig, third - second);
    expect(slotList(collection, balance).filter((s) => s.element === 'Verdant')).toHaveLength(3);
    expect(nextAttunement(collection, 'Verdant', balance)).toBeNull();
  });

  it('does not count captures of other elements', () => {
    const collection = captureTimes(emptyCollection(), komodo, first);
    expect(slotList(collection, balance).map((s) => s.key)).toEqual(['u0', 'u1', 'Ember0']);
    expect(collection.captures.Tide).toBeUndefined();
  });

  it('only lets a spirit of the matching element into an element slot', () => {
    let collection = captureTimes(emptyCollection(), komodo, first); // unlocks Ember0
    collection = capture(collection, twig);
    expect(equipSpirit(collection, twig.id, 'Ember0', findFamily, balance)).toBe(collection);
    const moved = equipSpirit(collection, komodo.id, 'Ember0', findFamily, balance);
    expect(moved.equipped).toEqual({ u1: twig.id, Ember0: komodo.id });
  });

  it('keeps existing equips in place when a new slot unlocks', () => {
    let collection = capture(capture(emptyCollection(), komodo), flytrap);
    collection = captureTimes(collection, twig, first); // twig stays out: both universal slots are full
    expect(collection.equipped.u0).toBe(komodo.id);
    expect(collection.equipped.u1).toBe(flytrap.id);
    expect(equippedSpirits(collection, balance).map((s) => s.familyId)).toEqual([komodo.id, flytrap.id]);
  });
});

describe('equipping', () => {
  const three = capture(capture(capture(emptyCollection(), twig), flytrap), komodo);

  it('replaces the spirit in a slot and moves a spirit between slots', () => {
    const replaced = equipSpirit(three, komodo.id, 'u0', findFamily, balance);
    expect(replaced.equipped).toEqual({ u0: komodo.id, u1: flytrap.id });
    const moved = equipSpirit(replaced, flytrap.id, 'u0', findFamily, balance);
    expect(moved.equipped).toEqual({ u0: flytrap.id });
  });

  it('ignores invalid requests', () => {
    expect(equipSpirit(three, 'not-owned', 'u0', findFamily, balance)).toBe(three);
    expect(equipSpirit(three, komodo.id, 'no-such-slot', findFamily, balance)).toBe(three);
    expect(equipSpirit(three, twig.id, 'u0', findFamily, balance)).toBe(three);
  });

  it('unequips a slot', () => {
    expect(unequipSlot(three, 'u0').equipped).toEqual({ u1: flytrap.id });
    expect(unequipSlot(three, 'Ember0')).toBe(three);
  });
});

describe('player bonuses', () => {
  it('is neutral with nothing equipped', () => {
    expect(playerBonuses(emptyCollection(), findFamily, balance)).toMatchObject({
      damageMult: 1, maxHpBonus: 0, moveSpeedMult: 1, reloadMult: 1, critChanceAdd: 0, cooldownMult: 1, affinity: [],
    });
  });

  it('turns the summed stats of equipped spirits into perks', () => {
    const collection = capture(capture(emptyCollection(), twig), flytrap);
    const a = spiritStats(collection.spirits[0]!, twig, balance);
    const b = spiritStats(collection.spirits[1]!, flytrap, balance);
    const bonuses = playerBonuses(collection, findFamily, balance);
    expect(bonuses.damageMult).toBeCloseTo(1 + (a.power + b.power) * balance.perks.damagePerPower);
    expect(bonuses.moveSpeedMult).toBeCloseTo(1 + (a.agility + b.agility) * balance.perks.speedPerAgility);
    expect(bonuses.critChanceAdd).toBeCloseTo((a.focus + b.focus) * balance.perks.critPerFocus);
    expect(bonuses.maxHpBonus).toBe(Math.floor((a.vitality + b.vitality) * balance.perks.hpPerVitality));
    expect(bonuses.affinity.sort()).toEqual(['Gale', 'Verdant', 'Volt']);
  });

  it('ignores spirits that are owned but not equipped', () => {
    const collection = capture(capture(capture(emptyCollection(), twig), flytrap), komodo);
    const withoutKomodo = capture(capture(emptyCollection(), twig), flytrap);
    expect(playerBonuses(collection, findFamily, balance)).toEqual(playerBonuses(withoutKomodo, findFamily, balance));
  });

  it('caps reload and cooldown reductions', () => {
    const huge: SpiritCollection = {
      spirits: [{ familyId: whale.id, capturedStage: 3, growth: 0, perkMult: 500 }],
      equipped: { u0: whale.id },
      captures: {},
    };
    const bonuses = playerBonuses(huge, findFamily, balance);
    expect(bonuses.reloadMult).toBeCloseTo(1 - balance.perks.maxReloadReduction);
    expect(bonuses.cooldownMult).toBeCloseTo(1 - balance.perks.maxCooldownReduction);
  });

  it('makes a boss spirit the strongest version of its creature, scaling with stage level', () => {
    const normal = capture(emptyCollection(), komodo, 3, 1);
    const boss = capture(emptyCollection(), komodo, 3, bossPerkMult(1, balance));
    expect(bossPerkMult(1, balance)).toBe(balance.boss.perkMult);
    expect(bossPerkMult(3, balance)).toBeGreaterThan(bossPerkMult(1, balance));
    const ratio = (playerBonuses(boss, findFamily, balance).damageMult - 1) / (playerBonuses(normal, findFamily, balance).damageMult - 1);
    expect(ratio).toBeCloseTo(balance.boss.perkMult);
  });

  it('applies damage, reload, crit, and elemental affinity to weapons', () => {
    const collection = capture(emptyCollection(), flytrap); // Volt/Verdant
    const bonuses = playerBonuses(collection, findFamily, balance);
    const kinetic = getWeapon('pocket-sting');
    const volt = getWeapon('volt-lance');
    const boostedKinetic = applyBonuses(kinetic, bonuses);
    expect(boostedKinetic.damage).toBeCloseTo(kinetic.damage * bonuses.damageMult);
    expect(boostedKinetic.reloadMs).toBeCloseTo(kinetic.reloadMs * bonuses.reloadMult);
    expect(boostedKinetic.critChance).toBeCloseTo(kinetic.critChance + bonuses.critChanceAdd);
    expect(applyBonuses(volt, bonuses).damage).toBeCloseTo(volt.damage * bonuses.damageMult * (1 + balance.perks.affinityDamage));
    expect(kinetic.damage).toBe(getWeapon('pocket-sting').damage);
  });
});

describe('abilities', () => {
  it('uses the first equipped spirit and its creature ability name', () => {
    expect(activeAbility(emptyCollection(), findFamily, balance)).toBeNull();
    const collection = capture(capture(emptyCollection(), komodo, 3), twig);
    const ability = activeAbility(collection, findFamily, balance)!;
    expect(ability).toMatchObject({ familyId: komodo.id, name: 'Venom Maw', effect: 'shield', element: 'Ember' });
    expect(ability.cooldownMs).toBeLessThanOrEqual(balance.abilities.cooldownMs);
    expect(ability.cooldownMs).toBeGreaterThanOrEqual(balance.abilities.cooldownMs * (1 - balance.perks.maxCooldownReduction));
  });
});

describe('spirits and the checkpoint rule', () => {
  it('loses spirits and growth gained since the last checkpoint on death', () => {
    const banked = capture(emptyCollection(), twig);
    let run = activateCheckpoint(createRunState(createInventory(), banked), 'cp-1', 1);
    run = setSpirits(run, capture(capture(run.spirits, flytrap), twig));
    expect(unsecuredSpiritCount(run)).toBe(1);
    run = die(run);
    expect(run.spirits).toBe(banked);
    expect(unsecuredSpiritCount(run)).toBe(0);
  });

  it('keeps spirits banked at a checkpoint or on stage clear', () => {
    let run = setSpirits(createRunState(), capture(emptyCollection(), twig));
    run = activateCheckpoint(run, 'cp-1', 1);
    expect(die(run).spirits.spirits).toHaveLength(1);
    run = setSpirits(run, capture(run.spirits, komodo, 3, 1.5));
    expect(secureAll(run).securedSpirits).toBe(run.spirits);
  });

  it('round-trips banked spirits through a save and drops unbanked ones', () => {
    let run = setSpirits(createRunState(), capture(emptyCollection(), twig));
    run = activateCheckpoint(run, 'cp-1', 1);
    run = setSpirits(run, capture(run.spirits, komodo, 3, 1.5));
    const restored = restoreRun(parseSave(JSON.stringify(serializeRun('level1', run)))!);
    expect(restored.spirits.spirits.map((s) => s.familyId)).toEqual([twig.id]);
    expect(restored.spirits.equipped).toEqual({ u0: twig.id });
    expect(restored.spirits.captures).toEqual({ Verdant: 1, Gale: 1 });
  });

  it('migrates a version 3 save to an empty collection and rejects malformed spirits', () => {
    const inventory = { items: [], equipped: [null, null, null] };
    const v3 = { version: 3, levelId: 'level1', checkpointId: 'cp-1', checkpointOrder: 1, secured: [], defeated: [], inventory };
    expect(parseSave(JSON.stringify(v3))).toMatchObject({ version: SAVE_VERSION, spirits: null });
    expect(restoreRun(parseSave(JSON.stringify(v3))!).spirits).toEqual(emptyCollection());

    const v4 = (spirits: unknown) => JSON.stringify({ ...v3, version: 4, spirits });
    const good = { spirits: [{ familyId: twig.id, capturedStage: 1, growth: 4, perkMult: 1 }], equipped: { u0: twig.id }, captures: { Verdant: 1 } };
    expect(parseSave(v4(good))).not.toBeNull();
    expect(parseSave(v4({ ...good, equipped: { u0: 'someone-else' } }))).toBeNull();
    expect(parseSave(v4({ ...good, spirits: [{ ...good.spirits[0], capturedStage: 4 }] }))).toBeNull();
    expect(parseSave(v4({ ...good, captures: { Verdant: -1 } }))).toBeNull();
    expect(parseSave(v4(undefined))).toBeNull();
  });

  it('drops spirits whose creature family no longer exists', () => {
    const collection: SpiritCollection = {
      spirits: [{ familyId: twig.id, capturedStage: 1, growth: 0, perkMult: 1 }, { familyId: 'deleted', capturedStage: 1, growth: 0, perkMult: 1 }],
      equipped: { u0: 'deleted', u1: twig.id },
      captures: {},
    };
    const cleaned = sanitizeCollection(collection, findFamily);
    expect(cleaned.spirits.map((s) => s.familyId)).toEqual([twig.id]);
    expect(cleaned.equipped).toEqual({ u1: twig.id });
    expect(sanitizeCollection(cleaned, findFamily)).toBe(cleaned);
  });
});

describe('enemies as creatures', () => {
  it('links every enemy and boss to a creature whose primary element matches', () => {
    for (const kind of enemyKinds()) {
      const stats = getEnemyStats(kind);
      expect(stats.creature, kind).toBeDefined();
      expect(getFamily(stats.creature!.family).elements[0], kind).toBe(stats.element);
    }
    for (const kind of bossKinds()) {
      const stats = getBossStats(kind);
      expect(stats.creature, kind).toBeDefined();
      expect(stats.creature!.family, kind).toBe(stats.family);
      expect(getFamily(stats.creature!.family).elements[0], kind).toBe(stats.element);
    }
  });
});
