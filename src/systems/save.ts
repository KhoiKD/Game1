import { EQUIP_SLOTS, createInventory, type Inventory } from './inventory';
import type { WeaponInstance } from './loot';
import type { RunState } from './runState';
import { emptyCollection, type Spirit, type SpiritCollection } from './spirits';

export const SAVE_KEY = 'tamerunner.save';
export const SAVE_VERSION = 5;

/** What the player keeps between stages. */
export interface Profile {
  /** Null until a class has been chosen. */
  classId: string | null;
  xp: number;
  inventory: Inventory;
  spirits: SpiritCollection;
  /** Highest tier cleared per stage id. */
  cleared: Record<string, number>;
}

/** A stage in progress, as it stood at the last checkpoint. */
export interface SavedRun {
  stageId: string;
  tier: number;
  checkpointId: string;
  checkpointOrder: number;
  secured: string[];
  defeated: string[];
}

export interface SaveData {
  version: number;
  profile: Profile;
  /** Null when the player is in the hub or has not reached a checkpoint yet. */
  run: SavedRun | null;
}

export function newProfile(inventory: Inventory): Profile {
  return { classId: null, xp: 0, inventory, spirits: emptyCollection(), cleared: {} };
}

/** The profile as banked by a run: only secured weapons, spirits, and experience carry over. */
export function profileFromRun(profile: Profile, run: RunState): Profile {
  return { ...profile, xp: run.securedXp, inventory: run.securedInventory, spirits: run.securedSpirits };
}

/** Records a cleared tier, keeping the highest. */
export function markCleared(profile: Profile, stageId: string, tier: number): Profile {
  if ((profile.cleared[stageId] ?? 0) >= tier) return profile;
  return { ...profile, cleared: { ...profile.cleared, [stageId]: tier } };
}

/** The resumable part of a run. Null before the first checkpoint: there is nothing to resume. */
export function savedRunFrom(stageId: string, tier: number, run: RunState): SavedRun | null {
  if (run.checkpointId === null) return null;
  return {
    stageId,
    tier,
    checkpointId: run.checkpointId,
    checkpointOrder: run.checkpointOrder,
    secured: [...run.secured],
    defeated: [...run.securedDefeated],
  };
}

export function buildSave(profile: Profile, run: SavedRun | null): SaveData {
  return { version: SAVE_VERSION, profile: copyProfile(profile), run: run ? copyRun(run) : null };
}

/** Starts or resumes a run from the profile. With a saved run, the player resumes at its checkpoint. */
export function runStateFrom(profile: Profile, saved: SavedRun | null): RunState {
  return {
    checkpointId: saved?.checkpointId ?? null,
    checkpointOrder: saved?.checkpointOrder ?? -1,
    secured: saved ? [...saved.secured] : [],
    unsecured: [],
    securedDefeated: saved ? [...saved.defeated] : [],
    unsecuredDefeated: [],
    inventory: profile.inventory,
    securedInventory: profile.inventory,
    spirits: profile.spirits,
    securedSpirits: profile.spirits,
    xp: profile.xp,
    securedXp: profile.xp,
  };
}

function copySpirits(collection: SpiritCollection): SpiritCollection {
  return {
    spirits: collection.spirits.map((spirit) => ({ ...spirit })),
    equipped: { ...collection.equipped },
    captures: { ...collection.captures },
  };
}

function copyInventory(inventory: Inventory): Inventory {
  return {
    items: inventory.items.map((item) => ({ ...item, perks: [...item.perks] })),
    equipped: [...inventory.equipped],
  };
}

function copyProfile(profile: Profile): Profile {
  return {
    classId: profile.classId,
    xp: profile.xp,
    inventory: copyInventory(profile.inventory),
    spirits: copySpirits(profile.spirits),
    cleared: { ...profile.cleared },
  };
}

function copyRun(run: SavedRun): SavedRun {
  return { ...run, secured: [...run.secured], defeated: [...run.defeated] };
}

/**
 * Migration hook. Each time the save schema changes, bump SAVE_VERSION and add
 * a case here that upgrades older versions. Unknown or invalid data yields null.
 * `starter` supplies weapons for saves that predate inventories.
 */
