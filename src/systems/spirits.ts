import type { Rarity, ResolvedWeapon } from '../data/weaponData';
import type { Element } from './combat';
import {
  computeSpiritStats,
  scaleStats,
  type AbilityEffect,
  type Balance,
  type SpiritStatBlock,
  type Stage,
} from './spiritStats';

/**
 * The player's captured spirits: collection, growth, evolution, equip slots,
 * and the bonuses equipped spirits give. Pure and serializable; creature data
 * and balance numbers are passed in.
 */
export interface FamilyInfo {
  id: string;
  elements: readonly Element[];
  role: string;
  rarity: Rarity;
  /** Levels at which the spirit reaches stage 2 and stage 3. */
  evolvesAt: readonly [number, number];
  stages: readonly [string, string, string];
  ability: string;
}
export type FamilyLookup = (familyId: string) => FamilyInfo | undefined;

export interface Spirit {
  familyId: string;
  /** The stage it was at when first captured; it never drops below this. */
  capturedStage: Stage;
  /** Growth points from captures and kills. Sets its level. */
  growth: number;
  /** Multiplier on its perks. 1 normally; higher for a spirit taken from a boss. */
  perkMult: number;
}

export interface SpiritCollection {
  readonly spirits: readonly Spirit[];
  /** Slot key to family id. Keys: "u0", "u1" for universal slots; "Ember0" etc. for element slots. */
  readonly equipped: Readonly<Record<string, string>>;
  /** Captures per element, for unlocking element slots. */
  readonly captures: Readonly<Partial<Record<Element, number>>>;
}

export interface SpiritSlot {
  key: string;
  /** Null for a universal slot; otherwise only spirits of this element fit. */
  element: Element | null;
}

const ELEMENT_ORDER: readonly Element[] = ['Ember', 'Tide', 'Volt', 'Verdant', 'Umbra', 'Gale'];

export function emptyCollection(): SpiritCollection {
  return { spirits: [], equipped: {}, captures: {} };
}

// ---- levels and evolution --------------------------------------------------

export function levelOf(spirit: Spirit, balance: Balance): number {
  return Math.min(balance.growth.maxLevel, 1 + Math.floor(spirit.growth / balance.growth.perLevel));
}

/** Current evolution stage: the captured stage, or higher once its level reaches the family's thresholds. */
export function stageOf(spirit: Spirit, family: FamilyInfo, balance: Balance): Stage {
  const level = levelOf(spirit, balance);
  const byLevel: Stage = level >= family.evolvesAt[1] ? 3 : level >= family.evolvesAt[0] ? 2 : 1;
  return Math.max(spirit.capturedStage, byLevel) as Stage;
}

export function spiritName(spirit: Spirit, family: FamilyInfo, balance: Balance): string {
  return family.stages[stageOf(spirit, family, balance) - 1]!;
}

/** Growth a capture awards: more for rarer and more evolved creatures. */
export function captureGrowth(rarity: Rarity, stage: Stage, balance: Balance): number {
  return balance.growth.base * balance.growth.rarity[rarity] * balance.growth.stage[stage - 1]!;
}

/** Perk multiplier for a spirit taken from a boss, scaled to the level of its stage. */
export function bossPerkMult(stageLevel: number, balance: Balance): number {
  return balance.boss.perkMult * (1 + balance.boss.perStageLevel * Math.max(0, stageLevel - 1));
}

export function spiritStats(spirit: Spirit, family: FamilyInfo, balance: Balance): SpiritStatBlock {
  const stats = computeSpiritStats(
    { role: family.role, rarity: family.rarity, stage: stageOf(spirit, family, balance), elements: family.elements },
    balance,
  );
  return scaleStats(stats, spirit.perkMult);
}

// ---- slots -----------------------------------------------------------------

/** Universal slots first, then element slots unlocked by capturing creatures of that element. */
export function slotList(collection: SpiritCollection, balance: Balance): SpiritSlot[] {
  const slots: SpiritSlot[] = [];
  for (let i = 0; i < balance.slots.universal; i++) slots.push({ key: `u${i}`, element: null });
  for (const element of ELEMENT_ORDER) {
    const captured = collection.captures[element] ?? 0;
    balance.slots.attunementThresholds.forEach((threshold, i) => {
      if (captured >= threshold) slots.push({ key: `${element}${i}`, element });
    });
  }
  return slots;
}

/** Captures still needed for the next slot of an element, or null when all are unlocked. */
export function nextAttunement(collection: SpiritCollection, element: Element, balance: Balance): { have: number; need: number } | null {
  const have = collection.captures[element] ?? 0;
  const need = balance.slots.attunementThresholds.find((threshold) => have < threshold);
  return need === undefined ? null : { have, need };
}

