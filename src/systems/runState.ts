/**
 * Run state: everything the player has gained during a run, split into what is
 * secured (banked at a checkpoint) and what is unsecured (gained since).
 * Dying discards the unsecured part, so reaching a checkpoint is what makes
 * gains safe. Stage progress follows the same rule: enemies defeated since the
 * last checkpoint come back on death.
 *
 * All functions are pure and return new objects; state is fully serializable.
 * Items, weapon advancements, and captured spirits join this state in later
 * milestones and follow the same secured/unsecured rule.
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
}

export function createRunState(): RunState {
  return {
    checkpointId: null,
    checkpointOrder: -1,
    secured: [],
    unsecured: [],
    securedDefeated: [],
    unsecuredDefeated: [],
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

function hasUnsecured(state: RunState): boolean {
  return state.unsecured.length > 0 || state.unsecuredDefeated.length > 0;
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
  return { ...state, unsecured: [], unsecuredDefeated: [] };
}

export function securedCount(state: RunState): number {
  return state.secured.length;
}

export function unsecuredCount(state: RunState): number {
  return state.unsecured.length;
}
