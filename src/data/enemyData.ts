import type { Element } from '../systems/combat';
import { findFamily, type CreatureRef } from './creatureData';
import { isElement } from './elementData';
import raw from './enemies.json';

export interface WalkerStats {
  behavior: 'walker';
  /** Null for an enemy with no element. */
  element: Element | null;
  /** The creature this enemy is; its spirit can be captured. Absent for enemies that cannot be captured. */
  creature?: CreatureRef;
  hp: number;
  /** Experience for defeating or capturing it. */
  xp: number;
  contactDamage: number;
  speed: number;
  patrolRange: number;
}

export interface TurretStats {
  behavior: 'turret';
  element: Element | null;
  creature?: CreatureRef;
  hp: number;
  xp: number;
  contactDamage: number;
  range: number;
  telegraphMs: number;
  fireIntervalMs: number;
  bulletSpeed: number;
}

export type EnemyStats = WalkerStats | TurretStats;

export interface BossPhaseStats {
  untilHpFraction: number;
  bullets: number;
  spreadDeg: number;
  cooldownMs: number;
  hop: boolean;
}

export interface BossStats {
  name: string;
  /** Family id in creatures.json this boss is drawn from. */
  family: string;
  element: Element | null;
  creature?: CreatureRef;
  hp: number;
  xp: number;
  contactDamage: number;
  activateRange: number;
  telegraphMs: number;
  bulletSpeed: number;
  hopSpeedX: number;
  hopSpeedY: number;
  /** How far the boss may move from where it was placed. */
  leash: number;
  phases: BossPhaseStats[];
}

// The JSON is the source of truth; this cast is checked by tests/enemyData.test.ts.
const data = raw as unknown as {
  enemies: Record<string, EnemyStats>;
  bosses: Record<string, BossStats>;
};

function checkElement<T extends { element: Element | null; creature?: CreatureRef }>(stats: T, kind: string): T {
  if (stats.creature) {
    const stage = stats.creature.stage;
    if (!findFamily(stats.creature.family) || (stage !== 1 && stage !== 2 && stage !== 3)) {
      throw new Error(`enemies.json: "${kind}": creature must name a family in creatures.json and a stage of 1, 2, or 3`);
    }
  }
  if (stats.element === undefined) return { ...stats, element: null };
  if (stats.element !== null && !isElement(stats.element)) {
    throw new Error(`enemies.json: "${kind}": unknown element "${String(stats.element)}"`);
  }
  return stats;
}

export function getEnemyStats(kind: string): EnemyStats {
  const stats = data.enemies[kind];
  if (!stats) throw new Error(`Unknown enemy kind "${kind}" (see src/data/enemies.json)`);
  return checkElement(stats, kind);
}

export function getBossStats(kind: string): BossStats {
  const stats = data.bosses[kind];
  if (!stats) throw new Error(`Unknown boss kind "${kind}" (see src/data/enemies.json)`);
  return checkElement(stats, kind);
}

export function enemyKinds(): string[] {
  return Object.keys(data.enemies);
}

export function bossKinds(): string[] {
  return Object.keys(data.bosses);
}
