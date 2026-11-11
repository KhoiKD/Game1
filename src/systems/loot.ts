import {
  RARITIES,
  resolveWeapon,
  type ArchetypeDef,
  type Rarity,
  type ResolvedWeapon,
  type WeaponDef,
  type WeaponStats,
} from '../data/weaponData';
import type { Rng } from '../util/rng';

/**
 * Loot rules: what drops, how rare it is, which perks it rolls, and how perks
 * change a weapon. Everything here is pure and takes its data and random
 * source as arguments, so every roll is repeatable from a seed.
 */
export const PERK_SLOTS = ['barrel', 'magazine', 'trait', 'signature'] as const;
export type PerkSlot = (typeof PERK_SLOTS)[number];

/** Stats a perk may change. */
export const MODDABLE_STATS = [
  'fireIntervalMs', 'burstCount', 'chargeMs', 'damage', 'pellets', 'spreadDeg', 'projectileSpeed',
  'range', 'stability', 'reloadMs', 'magazine', 'handling', 'pierce', 'blastRadius',
] as const;
export type ModdableStat = (typeof MODDABLE_STATS)[number];

export interface PerkMod {
  stat: ModdableStat;
  op: 'add' | 'mul';
  value: number;
}

export interface PerkDef {
  id: string;
  name: string;
  slot: PerkSlot;
  /** Archetype ids this perk can roll on; "*" means any. */
  archetypes: string[];
  description: string;
  mods: PerkMod[];
}

export interface RarityRule {
  perkSlots: PerkSlot[];
  /** Range for the damage multiplier rolled on each drop. */
  damageRoll: [number, number];
}

export interface DropTable {
  dropChance: number;
  rarityWeights: Partial<Record<Rarity, number>>;
}

/** A specific weapon the player owns: a base weapon plus its rolls. */
export interface WeaponInstance {
  uid: string;
  baseId: string;
  rarity: Rarity;
  damageRoll: number;
  perks: string[];
}

export interface LootRules {
  weapons: WeaponDef[];
  archetypes: Record<string, ArchetypeDef>;
  perks: PerkDef[];
  rarities: Record<Rarity, RarityRule>;
}

const WHOLE_STATS: ReadonlySet<ModdableStat> = new Set(['magazine', 'pellets', 'burstCount', 'pierce']);
const PERCENT_STATS: ReadonlySet<ModdableStat> = new Set(['stability', 'handling']);
const MINIMUM: Partial<Record<ModdableStat, number>> = { magazine: 1, pellets: 1, burstCount: 1 };

/** Applies perk modifiers in order, then keeps every stat in its valid range. */
export function applyPerks<T extends WeaponStats>(weapon: T, perks: readonly PerkDef[]): T {
  const stats: T = { ...weapon };
  const touched = new Set<ModdableStat>();
  for (const perk of perks) {
    for (const mod of perk.mods) {
      const current = stats[mod.stat];
      (stats as WeaponStats)[mod.stat] = mod.op === 'add' ? current + mod.value : current * mod.value;
      touched.add(mod.stat);
    }
  }
  for (const stat of touched) {
    let value = stats[stat];
    if (WHOLE_STATS.has(stat)) value = Math.round(value);
    if (PERCENT_STATS.has(stat)) value = Math.min(100, value);
    (stats as WeaponStats)[stat] = Math.max(MINIMUM[stat] ?? 0, value);
  }
  return stats;
}

export function perkFitsArchetype(perk: PerkDef, archetype: string): boolean {
  return perk.archetypes.includes('*') || perk.archetypes.includes(archetype);
}

/** Picks a key from a weight table. Entries with zero or missing weight never win. */
export function pickWeighted<K extends string>(weights: Partial<Record<K, number>>, rng: Rng): K {
  const entries = (Object.entries(weights) as Array<[K, number | undefined]>).filter(
    (entry): entry is [K, number] => (entry[1] ?? 0) > 0,
  );
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (entries.length === 0 || total <= 0) throw new Error('pickWeighted needs at least one positive weight');
  let roll = rng() * total;
  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1]![0];
}

function pickOne<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

/** One perk per slot the rarity grants, drawn from the perks that fit the archetype. */
export function rollPerks(archetype: string, rarity: Rarity, rules: LootRules, rng: Rng): string[] {
  const rolled: string[] = [];
  for (const slot of rules.rarities[rarity].perkSlots) {
    const pool = rules.perks.filter((perk) => perk.slot === slot && perkFitsArchetype(perk, archetype));
    if (pool.length > 0) rolled.push(pickOne(pool, rng).id);
  }
  return rolled;
}

function higherRarity(a: Rarity, b: Rarity): Rarity {
  return RARITIES.indexOf(a) >= RARITIES.indexOf(b) ? a : b;
}

/**
 * Rolls a weapon of the given rarity. A base weapon's own rarity is a floor:
 * a weapon listed as rare never drops below rare.
 */
export function rollWeapon(rarity: Rarity, rules: LootRules, rng: Rng): WeaponInstance {
  const base = pickOne(rules.weapons, rng);
  const finalRarity = higherRarity(rarity, base.rarity);
  const [low, high] = rules.rarities[finalRarity].damageRoll;
  const damageRoll = Math.round((low + rng() * (high - low)) * 1000) / 1000;
  const perks = rollPerks(base.archetype, finalRarity, rules, rng);
  const uid = `${base.id}-${Math.floor(rng() * 0xffffffff).toString(36)}`;
  return { uid, baseId: base.id, rarity: finalRarity, damageRoll, perks };
}

/** Rolls a drop from a table. Returns null when nothing drops. */
export function rollDrop(table: DropTable, rules: LootRules, rng: Rng): WeaponInstance | null {
  if (rng() >= table.dropChance) return null;
  return rollWeapon(pickWeighted(table.rarityWeights, rng), rules, rng);
}

/** The playable weapon for an instance: base stats, damage roll, then perks. */
export function resolveInstance(instance: WeaponInstance, rules: LootRules): ResolvedWeapon {
  const base = rules.weapons.find((weapon) => weapon.id === instance.baseId);
  if (!base) throw new Error(`Unknown base weapon "${instance.baseId}"`);
  const perks = instance.perks.map((id) => {
    const perk = rules.perks.find((p) => p.id === id);
    if (!perk) throw new Error(`Unknown perk "${id}"`);
    return perk;
  });
  const resolved = resolveWeapon(base, rules.archetypes);
  return applyPerks(
    { ...resolved, rarity: instance.rarity, damage: resolved.damage * instance.damageRoll },
    perks,
  );
}

/** True when the instance refers only to weapons and perks that exist in the rules. */
export function isKnownInstance(instance: WeaponInstance, rules: LootRules): boolean {
  return (
    rules.weapons.some((weapon) => weapon.id === instance.baseId) &&
    instance.perks.every((id) => rules.perks.some((perk) => perk.id === id))
  );
}
