import { createInventory, type Inventory } from './inventory';
import { emptyCollection, type SpiritCollection } from './spirits';

/**
 * Run state: everything the player has gained during a run, split into what is
 * secured (banked at a checkpoint) and what is unsecured (gained since).
 * Dying discards the unsecured part, so reaching a checkpoint is what makes
 * gains safe. Stage progress follows the same rule: enemies defeated since the
 * last checkpoint come back on death.
 *
 * The inventory uses a snapshot: `securedInventory` is the inventory as it
 * stood when last banked, and death restores it. That rolls back weapons picked
 * up, weapons discarded, and loadout changes alike. Captured spirits work the
 * same way through `securedSpirits`.
 *
 * All functions are pure and return new objects; state is fully serializable.
 * Weapon advancements join this state in a later milestone and follow the same rule.
 */
export interface RunState {
  readonly checkpointId: string | null;
  /** Order index of the latest checkpoint; -1 when none has been reached. */
  readonly checkpointOrder: number;
  /** Pickup ids banked at the last checkpoint. Survive death. */
  readonly secured: readonly string[];
  /** Pickup ids gathered since the last checkpoint. Lost on death. */
  readonly unsecured: readonly string[];
  /** Enemy ids whose defeat is banked. They stay defeated after death. */
  readonly securedDefeated: readonly string[];
  /** Enemy ids defeated since the last checkpoint. They respawn on death. */
  readonly unsecuredDefeated: readonly string[];
  /** Weapons carried right now. */
  readonly inventory: Inventory;
  /** The inventory as last banked. Death restores it. */
  readonly securedInventory: Inventory;
  /** Captured spirits, their growth, and which are equipped. */
  readonly spirits: SpiritCollection;
  /** The spirits as last banked. Death restores them. */
  readonly securedSpirits: SpiritCollection;
  /** Experience earned in total. */
  readonly xp: number;
  /** Experience as last banked. Death restores it. */
  readonly securedXp: number;
}

export function createRunState(
  inventory: Inventory = createInventory(),
  spirits: SpiritCollection = emptyCollection(),
  xp = 0,
): RunState {
  return {
    checkpointId: null,
    checkpointOrder: -1,
    secured: [],
    unsecured: [],
    securedDefeated: [],
    unsecuredDefeated: [],
    inventory,
    securedInventory: inventory,
    spirits,
    securedSpirits: spirits,
    xp,
    securedXp: xp,
  };
}

export function hasCollected(state: RunState, id: string): boolean {
  return state.secured.includes(id) || state.unsecured.includes(id);
}

export function collectPickup(state: RunState, id: string): RunState {
  if (hasCollected(state, id)) return state;
  return { ...state, unsecured: [...state.unsecured, id] };
}

export function isDefeated(state: RunState, id: string): boolean {
  return state.securedDefeated.includes(id) || state.unsecuredDefeated.includes(id);
}

export function defeatEnemy(state: RunState, id: string): RunState {
  if (isDefeated(state, id)) return state;
  return { ...state, unsecuredDefeated: [...state.unsecuredDefeated, id] };
}

/** Replaces the carried inventory (pickup, equip, discard). Unsecured until banked. */
export function setInventory(state: RunState, inventory: Inventory): RunState {
  if (inventory === state.inventory) return state;
  return { ...state, inventory };
}

/** Replaces the spirit collection (capture, growth, equip). Unsecured until banked. */
export function setSpirits(state: RunState, spirits: SpiritCollection): RunState {
  if (spirits === state.spirits) return state;
  return { ...state, spirits };
}

/** Adds experience. Unsecured until banked. */
export function addXp(state: RunState, amount: number): RunState {
  if (amount <= 0) return state;
  return { ...state, xp: state.xp + amount };
}

function hasUnsecured(state: RunState): boolean {
  return (
    state.unsecured.length > 0 ||
    state.unsecuredDefeated.length > 0 ||
    state.inventory !== state.securedInventory ||
    state.spirits !== state.securedSpirits ||
    state.xp !== state.securedXp
  );
}

/** Bank everything unsecured without changing the respawn point (used on stage clear). */
export function secureAll(state: RunState): RunState {
  if (!hasUnsecured(state)) return state;
  return {
    ...state,
    secured: [...state.secured, ...state.unsecured],
    unsecured: [],
    securedDefeated: [...state.securedDefeated, ...state.unsecuredDefeated],
    unsecuredDefeated: [],
    securedInventory: state.inventory,
    securedSpirits: state.spirits,
    securedXp: state.xp,
  };
}

/**
 * Activate a checkpoint: bank all unsecured gains and make it the respawn point.
 * Checkpoints earlier than the current one are ignored so backtracking never
 * moves the respawn point backwards. Reactivating the current checkpoint banks
 * new gains. Returns the same object when nothing changes.
 */
export function activateCheckpoint(state: RunState, id: string, order: number): RunState {
  if (order < state.checkpointOrder) return state;
  if (id === state.checkpointId && !hasUnsecured(state)) return state;
  return { ...secureAll(state), checkpointId: id, checkpointOrder: order };
}

/** Death: roll back everything gained since the last checkpoint. */
export function die(state: RunState): RunState {
  if (!hasUnsecured(state)) return state;
  return {
    ...state,
    unsecured: [],
    unsecuredDefeated: [],
    inventory: state.securedInventory,
    spirits: state.securedSpirits,
    xp: state.securedXp,
  };
}

export function securedCount(state: RunState): number {
  return state.secured.length;
}

export function unsecuredCount(state: RunState): number {
  return state.unsecured.length;
}

/** Weapons carried now that were not in the last banked inventory. */
export function unsecuredWeaponCount(state: RunState): number {
  if (state.inventory === state.securedInventory) return 0;
  const banked = new Set(state.securedInventory.items.map((item) => item.uid));
  return state.inventory.items.filter((item) => !banked.has(item.uid)).length;
}

/** Spirits captured since the last bank: they are lost on death. */
export function unsecuredSpiritCount(state: RunState): number {
  if (state.spirits === state.securedSpirits) return 0;
  const banked = new Set(state.securedSpirits.spirits.map((spirit) => spirit.familyId));
  return state.spirits.spirits.filter((spirit) => !banked.has(spirit.familyId)).length;
}
