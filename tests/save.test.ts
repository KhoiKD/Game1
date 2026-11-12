import { describe, expect, it } from 'vitest';
import { getFamily, balance } from '../src/data/creatureData';
import { addItem, createInventory } from '../src/systems/inventory';
import type { WeaponInstance } from '../src/systems/loot';
import {
  activateCheckpoint,
  addXp,
  collectPickup,
  createRunState,
  defeatEnemy,
  die,
  setInventory,
  setSpirits,
} from '../src/systems/runState';
import {
  SAVE_KEY,
  SAVE_VERSION,
  buildSave,
  loadSave,
  markCleared,
  newProfile,
  parseSave,
  profileFromRun,
  runStateFrom,
  savedRunFrom,
  writeSave,
  type Profile,
} from '../src/systems/save';
import { captureSpirit, emptyCollection } from '../src/systems/spirits';

const weapon = (uid: string): WeaponInstance => ({ uid, baseId: 'pocket-sting', rarity: 'common', damageRoll: 1, perks: [] });
const twig = getFamily('verdant-stickinsect');
const starter = createInventory([weapon('starter-a'), weapon('starter-b')]);
const profile: Profile = {
  classId: 'vanguard',
  xp: 120,
  inventory: createInventory([weapon('a')]),
  spirits: captureSpirit(emptyCollection(), twig, 1, 1, balance).collection,
  cleared: { level1: 1 },
};
const savedRun = { stageId: 'level1', tier: 2, checkpointId: 'cp-2', checkpointOrder: 2, secured: ['p1'], defeated: ['enemy-01'] };
const json = (value: unknown) => JSON.stringify(value);

describe('profile and run', () => {
  it('starts a new profile with no class, no experience, and nothing cleared', () => {
    expect(newProfile(starter)).toEqual({ classId: null, xp: 0, inventory: starter, spirits: emptyCollection(), cleared: {} });
  });

  it('starts a fresh run from the profile', () => {
    const run = runStateFrom(profile, null);
    expect(run.checkpointId).toBeNull();
    expect(run.inventory).toBe(profile.inventory);
    expect(run.spirits).toBe(profile.spirits);
    expect(run.xp).toBe(120);
    expect(run.secured).toEqual([]);
  });

  it('resumes a saved run at its checkpoint with its banked progress', () => {
    const run = runStateFrom(profile, savedRun);
    expect(run).toMatchObject({ checkpointId: 'cp-2', checkpointOrder: 2, secured: ['p1'], securedDefeated: ['enemy-01'] });
    expect(run.unsecured).toEqual([]);
    expect(run.unsecuredDefeated).toEqual([]);
  });

  it('has nothing to resume before the first checkpoint', () => {
    expect(savedRunFrom('level1', 1, runStateFrom(profile, null))).toBeNull();
  });

  it('banks only secured weapons, spirits, and experience into the profile', () => {
    let run = activateCheckpoint(addXp(runStateFrom(profile, null), 30), 'cp-1', 1);
    run = addXp(run, 500);
    run = setInventory(run, addItem(run.inventory, weapon('unbanked'))!);
    run = setSpirits(run, captureSpirit(run.spirits, getFamily('volt-flytrap'), 1, 1, balance).collection);
    const banked = profileFromRun(profile, run);
    expect(banked.xp).toBe(150);
    expect(banked.inventory.items.map((i) => i.uid)).toEqual(['a']);
    expect(banked.spirits.spirits).toHaveLength(1);
    expect(banked.classId).toBe('vanguard');
    expect(banked.cleared).toEqual({ level1: 1 });
  });

  it('saves the run as it stood at the checkpoint', () => {
    let run = collectPickup(defeatEnemy(runStateFrom(profile, null), 'enemy-01'), 'p1');
    run = activateCheckpoint(run, 'cp-1', 1);
    run = defeatEnemy(collectPickup(run, 'p2'), 'enemy-02');
    expect(savedRunFrom('level1', 2, run)).toEqual({
      stageId: 'level1', tier: 2, checkpointId: 'cp-1', checkpointOrder: 1, secured: ['p1'], defeated: ['enemy-01'],
    });
  });

  it('records the highest cleared tier', () => {
    expect(markCleared(profile, 'level1', 2).cleared).toEqual({ level1: 2 });
    expect(markCleared(profile, 'level1', 1)).toBe(profile);
    expect(markCleared(profile, 'level2', 1).cleared).toEqual({ level1: 1, level2: 1 });
  });

  it('rolls experience back on death', () => {
    let run = activateCheckpoint(addXp(createRunState(), 40), 'cp-1', 1);
    run = addXp(run, 25);
    expect(run.xp).toBe(65);
    expect(die(run).xp).toBe(40);
    expect(addXp(run, 0)).toBe(run);
  });
});