function fits(slot: SpiritSlot, family: FamilyInfo): boolean {
  return slot.element === null || family.elements.includes(slot.element);
}

/** Equipped spirits in slot order. */
export function equippedSpirits(collection: SpiritCollection, balance: Balance): Spirit[] {
  const spirits: Spirit[] = [];
  for (const slot of slotList(collection, balance)) {
    const familyId = collection.equipped[slot.key];
    const spirit = familyId === undefined ? undefined : collection.spirits.find((s) => s.familyId === familyId);
    if (spirit) spirits.push(spirit);
  }
  return spirits;
}

export function slotOf(collection: SpiritCollection, familyId: string): string | null {
  return Object.keys(collection.equipped).find((key) => collection.equipped[key] === familyId) ?? null;
}

/**
 * Puts an owned spirit in a slot. A spirit already in another slot moves, and
 * whatever was in the target slot goes back to the collection. Returns the same
 * collection when the move is not allowed.
 */
export function equipSpirit(
  collection: SpiritCollection,
  familyId: string,
  slotKey: string,
  lookup: FamilyLookup,
  balance: Balance,
): SpiritCollection {
  const slot = slotList(collection, balance).find((s) => s.key === slotKey);
  const family = lookup(familyId);
  if (!slot || !family || !collection.spirits.some((s) => s.familyId === familyId)) return collection;
  if (!fits(slot, family) || collection.equipped[slotKey] === familyId) return collection;
  const equipped: Record<string, string> = {};
  for (const [key, id] of Object.entries(collection.equipped)) if (id !== familyId) equipped[key] = id;
  equipped[slotKey] = familyId;
  return { ...collection, equipped };
}

export function unequipSlot(collection: SpiritCollection, slotKey: string): SpiritCollection {
  if (collection.equipped[slotKey] === undefined) return collection;
  const { [slotKey]: _removed, ...equipped } = collection.equipped;
  return { ...collection, equipped };
}

// ---- capture and growth ----------------------------------------------------

export interface CaptureResult {
  collection: SpiritCollection;
  /** False when the player already owned this spirit and it grew instead. */
  isNew: boolean;
  growthGained: number;
  /** Elements that unlocked a new slot with this capture. */
  slotsUnlocked: Element[];
  evolved: boolean;
}

/**
 * Captures a creature's spirit. A new spirit joins the collection at the
 * captured stage and takes the first free slot it fits; a spirit already owned
 * grows instead. Either way the capture counts toward its elements' slots.
 */
export function captureSpirit(
  collection: SpiritCollection,
  family: FamilyInfo,
  stage: Stage,
  perkMult: number,
  balance: Balance,
): CaptureResult {
  const growthGained = captureGrowth(family.rarity, stage, balance);
  const existing = collection.spirits.find((s) => s.familyId === family.id);
  const stageBefore = existing ? stageOf(existing, family, balance) : stage;
  const updated: Spirit = existing
    ? {
        ...existing,
        growth: existing.growth + growthGained,
        capturedStage: Math.max(existing.capturedStage, stage) as Stage,
        perkMult: Math.max(existing.perkMult, perkMult),
      }
    : { familyId: family.id, capturedStage: stage, growth: growthGained, perkMult };

  const slotsBefore = new Set(slotList(collection, balance).map((s) => s.key));
  const captures = { ...collection.captures };
  for (const element of family.elements) captures[element] = (captures[element] ?? 0) + 1;

  let next: SpiritCollection = {
    spirits: existing
      ? collection.spirits.map((s) => (s.familyId === family.id ? updated : s))
      : [...collection.spirits, updated],
    equipped: collection.equipped,
    captures,
  };
  const slotsAfter = slotList(next, balance);
  if (!existing) {
    const free = slotsAfter.find((slot) => next.equipped[slot.key] === undefined && fits(slot, family));
    if (free) next = { ...next, equipped: { ...next.equipped, [free.key]: family.id } };
  }
  return {
    collection: next,
    isNew: !existing,
    growthGained,
    slotsUnlocked: slotsAfter.filter((s) => s.element !== null && !slotsBefore.has(s.key)).map((s) => s.element as Element),
    evolved: stageOf(updated, family, balance) > stageBefore,
  };
}

/** Every equipped spirit gains growth from a kill. Returns the names of any that evolved. */
export function addKillXp(
  collection: SpiritCollection,
  lookup: FamilyLookup,
  balance: Balance,
): { collection: SpiritCollection; evolved: string[] } {
  const equippedIds = new Set(equippedSpirits(collection, balance).map((s) => s.familyId));
  if (equippedIds.size === 0 || balance.growth.killXp <= 0) return { collection, evolved: [] };
  const evolved: string[] = [];
  const spirits = collection.spirits.map((spirit) => {
    if (!equippedIds.has(spirit.familyId)) return spirit;
    const grown = { ...spirit, growth: spirit.growth + balance.growth.killXp };
    const family = lookup(spirit.familyId);
    if (family && stageOf(grown, family, balance) > stageOf(spirit, family, balance)) {
      evolved.push(spiritName(grown, family, balance));
    }
    return grown;
  });
  return { collection: { ...collection, spirits }, evolved };
}

