import type { RunState } from './runState';

export const SAVE_KEY = 'tamerunner.save';
export const SAVE_VERSION = 2;

/** What persists between page loads: the run as it stood when last secured. */
export interface SaveData {
  version: number;
  levelId: string;
  checkpointId: string;
  checkpointOrder: number;
  secured: string[];
  /** Enemy ids whose defeat is banked (added in version 2). */
  defeated: string[];
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
  };
}

export function restoreRun(save: SaveData): RunState {
  return {
    checkpointId: save.checkpointId,
    checkpointOrder: save.checkpointOrder,
    secured: [...save.secured],
    unsecured: [],
    securedDefeated: [...save.defeated],
    unsecuredDefeated: [],
  };
}

/**
 * Migration hook. Each time the save schema changes, bump SAVE_VERSION and add
 * a case here that upgrades older versions. Unknown or invalid data yields null.
 */
export function migrateSave(data: unknown): SaveData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.version) {
    case 1:
      // v1 had no enemies, so nothing was defeated.
      return hasBaseFields(d) ? toSaveData(d, []) : null;
    case 2:
      return hasBaseFields(d) && isStringArray(d.defeated) ? toSaveData(d, d.defeated) : null;
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

function toSaveData(d: BaseFields, defeated: string[]): SaveData {
  return {
    version: SAVE_VERSION,
    levelId: d.levelId,
    checkpointId: d.checkpointId,
    checkpointOrder: d.checkpointOrder,
    secured: [...d.secured],
    defeated: [...defeated],
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
