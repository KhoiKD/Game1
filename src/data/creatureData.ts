import type { Element } from '../systems/combat';
import {
  ABILITY_EFFECTS,
  SPIRIT_STATS,
  statBudget,
  type Balance,
  type Stage,
} from '../systems/spiritStats';
import type { FamilyInfo } from '../systems/spirits';
import rawBalance from './balance.json';
import rawCreatures from './creatures.json';
import rawLore from './creature-lore.json';
import { ELEMENTS, isElement } from './elementData';
import { RARITIES, type Rarity } from './weaponData';

export interface CreatureFamily extends FamilyInfo {
  /** The real animal, plant, or fungus the family is based on. */
  inspiration: string;
  habitat: string;
}

/** Which creature an enemy is, so its spirit can be captured. */
export interface CreatureRef {
  family: string;
  stage: Stage;
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Checks balance.json at load. */
export function validateBalance(input: unknown): Balance {
  const b = input as Balance;
  if (!b?.roleBase || !b.rarityMult || !b.stageMult || !b.elementTilt || !b.growth || !b.capture || !b.slots || !b.perks || !b.abilities) {
    throw new Error('balance.json: a required section is missing');
  }
  const budgets = new Set<number>();
  for (const [role, base] of Object.entries(b.roleBase)) {
    for (const stat of SPIRIT_STATS) if (!positive(base[stat])) throw new Error(`balance.json: roleBase "${role}": bad ${stat}`);
    budgets.add(Math.round(statBudget(base) * 1000));
    if (!ABILITY_EFFECTS.includes(b.abilities.byRole[role]!)) throw new Error(`balance.json: role "${role}" needs an ability in abilities.byRole`);
  }
  if (budgets.size !== 1) throw new Error('balance.json: every role must have the same total stat budget');

  const tiltTotals = new Set<number>();
  for (const element of ELEMENTS) {
    const tilt = b.elementTilt[element];
    if (!tilt) throw new Error(`balance.json: missing elementTilt for "${element}"`);
    for (const stat of SPIRIT_STATS) if (!positive(tilt[stat])) throw new Error(`balance.json: elementTilt "${element}": bad ${stat}`);
    tiltTotals.add(Math.round(statBudget(tilt) * 1000));
  }
  if (tiltTotals.size !== 1) throw new Error('balance.json: every element tilt must sum to the same total');

  let previous = 0;
  for (const rarity of RARITIES) {
    for (const table of [b.rarityMult, b.growth.rarity, b.capture.windowMs]) {
      if (!positive(table[rarity])) throw new Error(`balance.json: missing value for rarity "${rarity}"`);
    }
    if (b.rarityMult[rarity] < previous) throw new Error('balance.json: rarityMult must not decrease with rarity');
    previous = b.rarityMult[rarity];
  }
  for (const list of [b.stageMult, b.growth.stage]) {
    if (!Array.isArray(list) || list.length !== 3 || !list.every(positive) || list[0]! > list[1]! || list[1]! > list[2]!) {
      throw new Error('balance.json: stage multipliers need three ascending values');
    }
  }
  if (!positive(b.growth.base) || !positive(b.growth.perLevel) || !positive(b.growth.maxLevel) || b.growth.killXp < 0) {
    throw new Error('balance.json: bad growth settings');
  }
  const thresholds = b.slots.attunementThresholds;
  if (!Number.isInteger(b.slots.universal) || b.slots.universal < 1 || !Array.isArray(thresholds) || !thresholds.every(positive)) {
    throw new Error('balance.json: bad slots settings');
  }
  if (thresholds.some((t, i) => i > 0 && t <= thresholds[i - 1]!)) throw new Error('balance.json: attunementThresholds must ascend');
  if (!positive(b.boss.perkMult) || b.boss.perkMult < 1 || b.boss.perStageLevel < 0) throw new Error('balance.json: bad boss settings');
  return b;
}

export const balance = validateBalance(rawBalance);

/** Checks creatures.json at load: valid elements, roles, rarities, and evolution levels. */
export function validateCreatures(input: unknown, rules: Balance): CreatureFamily[] {
  const families = (input as { families?: CreatureFamily[] } | null)?.families;
  if (!Array.isArray(families) || families.length === 0) throw new Error('creatures.json: expected a "families" list');
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const family of families) {
    const where = `creatures.json: family "${family.id}"`;
    if (!family.id || ids.has(family.id)) throw new Error(`${where}: missing or duplicate id`);
    ids.add(family.id);
    if (!Array.isArray(family.elements) || family.elements.length < 1 || family.elements.length > 2 || !family.elements.every(isElement)) {
      throw new Error(`${where}: needs one or two valid elements`);
    }
    if (!rules.roleBase[family.role]) throw new Error(`${where}: role "${family.role}" has no roleBase in balance.json`);
    if (!RARITIES.includes(family.rarity as Rarity)) throw new Error(`${where}: unknown rarity "${String(family.rarity)}"`);
    const [second, third] = family.evolvesAt ?? [];
    if (!positive(second) || !positive(third) || second >= third) throw new Error(`${where}: evolvesAt must be two ascending levels`);
    if (!Array.isArray(family.stages) || family.stages.length !== 3) throw new Error(`${where}: needs exactly three stage names`);
    for (const name of family.stages) {
      if (!name || names.has(name)) throw new Error(`${where}: missing or duplicate creature name "${name}"`);
      names.add(name);
    }
    if (typeof family.ability !== 'string' || !family.ability.includes(':')) throw new Error(`${where}: ability must be "Name: description"`);
  }
  return families;
}

export const creatureFamilies = validateCreatures(rawCreatures, balance);
const byId = new Map(creatureFamilies.map((family) => [family.id, family]));

export function findFamily(id: string): CreatureFamily | undefined {
  return byId.get(id);
}

export function getFamily(id: string): CreatureFamily {
  const family = byId.get(id);
  if (!family) throw new Error(`Unknown creature family "${id}" (see src/data/creatures.json)`);
  return family;
}

export function creatureName(ref: CreatureRef): string {
  return getFamily(ref.family).stages[ref.stage - 1]!;
}

export function primaryElement(familyId: string): Element {
  return getFamily(familyId).elements[0]!;
}

const lore = rawLore as Record<string, string>;

/** A short lore line for a creature by name, or null if it has none yet. */
export function loreFor(creatureName: string): string | null {
  return lore[creatureName] ?? null;
}
