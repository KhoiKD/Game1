import type { Rarity } from '../data/weaponData';
import type { Element } from './combat';

/**
 * Spirit stat balancing. A spirit's stats come from a formula, never from
 * hand-entered numbers:
 *
 *   stat = roleBase[stat] x rarityMult x stageMult x elementTilt[element][stat]
 *
 * Role sets the shape, rarity and evolution stage set the size, and element
 * tilts the shape without changing the total. All numbers live in balance.json.
 */
export const SPIRIT_STATS = ['power', 'vitality', 'agility', 'focus'] as const;
export type SpiritStat = (typeof SPIRIT_STATS)[number];
export type SpiritStatBlock = Record<SpiritStat, number>;

export const ABILITY_EFFECTS = ['burst', 'bolt', 'shield', 'heal', 'field'] as const;
export type AbilityEffect = (typeof ABILITY_EFFECTS)[number];

export type Stage = 1 | 2 | 3;

export interface Balance {
  roleBase: Record<string, SpiritStatBlock>;
  rarityMult: Record<Rarity, number>;
  /** Multiplier for stage 1, 2, and 3. */
  stageMult: [number, number, number];
  elementTilt: Record<Element, SpiritStatBlock>;
  boss: { perkMult: number; perStageLevel: number };
  growth: {
    base: number;
    rarity: Record<Rarity, number>;
    stage: [number, number, number];
    /** Growth points per spirit level. */
    perLevel: number;
    /** Growth each equipped spirit gains per kill. */
    killXp: number;
    maxLevel: number;
  };
  capture: { windowMs: Record<Rarity, number>; bossWindowMs: number; range: number; bossRange: number };
  slots: { universal: number; attunementThresholds: number[] };
  perks: {
    damagePerPower: number;
    hpPerVitality: number;
    speedPerAgility: number;
    reloadPerAgility: number;
    maxReloadReduction: number;
    critPerFocus: number;
    cooldownPerFocus: number;
    maxCooldownReduction: number;
    affinityDamage: number;
  };
  abilities: {
    cooldownMs: number;
    byRole: Record<string, AbilityEffect>;
    burst: { radius: number; damagePerPower: number };
    bolt: { damagePerPower: number; speed: number; range: number; pierce: number };
    shield: { baseMs: number; msPerVitality: number };
    heal: { baseHp: number; hpPerVitality: number };
    field: { radius: number; damage: number };
  };
}

export interface SpiritStatInput {
  role: string;
  rarity: Rarity;
  stage: Stage;
  /** One or two elements. Two elements average their tilts. */
  elements: readonly Element[];
}

export function computeSpiritStats(input: SpiritStatInput, balance: Balance): SpiritStatBlock {
  const base = balance.roleBase[input.role];
  if (!base) throw new Error(`No roleBase for role "${input.role}" in balance.json`);
  if (input.elements.length === 0) throw new Error('A spirit needs at least one element');
  const size = balance.rarityMult[input.rarity] * balance.stageMult[input.stage - 1]!;
  const stats = {} as SpiritStatBlock;
  for (const stat of SPIRIT_STATS) {
    const tilt = input.elements.reduce((sum, element) => sum + balance.elementTilt[element][stat], 0) / input.elements.length;
    stats[stat] = base[stat] * size * tilt;
  }
  return stats;
}

export function statBudget(stats: SpiritStatBlock): number {
  return SPIRIT_STATS.reduce((sum, stat) => sum + stats[stat], 0);
}

/** The total a spirit of this rarity and stage should have before element tilt reshapes it. */
export function targetBudget(role: string, rarity: Rarity, stage: Stage, balance: Balance): number {
  const base = balance.roleBase[role];
  if (!base) throw new Error(`No roleBase for role "${role}" in balance.json`);
  return statBudget(base) * balance.rarityMult[rarity] * balance.stageMult[stage - 1]!;
}

export function scaleStats(stats: SpiritStatBlock, factor: number): SpiritStatBlock {
  const scaled = {} as SpiritStatBlock;
  for (const stat of SPIRIT_STATS) scaled[stat] = stats[stat] * factor;
  return scaled;
}