describe('save round trip', () => {
  it('survives JSON with profile and run intact', () => {
    const save = buildSave(profile, savedRun);
    expect(save.version).toBe(SAVE_VERSION);
    expect(parseSave(json(save))).toEqual(save);
    expect(parseSave(json(buildSave(profile, null)))).toEqual(buildSave(profile, null));
  });

  it('copies data so later changes to the profile do not leak into the save', () => {
    const save = buildSave(profile, savedRun);
    expect(save.profile.inventory).not.toBe(profile.inventory);
    expect(save.run).not.toBe(savedRun);
  });

  it('returns null for missing, malformed, or unknown-version data', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('not json')).toBeNull();
    expect(parseSave('42')).toBeNull();
    expect(parseSave('null')).toBeNull();
    expect(parseSave(json({ ...buildSave(profile, null), version: 999 }))).toBeNull();
  });

  it('rejects a current-version save with bad fields', () => {
    const save = buildSave(profile, savedRun);
    const withProfile = (changes: object) => json({ ...save, profile: { ...save.profile, ...changes } });
    const withRun = (changes: object) => json({ ...save, run: { ...save.run, ...changes } });
    expect(parseSave(withProfile({ xp: -5 }))).toBeNull();
    expect(parseSave(withProfile({ classId: 7 }))).toBeNull();
    expect(parseSave(withProfile({ cleared: { level1: 'yes' } }))).toBeNull();
    expect(parseSave(withProfile({ inventory: { items: [weapon('a')], equipped: ['a', null] } }))).toBeNull();
    expect(parseSave(withProfile({ inventory: { items: [weapon('a'), weapon('a')], equipped: [null, null, null] } }))).toBeNull();
    expect(parseSave(withProfile({ spirits: { spirits: [], equipped: { u0: 'ghost' }, captures: {} } }))).toBeNull();
    expect(parseSave(withProfile({ spirits: { spirits: [{ familyId: 'x', capturedStage: 4, growth: 0, perkMult: 1 }], equipped: {}, captures: {} } }))).toBeNull();
    expect(parseSave(withRun({ tier: 0 }))).toBeNull();
    expect(parseSave(withRun({ defeated: [3] }))).toBeNull();
    expect(parseSave(json({ ...save, run: undefined }))).toBeNull();
  });
});

describe('migration from older saves', () => {
  const base = { levelId: 'level1', checkpointId: 'cp-1', checkpointOrder: 1, secured: ['p1'] };
  const inventory = { items: [weapon('kept')], equipped: ['kept', null, null] };
  const spirits = { spirits: [{ familyId: twig.id, capturedStage: 1, growth: 4, perkMult: 1 }], equipped: { u0: twig.id }, captures: { Verdant: 1 } };

  it('turns a version 1 save into a profile with starter weapons and a tier 1 run', () => {
    const save = parseSave(json({ version: 1, ...base }), starter)!;
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.profile).toEqual({ classId: null, xp: 0, inventory: starter, spirits: emptyCollection(), cleared: {} });
    expect(save.run).toEqual({ stageId: 'level1', tier: 1, checkpointId: 'cp-1', checkpointOrder: 1, secured: ['p1'], defeated: [] });
  });

  it('keeps defeated enemies from version 2', () => {
    const save = parseSave(json({ version: 2, ...base, defeated: ['enemy-01'] }), starter)!;
    expect(save.run!.defeated).toEqual(['enemy-01']);
    expect(save.profile.inventory).toEqual(starter);
  });

  it('keeps the inventory from version 3', () => {
    const save = parseSave(json({ version: 3, ...base, defeated: [], inventory }), starter)!;
    expect(save.profile.inventory).toEqual(inventory);
    expect(save.profile.spirits).toEqual(emptyCollection());
  });

  it('keeps inventory and spirits from version 4', () => {
    const save = parseSave(json({ version: 4, ...base, defeated: ['boss-01'], inventory, spirits }), starter)!;
    expect(save.profile.inventory).toEqual(inventory);
    expect(save.profile.spirits).toEqual(spirits);
    expect(save.profile.classId).toBeNull();
    expect(save.run!.defeated).toEqual(['boss-01']);
  });

  it('rejects older saves that are missing what their version requires', () => {
    expect(parseSave(json({ version: 2, ...base }))).toBeNull();
    expect(parseSave(json({ version: 3, ...base, defeated: [] }))).toBeNull();
    expect(parseSave(json({ version: 4, ...base, defeated: [], inventory }))).toBeNull();
    expect(parseSave(json({ version: 1, levelId: 'level1' }))).toBeNull();
  });
});

describe('storage helpers', () => {
  it('writes then loads through a storage object', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const save = buildSave(profile, savedRun);
    expect(writeSave(storage, save)).toBe(true);
    expect(store.has(SAVE_KEY)).toBe(true);
    expect(loadSave(storage)).toEqual(save);
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
    const save = buildSave(profile, null);
    expect(writeSave(null, save)).toBe(false);
    expect(writeSave(failing, save)).toBe(false);
    expect(loadSave(null)).toBeNull();
    expect(loadSave(failing)).toBeNull();
    expect(writeSave({ setItem: () => undefined }, null)).toBe(false);
  });
});