export function migrateSave(data: unknown, starter: Inventory = createInventory()): SaveData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version === 5) {
    return isProfile(d.profile) && (d.run === null || isSavedRun(d.run)) ? buildSave(d.profile, d.run) : null;
  }

  // Versions 1 to 4 stored one flat record for a single level.
  if (!hasLegacyFields(d)) return null;
  let defeated: string[] = [];
  let inventory: Inventory = starter;
  let spirits: SpiritCollection = emptyCollection();
  switch (d.version) {
    case 1:
      break; // no enemies yet
    case 2:
      if (!isStringArray(d.defeated)) return null;
      defeated = d.defeated;
      break;
    case 3:
      if (!isStringArray(d.defeated) || !isInventory(d.inventory)) return null;
      defeated = d.defeated;
      inventory = d.inventory;
      break;
    case 4:
      if (!isStringArray(d.defeated) || !isInventory(d.inventory) || !isSpiritCollection(d.spirits)) return null;
      defeated = d.defeated;
      inventory = d.inventory;
      spirits = d.spirits;
      break;
    default:
      return null;
  }
  // Older saves had no class, experience, or tiers: the player picks a class and resumes on tier 1.
  return buildSave(
    { classId: null, xp: 0, inventory, spirits, cleared: {} },
    { stageId: d.levelId, tier: 1, checkpointId: d.checkpointId, checkpointOrder: d.checkpointOrder, secured: d.secured, defeated },
  );
}

interface LegacyFields {
  levelId: string;
  checkpointId: string;
  checkpointOrder: number;
  secured: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasLegacyFields(d: Record<string, unknown>): d is Record<string, unknown> & LegacyFields {
  return (
    typeof d.levelId === 'string' &&
    typeof d.checkpointId === 'string' &&
    typeof d.checkpointOrder === 'number' &&
    Number.isFinite(d.checkpointOrder) &&
    isStringArray(d.secured)
  );
}

function isSavedRun(value: unknown): value is SavedRun {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.stageId === 'string' &&
    typeof v.tier === 'number' &&
    Number.isInteger(v.tier) &&
    v.tier >= 1 &&
    typeof v.checkpointId === 'string' &&
    typeof v.checkpointOrder === 'number' &&
    Number.isFinite(v.checkpointOrder) &&
    isStringArray(v.secured) &&
    isStringArray(v.defeated)
  );
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.classId !== null && typeof v.classId !== 'string') return false;
  if (!isCount(v.xp) || !isInventory(v.inventory) || !isSpiritCollection(v.spirits)) return false;
  if (typeof v.cleared !== 'object' || v.cleared === null || Array.isArray(v.cleared)) return false;
  return Object.values(v.cleared as Record<string, unknown>).every((tier) => isCount(tier) && Number.isInteger(tier));
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

function isSpirit(value: unknown): value is Spirit {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.familyId === 'string' &&
    (v.capturedStage === 1 || v.capturedStage === 2 || v.capturedStage === 3) &&
    isCount(v.growth) &&
    typeof v.perkMult === 'number' &&
    Number.isFinite(v.perkMult) &&
    v.perkMult > 0
  );
}

function isSpiritCollection(value: unknown): value is SpiritCollection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.spirits) || !v.spirits.every(isSpirit)) return false;
  const ids = new Set(v.spirits.map((spirit) => spirit.familyId));
  if (ids.size !== v.spirits.length) return false;
  if (typeof v.equipped !== 'object' || v.equipped === null || Array.isArray(v.equipped)) return false;
  const equipped = Object.values(v.equipped as Record<string, unknown>);
  if (!equipped.every((id) => typeof id === 'string' && ids.has(id))) return false;
  if (new Set(equipped).size !== equipped.length) return false;
  if (typeof v.captures !== 'object' || v.captures === null || Array.isArray(v.captures)) return false;
  return Object.values(v.captures as Record<string, unknown>).every((count) => isCount(count) && Number.isInteger(count));
}

export function parseSave(raw: string | null, starter?: Inventory): SaveData | null {
  if (raw === null) return null;
  try {
    return migrateSave(JSON.parse(raw), starter);
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

export function loadSave(storage: Pick<Storage, 'getItem'> | null, starter?: Inventory): SaveData | null {
  if (!storage) return null;
  try {
    return parseSave(storage.getItem(SAVE_KEY), starter);
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
