import type { WeaponElement } from '../data/weaponData';
import type { Rng } from '../util/rng';
import type { StatusId, StatusRules } from './status';

/** The six elements. Kinetic is the absence of one. */
export type Element = Exclude<WeaponElement, 'kinetic'>;

export interface ElementRules extends StatusRules {
  /** Each element is strong against one other and inflicts one status. */
  elements: Record<Element, { strongAgainst: Element; status: StatusId }>;
  multipliers: { strong: number; weak: number; neutral: number };
  critMultiplier: number;
}

export type Effectiveness = 'strong' | 'weak' | 'neutral';

/** Everything a hit carries from the weapon that fired it. */
export interface HitProfile {
  damage: number;
  element: WeaponElement;
  critChance: number;
  /** Multiplies how fast this hit fills status meters. */
  statusBuildup: number;
  /** Share of the magazine refunded when this hit defeats an enemy. */
  killRefund: number;
  /** Uid of the weapon that fired it, for the refund. */
  sourceUid: string | null;
}

export const PLAIN_HIT: HitProfile = {
  damage: 1,
  element: 'kinetic',
  critChance: 0,
  statusBuildup: 1,
  killRefund: 0,
  sourceUid: null,
};

/**
 * Strong when the attack's element beats the target's; weak when the target's
 * element beats the attack's. Kinetic attacks and targets without an element
 * are always neutral.
 */
export function effectiveness(attack: WeaponElement, target: Element | null, rules: ElementRules): Effectiveness {
  if (attack === 'kinetic' || target === null) return 'neutral';
  if (rules.elements[attack].strongAgainst === target) return 'strong';
  if (rules.elements[target].strongAgainst === attack) return 'weak';
  return 'neutral';
}

export interface DamageInput {
  /** Weapon damage after its roll and perks. */
  base: number;
  attackElement: WeaponElement;
  targetElement: Element | null;
  crit: boolean;
  /** From statuses on the target, such as soak. */
  damageTakenMult: number;
}

export interface DamageResult {
  amount: number;
  effectiveness: Effectiveness;
  crit: boolean;
}

/** Damage = base x element multiplier x crit x target status multiplier. */
export function computeDamage(input: DamageInput, rules: ElementRules): DamageResult {
  const result = effectiveness(input.attackElement, input.targetElement, rules);
  const amount =
    input.base * rules.multipliers[result] * (input.crit ? rules.critMultiplier : 1) * input.damageTakenMult;
  return { amount: Math.max(0, amount), effectiveness: result, crit: input.crit };
}

export function rollCrit(chance: number, rng: Rng): boolean {
  return chance > 0 && rng() < chance;
}

/** The status an element inflicts; kinetic inflicts none. */
export function statusFor(element: WeaponElement | null, rules: ElementRules): StatusId | null {
  return element === null || element === 'kinetic' ? null : rules.elements[element].status;
}

/** The element a target is weak to and the one it resists, for UI hints. */
export function matchups(element: Element, rules: ElementRules): { strongAgainst: Element; weakAgainst: Element } {
  const weakAgainst = (Object.keys(rules.elements) as Element[]).find(
    (other) => rules.elements[other].strongAgainst === element,
  );
  if (!weakAgainst) throw new Error(`Nothing is strong against ${element}; the element wheel is broken`);
  return { strongAgainst: rules.elements[element].strongAgainst, weakAgainst };
}
