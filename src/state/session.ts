import { findFamily } from '../data/creatureData';
import { sanitizeInventory, starterInventory } from '../data/lootData';
import { findClass, progression } from '../data/progressionData';
import {
  buildSave,
  clearSave,
  getStorage,
  loadSave,
  newProfile,
  writeSave,
  type Profile,
  type SavedRun,
} from '../systems/save';
import { sanitizeCollection } from '../systems/spirits';

/**
 * The game in memory: the player's profile and the stage in progress, if any.
 * Scenes read and update it here and call saveSession() to write it to storage.
 */
export interface Session {
  profile: Profile;
  run: SavedRun | null;
}

let current: Session | null = null;

/** Loads the save, dropping anything that refers to data that no longer exists. */
function load(): Session {
  const save = loadSave(getStorage(), starterInventory());
  if (!save) return { profile: newProfile(starterInventory()), run: null };
  const profile: Profile = {
    ...save.profile,
    classId: findClass(save.profile.classId) ? save.profile.classId : null,
    inventory: sanitizeInventory(save.profile.inventory),
    spirits: sanitizeCollection(save.profile.spirits, findFamily),
  };
  const run = save.run;
  const runIsPlayable =
    run !== null && progression.stages.some((s) => s.id === run.stageId) && progression.tiers.some((t) => t.tier === run.tier);
  return { profile, run: runIsPlayable ? run : null };
}

export function getSession(): Session {
  if (!current) current = load();
  return current;
}

export function setProfile(profile: Profile): void {
  getSession().profile = profile;
}

export function setRun(run: SavedRun | null): void {
  getSession().run = run;
}

export function saveSession(): void {
  const session = getSession();
  writeSave(getStorage(), buildSave(session.profile, session.run));
}

/** Erases the save and starts over with a fresh profile. */
export function resetSession(): void {
  clearSave(getStorage());
  current = { profile: newProfile(starterInventory()), run: null };
}