// ---- what equipped spirits give the player ---------------------------------

export interface PlayerBonuses {
  /** Multiplies weapon damage. */
  damageMult: number;
  maxHpBonus: number;
  moveSpeedMult: number;
  /** Multiplies reload time; below 1 is faster. */
  reloadMult: number;
  critChanceAdd: number;
  /** Multiplies ability cooldown; below 1 is faster. */
  cooldownMult: number;
  /** Elements of equipped spirits. Weapons of these elements deal extra damage. */
  affinity: Element[];
  affinityDamage: number;
}

export const NO_BONUSES: PlayerBonuses = {
  damageMult: 1,
  maxHpBonus: 0,
  moveSpeedMult: 1,
  reloadMult: 1,
  critChanceAdd: 0,
  cooldownMult: 1,
  affinity: [],
  affinityDamage: 0,
};

/** Sums the stats of all equipped spirits and turns them into perks. */
export function playerBonuses(collection: SpiritCollection, lookup: FamilyLookup, balance: Balance): PlayerBonuses {
  const total: SpiritStatBlock = { power: 0, vitality: 0, agility: 0, focus: 0 };
  const affinity = new Set<Element>();
  for (const spirit of equippedSpirits(collection, balance)) {
    const family = lookup(spirit.familyId);
    if (!family) continue;
    const stats = spiritStats(spirit, family, balance);
    total.power += stats.power;
    total.vitality += stats.vitality;
    total.agility += stats.agility;
    total.focus += stats.focus;
    for (const element of family.elements) affinity.add(element);
  }
  const p = balance.perks;
  return {
    damageMult: 1 + total.power * p.damagePerPower,
    maxHpBonus: Math.floor(total.vitality * p.hpPerVitality),
    moveSpeedMult: 1 + total.agility * p.speedPerAgility,
    reloadMult: 1 - Math.min(p.maxReloadReduction, total.agility * p.reloadPerAgility),
    critChanceAdd: total.focus * p.critPerFocus,
    cooldownMult: 1 - Math.min(p.maxCooldownReduction, total.focus * p.cooldownPerFocus),
    affinity: ELEMENT_ORDER.filter((element) => affinity.has(element)),
    affinityDamage: p.affinityDamage,
  };
}

/** A weapon as it plays with the spirit bonuses applied. */
export function applyBonuses(weapon: ResolvedWeapon, bonuses: PlayerBonuses): ResolvedWeapon {
  const matches = weapon.element !== 'kinetic' && bonuses.affinity.includes(weapon.element);
  return {
    ...weapon,
    damage: weapon.damage * bonuses.damageMult * (matches ? 1 + bonuses.affinityDamage : 1),
    reloadMs: weapon.reloadMs * bonuses.reloadMult,
    critChance: Math.min(1, weapon.critChance + bonuses.critChanceAdd),
  };
}

export interface ActiveAbility {
  familyId: string;
  /** The creature's ability name, from creatures.json. */
  name: string;
  effect: AbilityEffect;
  element: Element;
  stats: SpiritStatBlock;
  cooldownMs: number;
}

/** The right-click ability: it belongs to the first equipped spirit. */
export function activeAbility(collection: SpiritCollection, lookup: FamilyLookup, balance: Balance): ActiveAbility | null {
  const spirit = equippedSpirits(collection, balance)[0];
  const family = spirit ? lookup(spirit.familyId) : undefined;
  if (!spirit || !family) return null;
  const effect = balance.abilities.byRole[family.role];
  if (!effect) return null;
  return {
    familyId: family.id,
    name: family.ability.split(':')[0]!.trim(),
    effect,
    element: family.elements[0]!,
    stats: spiritStats(spirit, family, balance),
    cooldownMs: balance.abilities.cooldownMs * playerBonuses(collection, lookup, balance).cooldownMult,
  };
}

/** Removes spirits and slot entries that refer to creature families that no longer exist. */
export function sanitizeCollection(collection: SpiritCollection, lookup: FamilyLookup): SpiritCollection {
  const spirits = collection.spirits.filter((s) => lookup(s.familyId) !== undefined);
  if (spirits.length === collection.spirits.length) return collection;
  const known = new Set(spirits.map((s) => s.familyId));
  const equipped: Record<string, string> = {};
  for (const [key, id] of Object.entries(collection.equipped)) if (known.has(id)) equipped[key] = id;
  return { ...collection, spirits, equipped };
}
