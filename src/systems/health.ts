/** Hit points with invulnerability frames. Pure; times are in milliseconds. */
export interface Health {
  readonly hp: number;
  readonly max: number;
  /** Damage is ignored until the clock reaches this time. */
  readonly invulnerableUntil: number;
}

export interface DamageResult {
  health: Health;
  /** False when the hit was ignored (i-frames, already dead, or no damage). */
  applied: boolean;
  dead: boolean;
}

export function createHealth(max: number): Health {
  return { hp: max, max, invulnerableUntil: 0 };
}

export function applyDamage(health: Health, amount: number, now: number, iframesMs: number): DamageResult {
  if (health.hp <= 0 || amount <= 0 || now < health.invulnerableUntil) {
    return { health, applied: false, dead: health.hp <= 0 };
  }
  const hp = Math.max(0, health.hp - amount);
  return {
    health: { ...health, hp, invulnerableUntil: now + iframesMs },
    applied: true,
    dead: hp === 0,
  };
}

export function refill(health: Health): Health {
  return { ...health, hp: health.max, invulnerableUntil: 0 };
}

export function isInvulnerable(health: Health, now: number): boolean {
  return now < health.invulnerableUntil;
}
