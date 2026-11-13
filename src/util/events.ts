import type { WeaponElement } from '../data/weaponData';

/**
 * A small typed event bus. Gameplay code announces what happened; audio and
 * visual feedback listen. Listeners never change game state.
 */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);
    return () => set.delete(listener as (payload: never) => void);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (p: Events[K]) => void)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** A position in the world, so feedback can pan and place itself. */
export interface At {
  x: number;
  y: number;
}

/** Everything that happens in a stage that feedback might react to. */
export interface GameEvents extends Record<string, unknown> {
  shot: At & { archetype: string; element: WeaponElement };
  enemyHit: At & { element: WeaponElement; crit: boolean; effect: 'strong' | 'resisted' | 'neutral' };
  weakened: At & { boss: boolean };
  captured: At & { element: WeaponElement; boss: boolean };
  defeated: At & { element: WeaponElement | null; boss: boolean };
  explosion: At & { radius: number; element: WeaponElement };
  playerHurt: At & { hpLeft: number };
  playerDied: At;
  checkpoint: At;
  pickup: At;
  lootPickup: At & { rarity: string };
  telegraph: At & { boss: boolean };
  bossPhase: At & { phase: number };
  stageClear: At;
  ability: At & { kind: string };
  reload: At;
  swap: At;
  /** A stage starts or the scene changes: which music should play. */
  music: { track: string };
}

/** The game's one event bus. */
export const gameEvents = new EventBus<GameEvents>();
