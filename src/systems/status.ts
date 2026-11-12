/**
 * Status effects on a target. Elemental hits fill a build-up meter; when the
 * meter reaches its threshold the status starts and runs for a fixed time.
 * A target holds at most one of each status, and a running status cannot be
 * refreshed or stacked. Pure; times are in milliseconds.
 */
export const STATUS_IDS = ['burn', 'soak', 'shock', 'root', 'blind', 'slow'] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export interface StatusRules {
  statuses: {
    burn: { durationMs: number; tickMs: number; tickDamage: number };
    soak: { durationMs: number; damageTakenMult: number };
    shock: { durationMs: number; arcFraction: number; arcRadius: number };
    root: { durationMs: number };
    blind: { durationMs: number; aimErrorDeg: number };
    slow: { durationMs: number; speedMult: number; cooldownMult: number };
  };
  buildup: { threshold: number; bossThresholdMult: number; bossDurationMult: number };
}

export interface ActiveStatus {
  until: number;
  /** Next damage tick; only meaningful for burn. */
  nextTickAt: number;
}

export interface StatusState {
  readonly active: Readonly<Partial<Record<StatusId, ActiveStatus>>>;
  readonly buildup: Readonly<Partial<Record<StatusId, number>>>;
}

/** How hard a target is to affect. Bosses need more build-up and shake statuses off sooner. */
export interface StatusScale {
  thresholdMult: number;
  durationMult: number;
}

export const NO_STATUS: StatusState = { active: {}, buildup: {} };
export const NORMAL_SCALE: StatusScale = { thresholdMult: 1, durationMult: 1 };

export function isActive(state: StatusState, status: StatusId, time: number): boolean {
  const entry = state.active[status];
  return entry !== undefined && time < entry.until;
}

export function activeStatuses(state: StatusState, time: number): StatusId[] {
  return STATUS_IDS.filter((status) => isActive(state, status, time));
}

/**
 * Adds build-up toward a status. Returns `applied: true` on the hit that starts
 * it. Build-up is ignored while that status is already running.
 */
export function addBuildup(
  state: StatusState,
  status: StatusId,
  amount: number,
  time: number,
  rules: StatusRules,
  scale: StatusScale = NORMAL_SCALE,
): { state: StatusState; applied: boolean } {
  if (amount <= 0 || isActive(state, status, time)) return { state, applied: false };
  const meter = (state.buildup[status] ?? 0) + amount;
  if (meter < rules.buildup.threshold * scale.thresholdMult) {
    return { state: { ...state, buildup: { ...state.buildup, [status]: meter } }, applied: false };
  }
  const durationMs = rules.statuses[status].durationMs * scale.durationMult;
  const tickMs = status === 'burn' ? rules.statuses.burn.tickMs : 0;
  return {
    state: {
      active: { ...state.active, [status]: { until: time + durationMs, nextTickAt: time + tickMs } },
      buildup: { ...state.buildup, [status]: 0 },
    },
    applied: true,
  };
}

/** Advances time: drops expired statuses and reports burn damage that came due. */
export function tickStatus(state: StatusState, time: number, rules: StatusRules): { state: StatusState; burnDamage: number } {
  let burnDamage = 0;
  let active = state.active;
  let changed = false;

  const burn = active.burn;
  if (burn) {
    const { tickMs, tickDamage } = rules.statuses.burn;
    let nextTickAt = burn.nextTickAt;
    // Ticks land up to and including the moment the burn ends.
    while (tickMs > 0 && nextTickAt <= Math.min(time, burn.until)) {
      burnDamage += tickDamage;
      nextTickAt += tickMs;
    }
    if (nextTickAt !== burn.nextTickAt) {
      active = { ...active, burn: { ...burn, nextTickAt } };
      changed = true;
    }
  }

  for (const status of STATUS_IDS) {
    const entry = active[status];
    if (entry && time >= entry.until) {
      const { [status]: _expired, ...rest } = active;
      active = rest;
      changed = true;
    }
  }
  return { state: changed ? { ...state, active } : state, burnDamage };
}

/** What the running statuses do to a target right now. */
export interface StatusModifiers {
  speedMult: number;
  /** Multiplies the wait between attacks. */
  cooldownMult: number;
  damageTakenMult: number;
  rooted: boolean;
  /** Largest random error added to aimed attacks, in radians. */
  aimErrorRad: number;
  /** Share of each hit that arcs to nearby enemies; 0 when not shocked. */
  arcFraction: number;
  arcRadius: number;
}

export const NO_MODIFIERS: StatusModifiers = {
  speedMult: 1,
  cooldownMult: 1,
  damageTakenMult: 1,
  rooted: false,
  aimErrorRad: 0,
  arcFraction: 0,
  arcRadius: 0,
};

export function statusModifiers(state: StatusState, time: number, rules: StatusRules): StatusModifiers {
  const s = rules.statuses;
  const slowed = isActive(state, 'slow', time);
  const shocked = isActive(state, 'shock', time);
  return {
    speedMult: slowed ? s.slow.speedMult : 1,
    cooldownMult: slowed ? s.slow.cooldownMult : 1,
    damageTakenMult: isActive(state, 'soak', time) ? s.soak.damageTakenMult : 1,
    rooted: isActive(state, 'root', time),
    aimErrorRad: isActive(state, 'blind', time) ? (s.blind.aimErrorDeg * Math.PI) / 180 : 0,
    arcFraction: shocked ? s.shock.arcFraction : 0,
    arcRadius: shocked ? s.shock.arcRadius : 0,
  };
}
