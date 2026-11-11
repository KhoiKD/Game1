import { EQUIP_SLOTS, createInventory, type Inventory } from './inventory';
import type { WeaponInstance } from './loot';
import type { RunState } from './runState';

export const SAVE_KEY = 'tamerunner.save';
export const SAVE_VERSION = 3;

/** What persists between page loads: the run as it stood when last secured. */
export interface SaveData {
  version: number;
  levelId: string;
  checkpointId: string;
  checkpointOrder: number;
  secured: string[];
  /** Enemy ids whose defeat is banked (added in version 2). */
  defeated: string[];
  /** Banked inventory (added in version 3). Null in saves migrated from older versions. */
  inventory: Inventory | null;
}

/** Returns null before the first checkpoint: there is nothing to resume yet. */
export function serializeRun(levelId: string, run: RunState): SaveData | null {
  if (run.checkpointId === null) return null;
  return {
    version: SAVE_VERSION,
    levelId,
    checkpointId: run.checkpointId,
    checkpointOrder: run.checkpointOrder,
    secured: [...run.secured],
    defeated: [...run.securedDefeated],
    inventory: copyInventory(run.securedInventory),
  };
}

/** `fallbackInventory` is used for saves that predate inventories. */
export function restoreRun(save: SaveData, fallbackInventory: Inventory = createInventory()): RunState {
  const inventory = save.inventory ? copyInventory(save.inventory) : fallbackInventory;
  return {
    checkpointId: save.checkpointId,
    checkpointOrder: save.checkpointOrder,
    secured: [...save.secured],
    unsecured: [],
    securedDefeated: [...save.defeated],
    unsecuredDefeated: [],
    inventory,
    securedInventory: inventory,
  };
}

function copyInventory(inventory: Inventory): Inventory {
  return {
    items: inventory.items.map((item) => ({ ...item, perks: [...item.perks] })),
    equipped: [...inventory.equipped],
  };
}

/**
 * Migration hook. Each time the save schema changes, bump SAVE_VERSION and add
 * a case here that upgrades older versions. Unknown or invalid data yields null.
 */
export function migrateSave(data: unknown): SaveData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!hasBaseFields(d)) return null;
  switch (d.version) {
    case 1:
      // v1 had no enemies, so nothing was defeated.
      return toSaveData(d, [], null);
    case 2:
      // v2 had no inventory; the game supplies the starter weapons on restore.
      return isStringArray(d.defeated) ? toSaveData(d, d.defeated, null) : null;
    case 3:
      return isStringArray(d.defeated) && isInventory(d.inventory) ? toSaveData(d, d.defeated, d.inventory) : null;
    default:
      return null;
  }
}

interface BaseFields {
  levelId: string;
  checkpointId: string;
  checkpointOrder: number;
  secured: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasBaseFields(d: Record<string, unknown>): d is Record<string, unknown> & BaseFields {
  return (
    typeof d.levelId === 'string' &&
    typeof d.checkpointId === 'string' &&
    typeof d.checkpointOrder === 'number' &&
    Number.isFinite(d.checkpointOrder) &&
    isStringArray(d.secured)
  );
}

function isWeaponInstance(value: unknown): value is WeaponInstance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uid === 'string' &&
    typeof v.baseId === 'string' &&
    typeof v.rarity === 'string' &&
    typeof v.damageRoll === 'number' &&
    Number.isFinite(v.damageRoll) &&
    v.damageRoll > 0 &&
    isStringArray(v.perks)
  );
}

function isInventory(value: unknown): value is Inventory {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items) || !v.items.every(isWeaponInstance)) return false;
  if (!Array.isArray(v.equipped) || v.equipped.length !== EQUIP_SLOTS) return false;
  const uids = new Set(v.items.map((item) => item.uid));
  if (uids.size !== v.items.length) return false;
  return v.equipped.every((uid) => uid === null || (typeof uid === 'string' && uids.has(uid)));
}

function toSaveData(d: BaseFields, defeated: string[], inventory: Inventory | null): SaveData {
  return {
    version: SAVE_VERSION,
    levelId: d.levelId,
    checkpointId: d.checkpointId,
    checkpointOrder: d.checkpointOrder,
    secured: [...d.secured],
    defeated: [...defeated],
    inventory: inventory ? copyInventory(inventory) : null,
  };
}

export function parseSave(raw: string | null): SaveData | null {
  if (raw === null) return null;
  try {
    return migrateSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage can be blocked (private mode, sandboxed iframes)
  }
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null): SaveData | null {
  if (!storage) return null;
  try {
    return parseSave(storage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

/** Returns true when the data was written. Never throws. */
export function writeSave(storage: Pick<Storage, 'setItem'> | null, data: SaveData | null): boolean {
  if (!storage || !data) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // quota exceeded or storage blocked; the game keeps running
  }
}

export function clearSave(storage: Pick<Storage, 'removeItem'> | null): void {
  try {
    storage?.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
