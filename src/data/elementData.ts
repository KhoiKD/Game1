import type { Element, ElementRules } from '../systems/combat';
import { STATUS_IDS } from '../systems/status';
import raw from './elements.json';
import { WEAPON_ELEMENTS } from './weaponData';

export const ELEMENTS = WEAPON_ELEMENTS.filter((e): e is Element => e !== 'kinetic');

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Checks elements.json at load: a complete wheel, one status per element, sane numbers. */
export function validateElements(input: unknown): ElementRules {
  const data = input as ElementRules;
  if (!data?.elements || !data.multipliers || !data.statuses || !data.buildup) {
    throw new Error('elements.json: expected "elements", "multipliers", "statuses", and "buildup"');
  }
  const beaten = new Set<string>();
  const statuses = new Set<string>();
  for (const element of ELEMENTS) {
    const entry = data.elements[element];
    if (!entry) throw new Error(`elements.json: missing element "${element}"`);
    if (!ELEMENTS.includes(entry.strongAgainst) || entry.strongAgainst === element) {
      throw new Error(`elements.json: "${element}" must be strong against a different element`);
    }
    if (!STATUS_IDS.includes(entry.status)) throw new Error(`elements.json: "${element}": unknown status "${String(entry.status)}"`);
    beaten.add(entry.strongAgainst);
    statuses.add(entry.status);
  }
  for (const key of Object.keys(data.elements)) {
    if (!ELEMENTS.includes(key as Element)) throw new Error(`elements.json: unknown element "${key}"`);
  }
  // Every element is beaten by exactly one other, so nothing is unbeatable.
  if (beaten.size !== ELEMENTS.length) throw new Error('elements.json: every element must be beaten by exactly one other');
  if (statuses.size !== ELEMENTS.length) throw new Error('elements.json: each element needs its own status');

  const m = data.multipliers;
  if (!positive(m.strong) || !positive(m.weak) || !positive(m.neutral) || m.strong <= m.neutral || m.weak >= m.neutral) {
    throw new Error('elements.json: multipliers must satisfy weak < neutral < strong');
  }
  if (!positive(data.critMultiplier) || data.critMultiplier < 1) throw new Error('elements.json: critMultiplier must be at least 1');
  for (const status of STATUS_IDS) {
    if (!positive(data.statuses[status]?.durationMs)) throw new Error(`elements.json: status "${status}" needs a durationMs`);
  }
  const s = data.statuses;
  if (!positive(s.burn.tickMs) || !positive(s.burn.tickDamage)) throw new Error('elements.json: burn needs tickMs and tickDamage');
  if (!positive(s.soak.damageTakenMult) || s.soak.damageTakenMult < 1) throw new Error('elements.json: soak damageTakenMult must be at least 1');
  if (!positive(s.shock.arcFraction) || !positive(s.shock.arcRadius)) throw new Error('elements.json: shock needs arcFraction and arcRadius');
  if (!positive(s.blind.aimErrorDeg)) throw new Error('elements.json: blind needs aimErrorDeg');
  if (!positive(s.slow.speedMult) || s.slow.speedMult > 1 || !positive(s.slow.cooldownMult) || s.slow.cooldownMult < 1) {
    throw new Error('elements.json: slow needs speedMult <= 1 and cooldownMult >= 1');
  }
  const b = data.buildup;
  if (!positive(b.threshold) || !positive(b.bossThresholdMult) || !positive(b.bossDurationMult)) {
    throw new Error('elements.json: buildup needs threshold, bossThresholdMult, and bossDurationMult');
  }
  return data;
}

export const elementRules = validateElements(raw);

export function isElement(value: unknown): value is Element {
  return typeof value === 'string' && ELEMENTS.includes(value as Element);
}
