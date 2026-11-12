import type { Rarity } from '../data/weaponData';
import { EQUIP_SLOTS, equippedItems, type Inventory } from './inventory';
import type { PlayerBonuses } from './spirits';

/**
 * Player progression: experience and levels, the Power score that gates harder
 * tiers of a stage, and what a class and level add to the player. Pure; the
 * numbers come from progression.json and classes.json.
 */
export interface TierRule {
  tier: number;
  name: string;
  /** Power the player needs before this tier can be started. */
  requiredPower: number;
  enemyHpMult: number;
  xpMult: number;
}

export interface StageDef {
  id: string;
  name: string;
  /** Tilemap key. */
  map: string;
  blurb: string;
}

export interface ProgressionRules {
  /** Experience to go from level L to L+1 is base x L. */
  xp: { base: number; maxLevel: number };
  perLevel: { damage: number; hpEvery: number };
  weaponPower: Record<Rarity, number>;
  tiers: TierRule[];
  stages: StageDef[];
}

export const CLASS_EFFECTS = ['guard', 'dash', 'stasis'] as const;
export type ClassEffect = (typeof CLASS_EFFECTS)[number];

export interface ClassDef {
  name: string;
  summary: string;
  passive: {
    maxHp: number;
    moveSpeedMult: number;
    reloadMult: number;
    statusBuildupMult: number;
    /** Multiplies the cooldown of the equipped spirit's ability. */
    spiritCooldownMult: number;
  };
  passiveText: string;
  /** Weapon archetypes this class deals extra damage with. */
  affinity: { archetypes: string[]; damage: number };
  ability: {
    name: string;
    effect: ClassEffect;
    cooldownMs: number;
    description: string;
    durationMs?: number;
    speed?: number;
    radius?: number;
  };
}

// ---- experience and levels ------------------------------------------------

/** Total experience needed to reach a level. Level 1 needs none. */
export function xpForLevel(level: number, rules: ProgressionRules): number {
  const l = Math.max(1, Math.min(level, rules.xp.maxLevel));
  return (rules.xp.base * (l - 1) * l) / 2;
}

export function levelForXp(xp: number, rules: ProgressionRules): number {
  let level = 1;
  while (level < rules.xp.maxLevel && xp >= xpForLevel(level + 1, rules)) level += 1;
  return level;
}

/** Progress through the current level, for an experience bar. */
export function levelProgress(xp: number, rules: ProgressionRules): { level: number; into: number; needed: number } {
  const level = levelForXp(xp, rules);
  if (level >= rules.xp.maxLevel) return { level, into: 0, needed: 0 };
  const floor = xpForLevel(level, rules);
  return { level, into: xp - floor, needed: xpForLevel(level + 1, rules) - floor };
}

// ---- power and tiers ------------------------------------------------------

/**
 * Power: the average strength of the three weapon slots (an empty slot counts
 * as zero) plus the player's level. Rarer weapons are worth more.
 */
export function powerScore(inventory: Inventory, level: number, rules: ProgressionRules): number {
  const total = equippedItems(inventory).reduce((sum, item) => sum + rules.weaponPower[item.rarity], 0);
  return Math.round(total / EQUIP_SLOTS) + level;
}

export function tierRule(tier: number, rules: ProgressionRules): TierRule {
  const rule = rules.tiers.find((t) => t.tier === tier);
  if (!rule) throw new Error(`Unknown tier ${tier} (see src/data/progression.json)`);
  return rule;
}

export type TierStatus = 'open' | 'needs-power' | 'needs-clear';

/** A tier opens when the tier below it is cleared and the player's Power is high enough. */
export function tierStatus(tier: number, power: number, highestCleared: number, rules: ProgressionRules): TierStatus {
  if (tier > 1 && highestCleared < tier - 1) return 'needs-clear';
  return power >= tierRule(tier, rules).requiredPower ? 'open' : 'needs-power';
}

// ---- what class and level add --------------------------------------------

/** Folds the class passive, class weapon affinity, and level bonuses into the spirit bonuses. */
export function withClassAndLevel(
  bonuses: PlayerBonuses,
  classDef: ClassDef | null,
  level: number,
  rules: ProgressionRules,
): PlayerBonuses {
  const levels = Math.max(0, level - 1);
  const levelHp = rules.perLevel.hpEvery > 0 ? Math.floor(level / rules.perLevel.hpEvery) : 0;
  const passive = classDef?.passive;
  return {
    ...bonuses,
    damageMult: bonuses.damageMult * (1 + levels * rules.perLevel.damage),
    maxHpBonus: bonuses.maxHpBonus + levelHp + (passive?.maxHp ?? 0),
    moveSpeedMult: bonuses.moveSpeedMult * (passive?.moveSpeedMult ?? 1),
    reloadMult: bonuses.reloadMult * (passive?.reloadMult ?? 1),
    cooldownMult: bonuses.cooldownMult * (passive?.spiritCooldownMult ?? 1),
    statusBuildupMult: bonuses.statusBuildupMult * (passive?.statusBuildupMult ?? 1),
    archetypeAffinity: classDef ? [...classDef.affinity.archetypes] : [],
    archetypeDamage: classDef?.affinity.damage ?? 0,
  };
}
