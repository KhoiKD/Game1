import { describe, expect, it } from 'vitest';
import { addItem, createInventory } from '../src/systems/inventory';
import type { WeaponInstance } from '../src/systems/loot';
import {
  activateCheckpoint,
  collectPickup,
  createRunState,
  defeatEnemy,
  setInventory,
} from '../src/systems/runState';

const weapon = (uid: string): WeaponInstance => ({
  uid,
  baseId: 'pocket-sting',
  rarity: 'common',
  damageRoll: 1,
  perks: [],
});
import {
  SAVE_KEY,
  SAVE_VERSION,
  loadSave,
  parseSave,
  restoreRun,
  serializeRun,
  writeSave,
} from '../src/systems/save';

const validSave = {
  version: SAVE_VERSION,
  levelId: 'level1',
  checkpointId: 'cp-2',
  checkpointOrder: 2,
  secured: ['a', 'b'],
  defeated: ['enemy-01'],
  inventory: { items: [weapon('a')], equipped: ['a', null, null] },
  spirits: { spirits: [], equipped: {}, captures: {} },
};

describe('serializeRun / restoreRun', () => {
  it('returns null before any checkpoint is reached', () => {
    expect(serializeRun('level1', createRunState())).toBeNull();
  });

  it('round-trips the secured state and drops unsecured gains', () => {
    let run = activateCheckpoint(collectPickup(createRunState(), 'a'), 'cp-1', 1);
    run = collectPickup(run, 'unsecured-one');
    const save = serializeRun('level1', run);
    expect(save).not.toBeNull();
    const restored = restoreRun(save!);
    expect(restored.checkpointId).toBe('cp-1');
    expect(restored.secured).toEqual(['a']);
    expect(restored.unsecured).toEqual([]);
  });
});

describe('parseSave', () => {
  it('accepts a valid current-version save', () => {
    expect(parseSave(JSON.stringify(validSave))).toEqual(validSave);
  });

  it('returns null for missing, malformed, or non-object data', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('not json')).toBeNull();
    expect(parseSave('42')).toBeNull();
    expect(parseSave('null')).toBeNull();
  });

  it('migrates a version 1 save by adding an empty defeated list', () => {
    const v1 = { version: 1, levelId: 'level1', checkpointId: 'cp-1', checkpointOrder: 1, secured: ['a'] };
    expect(parseSave(JSON.stringify(v1))).toEqual({ ...v1, version: SAVE_VERSION, defeated: [], inventory: null, spirits: null });
  });

  it('migrates a version 2 save by adding an empty inventory slot', () => {
    const v2 = { version: 2, levelId: 'level1', checkpointId: 'cp-1', checkpointOrder: 1, secured: [], defeated: ['e'] };
    expect(parseSave(JSON.stringify(v2))).toEqual({ ...v2, version: SAVE_VERSION, inventory: null, spirits: null });
  });

  it('uses the fallback inventory when a migrated save has none', () => {
    const fallback = createInventory([weapon('starter')]);
    const run = restoreRun({ ...validSave, inventory: null }, fallback);
    expect(run.inventory).toBe(fallback);
    expect(run.securedInventory).toBe(fallback);
  });

  it('round-trips the banked inventory and drops unbanked weapons', () => {
    const start = createInventory([weapon('a'), weapon('b')]);
    let run = activateCheckpoint(createRunState(start), 'cp-1', 1);
    run = setInventory(run, addItem(run.inventory, weapon('found-later'))!);
    const save = JSON.parse(JSON.stringify(serializeRun('level1', run)));
    const restored = restoreRun(parseSave(JSON.stringify(save))!);
    expect(restored.inventory.items.map((i) => i.uid)).toEqual(['a', 'b']);
    expect(restored.inventory.equipped).toEqual(['a', 'b', null]);
  });

  it('rejects a save whose inventory is malformed', () => {
    const good = { items: [weapon('a')], equipped: ['a', null, null] };
    const withInventory = (inventory: unknown) => JSON.stringify({ ...validSave, inventory });
    expect(parseSave(withInventory(good))).not.toBeNull();
    expect(parseSave(withInventory({ ...good, equipped: ['a', null] }))).toBeNull();
    expect(parseSave(withInventory({ ...good, equipped: ['missing', null, null] }))).toBeNull();
    expect(parseSave(withInventory({ items: [{ uid: 'a' }], equipped: [null, null, null] }))).toBeNull();
    expect(parseSave(withInventory({ items: [weapon('a'), weapon('a')], equipped: [null, null, null] }))).toBeNull();
    expect(parseSave(withInventory(undefined))).toBeNull();
  });

  it('rejects a current-version save with a missing or invalid defeated list', () => {
    const { defeated: _omitted, ...withoutDefeated } = validSave;
    expect(parseSave(JSON.stringify(withoutDefeated))).toBeNull();
    expect(parseSave(JSON.stringify({ ...validSave, defeated: [3] }))).toBeNull();
  });

  it('round-trips banked enemy defeats and drops unbanked ones', () => {
    let run = activateCheckpoint(defeatEnemy(createRunState(), 'enemy-01'), 'cp-1', 1);
    run = defeatEnemy(run, 'enemy-02');
    const restored = restoreRun(serializeRun('level1', run)!);
    expect(restored.securedDefeated).toEqual(['enemy-01']);
    expect(restored.unsecuredDefeated).toEqual([]);
  });

  it('returns null for unknown versions', () => {
    expect(parseSave(JSON.stringify({ ...validSave, version: 999 }))).toBeNull();
  });

  it('returns null when required fields are missing or the wrong type', () => {
    expect(parseSave(JSON.stringify({ ...validSave, checkpointId: 7 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...validSave, secured: [1, 2] }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...validSave, checkpointOrder: 'x' }))).toBeNull();
  });
});

describe('storage helpers', () => {
  it('writes then loads through a storage object', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(writeSave(storage, validSave)).toBe(true);
    expect(store.has(SAVE_KEY)).toBe(true);
    expect(loadSave(storage)).toEqual(validSave);
  });

  it('never throws when storage is missing or failing', () => {
    const failing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(writeSave(null, validSave)).toBe(false);
    expect(writeSave(failing, validSave)).toBe(false);
    expect(loadSave(null)).toBeNull();
    expect(loadSave(failing)).toBeNull();
  });

  it('does not write when there is nothing to save', () => {
    const storage = { setItem: () => undefined };
    expect(writeSave(storage, null)).toBe(false);
  });
});
