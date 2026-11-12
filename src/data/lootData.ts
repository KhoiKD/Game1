import { createInventory, equippedItems, type Inventory } from '../systems/inventory';
import {
  MODDABLE_STATS,
  PERK_SLOTS,
  isKnownInstance,
  resolveInstance,
  rollDrop,
  type DropTable,
  type LootRules,
  type PerkDef,
  type RarityRule,
  type WeaponInstance,
} from '../systems/loot';
import type { Rng } from '../util/rng';
import rawDrops from './drops.json';
import rawPerks from './perks.json';
import { RARITIES, weaponData, type Rarity, type ResolvedWeapon } from './weaponData';

export interface DropData {
  rarities: Record<Rarity, RarityRule>;
  tables: Record<string, DropTable>;
}

/** Checks perks.json at load so a bad entry fails loudly. */
export function validatePerks(input: unknown): PerkDef[] {
  const perks = (input as { perks?: PerkDef[] } | null)?.perks;
  if (!Array.isArray(perks) || perks.length === 0) throw new Error('perks.json: expected a "perks" list');
  const ids = new Set<string>();
  for (const perk of perks) {
    const where = `perks.json: perk "${perk.id}"`;
    if (!perk.id || !perk.name || !perk.description) throw new Error(`${where}: needs id, name, and description`);
    if (ids.has(perk.id)) throw new Error(`${where}: duplicate id`);
    ids.add(perk.id);
    if (!PERK_SLOTS.includes(perk.slot)) throw new Error(`${where}: unknown slot "${String(perk.slot)}"`);
    if (!Array.isArray(perk.archetypes) || perk.archetypes.length === 0) throw new Error(`${where}: needs archetypes`);
    for (const archetype of perk.archetypes) {
      if (archetype !== '*' && !weaponData.archetypes[archetype]) {
        throw new Error(`${where}: unknown archetype "${archetype}"`);
      }
    }
    if (!Array.isArray(perk.mods) || perk.mods.length === 0) throw new Error(`${where}: needs at least one mod`);
    for (const mod of perk.mods) {
      if (!MODDABLE_STATS.includes(mod.stat)) throw new Error(`${where}: cannot modify "${String(mod.stat)}"`);
      if (mod.op !== 'add' && mod.op !== 'mul') throw new Error(`${where}: op must be "add" or "mul"`);
      if (typeof mod.value !== 'number' || !Number.isFinite(mod.value)) throw new Error(`${where}: bad value`);
      if (mod.op === 'mul' && mod.value <= 0) throw new Error(`${where}: a multiplier must be greater than 0`);
    }
  }
  return perks;
}

/** Checks drops.json at load. */
export function validateDrops(input: unknown): DropData {
  const data = input as DropData;
  if (!data?.rarities || !data.tables) throw new Error('drops.json: expected "rarities" and "tables"');
  for (const rarity of RARITIES) {
    const rule = data.rarities[rarity];
    if (!rule) throw new Error(`drops.json: missing rarity "${rarity}"`);
    if (!Array.isArray(rule.perkSlots) || rule.perkSlots.some((slot) => !PERK_SLOTS.includes(slot))) {
      throw new Error(`drops.json: rarity "${rarity}": bad perkSlots`);
    }
    const [low, high] = rule.damageRoll ?? [];
    if (typeof low !== 'number' || typeof high !== 'number' || low <= 0 || high < low) {
      throw new Error(`drops.json: rarity "${rarity}": damageRoll must be [low, high] with 0 < low <= high`);
    }
  }
  for (const [id, table] of Object.entries(data.tables)) {
    if (typeof table.dropChance !== 'number' || table.dropChance < 0 || table.dropChance > 1) {
      throw new Error(`drops.json: table "${id}": dropChance must be between 0 and 1`);
    }
    const weights = Object.entries(table.rarityWeights ?? {});
    if (weights.length === 0 || !weights.some(([, weight]) => (weight ?? 0) > 0)) {
      throw new Error(`drops.json: table "${id}": needs at least one positive rarity weight`);
    }
    for (const [rarity, weight] of weights) {
      if (!RARITIES.includes(rarity as Rarity)) throw new Error(`drops.json: table "${id}": unknown rarity "${rarity}"`);
      if (typeof weight !== 'number' || weight < 0) throw new Error(`drops.json: table "${id}": bad weight`);
    }
  }
  return data;
}

export const perkList = validatePerks(rawPerks);
export const dropData = validateDrops(rawDrops);

export const lootRules: LootRules = {
  weapons: weaponData.weapons,
  archetypes: weaponData.archetypes,
  perks: perkList,
  rarities: dropData.rarities,
};

export function getPerk(id: string): PerkDef {
  const perk = perkList.find((p) => p.id === id);
  if (!perk) throw new Error(`Unknown perk "${id}" (see src/data/perks.json)`);
  return perk;
}

/** Rolls a named drop table (a creature rarity, or "boss"). Unknown tables drop nothing. */
export function rollDropFor(source: string, rng: Rng): WeaponInstance | null {
  const table = dropData.tables[source];
  return table ? rollDrop(table, lootRules, rng) : null;
}

export function resolveWeaponInstance(instance: WeaponInstance): ResolvedWeapon {
  return resolveInstance(instance, lootRules);
}

/** The weapons a new run starts with: plain copies of the starter loadout, no perks. */
export function starterInventory(): Inventory {
  return createInventory(
    weaponData.starterLoadout.map((baseId) => ({
      uid: `starter-${baseId}`,
      baseId,
      rarity: 'common' as const,
      damageRoll: 1,
      perks: [],
    })),
  );
}

/**
 * Drops weapons a save refers to that no longer exist in the data. Falls back
 * to the starter weapons if that would leave nothing equipped.
 */
export function sanitizeInventory(inventory: Inventory): Inventory {
  const items = inventory.items.filter((item) => isKnownInstance(item, lootRules));
  if (items.length === inventory.items.length && equippedItems(inventory).length > 0) return inventory;
  const kept = new Set(items.map((item) => item.uid));
  const cleaned: Inventory = {
    items,
    equipped: inventory.equipped.map((uid) => (uid !== null && kept.has(uid) ? uid : null)),
  };
  if (equippedItems(cleaned).length > 0) return cleaned;
  return items.length > 0 ? createInventory(items) : starterInventory();
}
