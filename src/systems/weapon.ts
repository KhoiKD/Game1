import type { ResolvedWeapon } from '../data/weaponData';
import type { Rng } from '../util/rng';

/**
 * Weapon firing logic as a pure state machine: trigger modes, magazine,
 * reload, bursts, and charging. The scene feeds it the trigger each frame and
 * spawns whatever shots come back. Times are in milliseconds.
 */
export interface WeaponState {
  readonly ammo: number;
  /** The weapon cannot start a new shot before this time (fire rate, swap delay). */
  readonly readyAt: number;
  readonly reloadDoneAt: number | null;
  /** Shots still owed by the burst in progress. */
  readonly burstLeft: number;
  readonly nextBurstAt: number;
  readonly chargeStartedAt: number | null;
  readonly triggerHeld: boolean;
}

export interface WeaponInput {
  time: number;
  triggerDown: boolean;
  reloadPressed: boolean;
}

/** One projectile to spawn. */
export interface Shot {
  /** Added to the aim angle, in radians. */
  angleOffset: number;
  damage: number;
  speed: number;
  lifetimeMs: number;
  pierce: number;
  gravity: number;
  blastRadius: number;
  texture: string;
}

export interface WeaponStep {
  state: WeaponState;
  shots: Shot[];
}

const DEG = Math.PI / 180;
const MAX_SCATTER_DEG = 6; // scatter at stability 0
const SLOWEST_SWAP_MS = 520; // at handling 0
const FASTEST_SWAP_MS = 120; // at handling 100

export function createWeaponState(weapon: ResolvedWeapon): WeaponState {
  return {
    ammo: weapon.magazine,
    readyAt: 0,
    reloadDoneAt: null,
    burstLeft: 0,
    nextBurstAt: 0,
    chargeStartedAt: null,
    triggerHeld: false,
  };
}

/** Largest random deviation from the aim angle, from the stability stat. */
export function scatterRad(stability: number): number {
  return ((100 - stability) / 100) * MAX_SCATTER_DEG * DEG;
}

/** Delay before a weapon can fire after being drawn, from the handling stat. */
export function swapMs(handling: number): number {
  return SLOWEST_SWAP_MS - (handling / 100) * (SLOWEST_SWAP_MS - FASTEST_SWAP_MS);
}

/** How long a projectile lives so that it travels the weapon's range. */
export function shotLifetimeMs(weapon: ResolvedWeapon): number {
  return (weapon.range / weapon.projectileSpeed) * 1000;
}

export function isReloading(state: WeaponState): boolean {
  return state.reloadDoneAt !== null;
}

/** 0 to 1 for a charge weapon being held; 0 otherwise. */
export function chargeFraction(state: WeaponState, weapon: ResolvedWeapon, time: number): number {
  if (state.chargeStartedAt === null || weapon.chargeMs <= 0) return 0;
  return Math.min(1, Math.max(0, (time - state.chargeStartedAt) / weapon.chargeMs));
}

/** Putting a weapon away cancels its reload, burst, and charge. */
export function holster(state: WeaponState): WeaponState {
  return { ...state, reloadDoneAt: null, burstLeft: 0, chargeStartedAt: null, triggerHeld: false };
}

/** Drawing a weapon makes it wait out its swap delay before it can fire. */
export function draw(state: WeaponState, weapon: ResolvedWeapon, time: number): WeaponState {
  return { ...holster(state), readyAt: time + swapMs(weapon.handling) };
}

function makeShots(weapon: ResolvedWeapon, rng: Rng): Shot[] {
  const scatter = scatterRad(weapon.stability);
  const lifetimeMs = shotLifetimeMs(weapon);
  const shots: Shot[] = [];
  for (let i = 0; i < weapon.pellets; i++) {
    const fan = (i - (weapon.pellets - 1) / 2) * weapon.spreadDeg * DEG;
    shots.push({
      angleOffset: fan + (rng() * 2 - 1) * scatter,
      damage: weapon.damage,
      speed: weapon.projectileSpeed,
      lifetimeMs,
      pierce: weapon.pierce,
      gravity: weapon.gravity,
      blastRadius: weapon.blastRadius,
      texture: weapon.projectile,
    });
  }
  return shots;
}

export function stepWeapon(state: WeaponState, weapon: ResolvedWeapon, input: WeaponInput, rng: Rng): WeaponStep {
  const { time, triggerDown } = input;
  const pressed = triggerDown && !state.triggerHeld;
  const s = { ...state, triggerHeld: triggerDown };
  const shots: Shot[] = [];

  /** Spends one round and starts a reload when the magazine runs dry. */
  const fireOnce = (): void => {
    shots.push(...makeShots(weapon, rng));
    s.ammo -= 1;
    if (s.ammo <= 0) {
      s.ammo = 0;
      s.burstLeft = 0;
      s.chargeStartedAt = null;
      s.reloadDoneAt = time + weapon.reloadMs;
    }
  };

  if (s.reloadDoneAt !== null && time >= s.reloadDoneAt) {
    s.ammo = weapon.magazine;
    s.reloadDoneAt = null;
  }
  if (input.reloadPressed && s.reloadDoneAt === null && s.burstLeft === 0 && s.ammo < weapon.magazine) {
    s.chargeStartedAt = null;
    s.reloadDoneAt = time + weapon.reloadMs;
  }
  if (s.reloadDoneAt !== null) return { state: s, shots };

  // A burst in progress finishes on its own, even if the trigger is released.
  if (s.burstLeft > 0) {
    if (time >= s.nextBurstAt) {
      s.burstLeft -= 1;
      s.nextBurstAt = time + weapon.burstIntervalMs;
      fireOnce();
    }
    return { state: s, shots };
  }

  if (time < s.readyAt) {
    s.chargeStartedAt = null;
    return { state: s, shots };
  }

  switch (weapon.trigger) {
    case 'auto':
      if (triggerDown) {
        s.readyAt = time + weapon.fireIntervalMs;
        fireOnce();
      }
      break;
    case 'semi':
      if (pressed) {
        s.readyAt = time + weapon.fireIntervalMs;
        fireOnce();
      }
      break;
    case 'burst':
    case 'semi-burst':
      // burst repeats while held; semi-burst needs a fresh click for each burst.
      if (weapon.trigger === 'burst' ? triggerDown : pressed) {
        s.readyAt = time + weapon.fireIntervalMs;
        s.burstLeft = Math.min(weapon.burstCount, s.ammo) - 1;
        s.nextBurstAt = time + weapon.burstIntervalMs;
        fireOnce();
      }
      break;
    case 'charge':
      if (triggerDown) {
        if (s.chargeStartedAt === null) s.chargeStartedAt = time;
      } else if (s.chargeStartedAt !== null) {
        // Released: fires only when fully charged; letting go early cancels.
        const charged = time - s.chargeStartedAt >= weapon.chargeMs;
        s.chargeStartedAt = null;
        if (charged) {
          s.readyAt = time + weapon.fireIntervalMs;
          fireOnce();
        }
      }
      break;
  }
  return { state: s, shots };
}
