import type { Element } from '../systems/combat';
import type { Stage } from '../systems/spiritStats';
import { findFamily, getFamily, type CreatureRef } from './creatureData';
import raw from './enemies.json';

/**
 * Enemies are creatures. enemies.json gives each behavior its base numbers,
 * says which behavior each creature family uses, and scales everything by
 * evolution stage. A level names an enemy by family id, optionally with a
 * starting stage ("verdant-oak@2"); the tier being played can raise the stage.
 */
export const BEHAVIORS = ['walker', 'turret', 'hopper', 'flyer', 'charger', 'lobber'] as const;
export type Behavior = (typeof BEHAVIORS)[number];
export const BOSS_PATTERNS = ['aimed', 'ring', 'rain'] as const;
export type BossPattern = (typeof BOSS_PATTERNS)[number];

interface CommonStats {
  element: Element | null;
  /** The creature this enemy is; its spirit can be captured. */
  creature: CreatureRef;
  /** Name of the drop table rolled when it is defeated. */
  dropTable: string;
  hp: number;
  /** Experience for defeating or capturing it. */
  xp: number;
  contactDamage: number;
  /** Sprite scale; later evolution stages are bigger. */
  size: number;
}
export interface WalkerStats extends CommonStats { behavior: 'walker'; speed: number; patrolRange: number }
export interface TurretStats extends CommonStats { behavior: 'turret'; range: number; telegraphMs: number; fireIntervalMs: number; bulletSpeed: number }
export interface HopperStats extends CommonStats { behavior: 'hopper'; range: number; telegraphMs: number; hopIntervalMs: number; hopSpeedX: number; hopSpeedY: number; leash: number }
export interface FlyerStats extends CommonStats { behavior: 'flyer'; speed: number; patrolRange: number; bobHeight: number; range: number; telegraphMs: number; fireIntervalMs: number; bulletSpeed: number }
export interface ChargerStats extends CommonStats { behavior: 'charger'; speed: number; patrolRange: number; range: number; telegraphMs: number; chargeSpeed: number; chargeMs: number; restMs: number; leash: number }
export interface LobberStats extends CommonStats { behavior: 'lobber'; range: number; telegraphMs: number; fireIntervalMs: number; flightMs: number; gravity: number }
export type EnemyStats = WalkerStats | TurretStats | HopperStats | FlyerStats | ChargerStats | LobberStats;

export interface BossPhaseStats {
  untilHpFraction: number;
  /** aimed: a fan toward the player. ring: evenly in all directions. rain: a line falling from above the player. */
  pattern: BossPattern;
  bullets: number;
  /** Angle between neighbouring shots of an aimed volley. */
  spreadDeg: number;
  cooldownMs: number;
  hop: boolean;
}

export interface BossStats {
  name: string;
  /** Family id in creatures.json this boss is drawn from. Bosses are always the stage 3 form. */
  family: string;
  element: Element | null;
  creature: CreatureRef;
  dropTable: string;
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

type Scaling = Record<'hp' | 'xp' | 'contactDamage' | 'speed' | 'cooldown' | 'size', [number, number, number]>;
interface RawData {
  stageScaling: Scaling;
  behaviors: Record<Behavior, Record<string, number>>;
  creatures: Record<string, { behavior: Behavior; overrides?: Record<string, number> }>;
  bosses: Record<string, Omit<BossStats, 'element' | 'creature' | 'dropTable'>>;
}

const SPEED_FIELDS = ['speed', 'chargeSpeed', 'hopSpeedX', 'bulletSpeed'];
const COOLDOWN_FIELDS = ['fireIntervalMs', 'hopIntervalMs', 'restMs'];

/** Checks enemies.json at load. */
export function validateEnemies(input: unknown): RawData {
  const d = input as RawData;
  if (!d?.stageScaling || !d.behaviors || !d.creatures || !d.bosses) throw new Error('enemies.json: a required section is missing');
  for (const [key, values] of Object.entries(d.stageScaling)) {
    if (!Array.isArray(values) || values.length !== 3 || values.some((v) => typeof v !== 'number' || v <= 0)) {
      throw new Error(`enemies.json: stageScaling "${key}" needs three positive values`);
    }
  }
  for (const behavior of BEHAVIORS) {
    const base = d.behaviors[behavior];
    if (!base) throw new Error(`enemies.json: missing behavior "${behavior}"`);
    for (const [field, value] of Object.entries(base)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`enemies.json: behavior "${behavior}": bad ${field}`);
    }
    for (const field of ['hp', 'xp', 'contactDamage']) if (base[field] === undefined) throw new Error(`enemies.json: behavior "${behavior}" needs ${field}`);
  }
  for (const [familyId, entry] of Object.entries(d.creatures)) {
    if (!findFamily(familyId)) throw new Error(`enemies.json: creature "${familyId}" is not a family in creatures.json`);
    if (!BEHAVIORS.includes(entry.behavior)) throw new Error(`enemies.json: creature "${familyId}": unknown behavior "${String(entry.behavior)}"`);
    for (const field of Object.keys(entry.overrides ?? {})) {
      if (d.behaviors[entry.behavior][field] === undefined) throw new Error(`enemies.json: creature "${familyId}": "${field}" is not a ${entry.behavior} stat`);
    }
  }
  for (const [kind, boss] of Object.entries(d.bosses)) {
    const where = `enemies.json: boss "${kind}"`;
    if (!boss.name || !findFamily(boss.family)) throw new Error(`${where}: needs a name and a family from creatures.json`);
    if (!(boss.hp > 0) || !(boss.xp > 0) || !(boss.telegraphMs > 0) || !(boss.bulletSpeed > 0)) throw new Error(`${where}: bad numbers`);
    if (!Array.isArray(boss.phases) || boss.phases.length < 2) throw new Error(`${where}: needs at least two phases`);
    boss.phases.forEach((phase, i) => {
      if (!BOSS_PATTERNS.includes(phase.pattern)) throw new Error(`${where}: phase ${i + 1}: unknown pattern "${String(phase.pattern)}"`);
      if (!(phase.bullets >= 1) || !(phase.cooldownMs > 0)) throw new Error(`${where}: phase ${i + 1}: bad numbers`);
      const previous = boss.phases[i - 1];
      if (previous && phase.untilHpFraction >= previous.untilHpFraction) throw new Error(`${where}: phase thresholds must descend`);
    });
    if (boss.phases[boss.phases.length - 1]!.untilHpFraction !== 0) throw new Error(`${where}: the last phase must run to 0 health`);
  }
  return d;
}

