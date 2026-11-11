/** A phase lasts while the boss's health fraction stays above `untilHpFraction`. */
export interface PhaseThreshold {
  untilHpFraction: number;
}

/**
 * Index of the phase a boss is in for a given health fraction (1 = full, 0 = dead).
 * Phases are listed in fight order with descending thresholds; the last phase
 * applies once every earlier threshold has been crossed.
 */
export function phaseIndex(hpFraction: number, phases: readonly PhaseThreshold[]): number {
  if (phases.length === 0) throw new Error('A boss needs at least one phase');
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (phase && hpFraction > phase.untilHpFraction) return i;
  }
  return phases.length - 1;
}
