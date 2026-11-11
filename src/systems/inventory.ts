import type { WeaponInstance } from './loot';

/** Weapons the player owns and which of them are equipped. Pure and serializable. */
export const EQUIP_SLOTS = 3;
/** Total weapons the player can carry, equipped ones included. */
export const INVENTORY_CAPACITY = 20;

export interface Inventory {
  readonly items: readonly WeaponInstance[];
  /** Weapon uid per equip slot, or null for an empty slot. Always EQUIP_SLOTS long. */
  readonly equipped: readonly (string | null)[];
}

export function createInventory(items: readonly WeaponInstance[] = []): Inventory {
  const equipped: (string | null)[] = [];
  for (let slot = 0; slot < EQUIP_SLOTS; slot++) equipped.push(items[slot]?.uid ?? null);
  return { items: [...items], equipped };
}

export function isFull(inventory: Inventory): boolean {
  return inventory.items.length >= INVENTORY_CAPACITY;
}

export function isEquipped(inventory: Inventory, uid: string): boolean {
  return inventory.equipped.includes(uid);
}

/** Equipped weapons in slot order, skipping empty slots. */
export function equippedItems(inventory: Inventory): WeaponInstance[] {
  const items: WeaponInstance[] = [];
  for (const uid of inventory.equipped) {
    const item = uid === null ? undefined : inventory.items.find((i) => i.uid === uid);
    if (item) items.push(item);
  }
  return items;
}

/** Weapons that are carried but not equipped. */
export function backpackItems(inventory: Inventory): WeaponInstance[] {
  return inventory.items.filter((item) => !isEquipped(inventory, item.uid));
}

/**
 * Adds a weapon, putting it straight into an empty equip slot if there is one.
 * Returns null when the inventory is full or already holds that uid.
 */
export function addItem(inventory: Inventory, item: WeaponInstance): Inventory | null {
  if (isFull(inventory) || inventory.items.some((i) => i.uid === item.uid)) return null;
  const equipped = [...inventory.equipped];
  const emptySlot = equipped.indexOf(null);
  if (emptySlot !== -1) equipped[emptySlot] = item.uid;
  return { items: [...inventory.items, item], equipped };
}

/**
 * Equips a carried weapon in a slot. If it is already in another slot, the two
 * slots trade places. Returns the same inventory when nothing changes.
 */
export function equip(inventory: Inventory, uid: string, slot: number): Inventory {
  if (slot < 0 || slot >= EQUIP_SLOTS) return inventory;
  if (!inventory.items.some((item) => item.uid === uid)) return inventory;
  if (inventory.equipped[slot] === uid) return inventory;
  const equipped = [...inventory.equipped];
  const from = equipped.indexOf(uid);
  if (from !== -1) equipped[from] = equipped[slot] ?? null;
  equipped[slot] = uid;
  return { items: inventory.items, equipped };
}

/** Removes a backpack weapon for good. Equipped weapons cannot be discarded. */
export function discard(inventory: Inventory, uid: string): Inventory {
  if (isEquipped(inventory, uid) || !inventory.items.some((item) => item.uid === uid)) return inventory;
  return { items: inventory.items.filter((item) => item.uid !== uid), equipped: inventory.equipped };
}