const data = validateEnemies(raw);

/** Splits "family@2" into its family id and starting stage (1 when absent). */
export function parseKind(kind: string): CreatureRef {
  const [family, stageText] = kind.split('@');
  const stage = stageText === undefined ? 1 : Number(stageText);
  if (!family || (stage !== 1 && stage !== 2 && stage !== 3)) throw new Error(`Bad enemy kind "${kind}": use a family id, optionally with @2 or @3`);
  return { family, stage };
}

/**
 * Stats for an enemy named by family id (optionally "family@stage").
 * `stageBonus` comes from the tier being played and raises the stage, up to 3.
 */
export function getEnemyStats(kind: string, stageBonus = 0): EnemyStats {
  const ref = parseKind(kind);
  const entry = data.creatures[ref.family];
  if (!entry) throw new Error(`Unknown enemy kind "${kind}" (see "creatures" in src/data/enemies.json)`);
  const family = getFamily(ref.family);
  const stage = Math.min(3, ref.stage + Math.max(0, stageBonus)) as Stage;
  const scale = (key: keyof Scaling): number => data.stageScaling[key][stage - 1]!;

  const stats: Record<string, number> = { ...data.behaviors[entry.behavior], ...(entry.overrides ?? {}) };
  stats.hp = stats.hp! * scale('hp');
  stats.xp = Math.round(stats.xp! * scale('xp'));
  stats.contactDamage = Math.round(stats.contactDamage! * scale('contactDamage'));
  for (const field of SPEED_FIELDS) if (stats[field] !== undefined) stats[field] = stats[field] * scale('speed');
  for (const field of COOLDOWN_FIELDS) if (stats[field] !== undefined) stats[field] = stats[field] * scale('cooldown');

  return {
    ...stats,
    behavior: entry.behavior,
    element: family.elements[0] ?? null,
    creature: { family: ref.family, stage },
    dropTable: family.rarity,
    size: scale('size'),
  } as unknown as EnemyStats; // the behavior's own fields come from the validated JSON
}

/** Boss stats. `hpMult` comes from the tier being played. */
export function getBossStats(kind: string, hpMult = 1): BossStats {
  const boss = data.bosses[kind];
  if (!boss) throw new Error(`Unknown boss kind "${kind}" (see "bosses" in src/data/enemies.json)`);
  return {
    ...boss,
    hp: boss.hp * hpMult,
    element: getFamily(boss.family).elements[0] ?? null,
    creature: { family: boss.family, stage: 3 },
    dropTable: 'boss',
  };
}

/** Family ids that can appear as enemies. */
export function enemyKinds(): string[] {
  return Object.keys(data.creatures);
}

export function bossKinds(): string[] {
  return Object.keys(data.bosses);
}

export function behaviorOf(familyId: string): Behavior | null {
  return data.creatures[familyId]?.behavior ?? null;
}
