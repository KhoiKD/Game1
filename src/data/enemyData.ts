import raw from './enemies.json';

export interface WalkerStats {
  behavior: 'walker';
  hp: number;
  contactDamage: number;
  speed: number;
  patrolRange: number;
}

export interface TurretStats {
  behavior: 'turret';
  hp: number;
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
  hp: number;
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

export function getEnemyStats(kind: string): EnemyStats {
  const stats = data.enemies[kind];
  if (!stats) throw new Error(`Unknown enemy kind "${kind}" (see src/data/enemies.json)`);
  return stats;
}

export function getBossStats(kind: string): BossStats {
  const stats = data.bosses[kind];
  if (!stats) throw new Error(`Unknown boss kind "${kind}" (see src/data/enemies.json)`);
  return stats;
}

export function enemyKinds(): string[] {
  return Object.keys(data.enemies);
}

export function bossKinds(): string[] {
  return Object.keys(data.bosses);
}
