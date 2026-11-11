import { describe, expect, it } from 'vitest';
import raw from '../src/data/weapons.json';
import {
  ARCHETYPE_IDS,
  getWeapon,
  resolveWeapon,
  starterLoadout,
  validateWeaponData,
  weaponData,
  type ResolvedWeapon,
} from '../src/data/weaponData';
import {
  chargeFraction,
  createWeaponState,
  draw,
  isReloading,
  scatterRad,
  shotLifetimeMs,
  stepWeapon,
  swapMs,
  type WeaponState,
} from '../src/systems/weapon';
import { createRng } from '../src/util/rng';

const rng = () => 0.5; // centre of the scatter range: no random deviation
const clone = () => JSON.parse(JSON.stringify(raw)) as typeof raw;

/** Runs the weapon frame by frame and collects when shots happened. */
function simulate(
  weapon: ResolvedWeapon,
  triggerAt: (time: number) => boolean,
  untilMs: number,
  options: { stepMs?: number; reloadAt?: number } = {},
): { state: WeaponState; shotTimes: number[]; shotCount: number } {
  const stepMs = options.stepMs ?? 10;
  let state = createWeaponState(weapon);
  const shotTimes: number[] = [];
  let shotCount = 0;
  for (let time = 0; time <= untilMs; time += stepMs) {
    const result = stepWeapon(
      state,
      weapon,
      { time, triggerDown: triggerAt(time), reloadPressed: options.reloadAt === time },
      rng,
    );
    state = result.state;
    if (result.shots.length > 0) {
      shotTimes.push(time);
      shotCount += result.shots.length;
    }
  }
  return { state, shotTimes, shotCount };
}

describe('weapon data', () => {
  it('defines all seven archetypes and at least one weapon for each', () => {
    expect(Object.keys(weaponData.archetypes).sort()).toEqual([...ARCHETYPE_IDS].sort());
    const used = new Set(weaponData.weapons.map((w) => w.archetype));
    for (const id of ARCHETYPE_IDS) expect(used.has(id), id).toBe(true);
  });

  it('resolves a weapon from its archetype', () => {
    const carbine = getWeapon('field-carbine');
    expect(carbine.archetypeLabel).toBe('Pulse Rifle');
    expect(carbine.trigger).toBe('burst');
    expect(carbine.magazine).toBe(weaponData.archetypes['pulse-rifle']!.magazine);
  });

  it('lets a weapon override archetype stats', () => {
    const custom = resolveWeapon(
      { id: 'x', name: 'X', archetype: 'sidearm', element: 'kinetic', rarity: 'rare', stats: { damage: 3, magazine: 14 } },
      weaponData.archetypes,
    );
    expect(custom.damage).toBe(3);
    expect(custom.magazine).toBe(14);
    expect(custom.reloadMs).toBe(weaponData.archetypes.sidearm!.reloadMs);
  });

  it('gives a starter loadout of valid weapons', () => {
    expect(starterLoadout().map((w) => w.id)).toEqual(weaponData.starterLoadout);
  });

  it('rejects bad data', () => {
    const missingArchetype = clone();
    delete (missingArchetype.archetypes as Record<string, unknown>).beam;
    expect(() => validateWeaponData(missingArchetype)).toThrow(/missing archetype "beam"/);

    const duplicate = clone();
    duplicate.weapons.push({ ...duplicate.weapons[0]! });
    expect(() => validateWeaponData(duplicate)).toThrow(/duplicate weapon id/);

    const badArchetype = clone();
    badArchetype.weapons[0]!.archetype = 'railgun';
    expect(() => validateWeaponData(badArchetype)).toThrow(/unknown archetype/);

    const badElement = clone();
    badElement.weapons[0]!.element = 'Plasma';
    expect(() => validateWeaponData(badElement)).toThrow(/unknown element/);

    const negative = clone();
    negative.archetypes.sidearm.damage = -1;
    expect(() => validateWeaponData(negative)).toThrow(/"damage"/);

    const emptyMag = clone();
    emptyMag.archetypes.sidearm.magazine = 0;
    expect(() => validateWeaponData(emptyMag)).toThrow(/"magazine"/);

    const badLoadout = clone();
    badLoadout.starterLoadout.push('nope');
    expect(() => validateWeaponData(badLoadout)).toThrow(/starterLoadout/);
  });

  it('throws on an unknown weapon id', () => {
    expect(() => getWeapon('nope')).toThrow(/Unknown weapon/);
  });
});

describe('derived stats', () => {
  it('scatter falls to zero at full stability', () => {
    expect(scatterRad(100)).toBe(0);
    expect(scatterRad(0)).toBeGreaterThan(scatterRad(50));
  });

  it('higher handling means a faster swap', () => {
    expect(swapMs(100)).toBeLessThan(swapMs(0));
    expect(swapMs(100)).toBeGreaterThan(0);
  });

  it('projectiles live long enough to travel the weapon range', () => {
    const w = getWeapon('pocket-sting');
    expect((shotLifetimeMs(w) / 1000) * w.projectileSpeed).toBeCloseTo(w.range);
  });
});

describe('trigger modes', () => {
  it('auto fires repeatedly at the fire interval while held', () => {
    const w = getWeapon('scattermaw');
    const { shotTimes } = simulate(w, () => true, 1100);
    expect(shotTimes).toEqual([0, 520, 1040]);
  });

  it('semi fires once per click, however long the trigger is held', () => {
    const w = getWeapon('pocket-sting');
    expect(simulate(w, () => true, 1000).shotTimes).toEqual([0]);
    // click, release, click again
    const twoClicks = simulate(w, (t) => t < 50 || (t >= 300 && t < 350), 1000);
    expect(twoClicks.shotTimes).toEqual([0, 300]);
  });

  it('semi ignores a click that comes before the weapon is ready', () => {
    const w = getWeapon('pocket-sting');
    const tooFast = simulate(w, (t) => t < 20 || (t >= 60 && t < 80), 500);
    expect(tooFast.shotTimes).toEqual([0]);
  });

  it('burst fires its full burst from one pull, then waits for the fire interval', () => {
    const w = getWeapon('field-carbine');
    const tap = simulate(w, (t) => t === 0, 300);
    expect(tap.shotTimes).toEqual([0, 60, 120]);
    expect(tap.state.ammo).toBe(w.magazine - 3);
    const held = simulate(w, () => true, 500);
    expect(held.shotTimes).toEqual([0, 60, 120, 330, 390, 450]);
  });

  it('charge fires on release only when fully charged', () => {
    const w = getWeapon('longwake');
    const early = simulate(w, (t) => t < 400, 1200);
    expect(early.shotTimes).toEqual([]);
    expect(early.state.ammo).toBe(w.magazine);
    const full = simulate(w, (t) => t < 900, 1200);
    expect(full.shotTimes).toEqual([900]);
  });

  it('reports charge progress while held', () => {
    const w = getWeapon('longwake');
    let state = createWeaponState(w);
    state = stepWeapon(state, w, { time: 0, triggerDown: true, reloadPressed: false }, rng).state;
    expect(chargeFraction(state, w, 400)).toBeCloseTo(0.5);
    expect(chargeFraction(state, w, 5000)).toBe(1);
    expect(chargeFraction(createWeaponState(w), w, 400)).toBe(0);
  });
});

describe('magazine and reload', () => {
  it('reloads automatically when empty and refills after the reload time', () => {
    const w = getWeapon('scattermaw'); // 6 rounds, 520ms apart, 1500ms reload
    const emptied = simulate(w, () => true, 2610);
    expect(emptied.shotTimes).toEqual([0, 520, 1040, 1560, 2080, 2600]);
    expect(emptied.state.ammo).toBe(0);
    expect(isReloading(emptied.state)).toBe(true);

    const refilled = simulate(w, () => true, 4100);
    expect(refilled.shotTimes).toEqual([0, 520, 1040, 1560, 2080, 2600, 4100]);
    expect(refilled.state.ammo).toBe(w.magazine - 1);
  });

  it('does not fire while reloading', () => {
    const w = getWeapon('scattermaw');
    const { shotTimes } = simulate(w, () => true, 4000);
    expect(shotTimes.filter((t) => t > 2600 && t < 4100)).toEqual([]);
  });

  it('reloads on request and ignores the request when full', () => {
    const w = getWeapon('pocket-sting');
    const full = simulate(w, () => false, 100, { reloadAt: 50 });
    expect(isReloading(full.state)).toBe(false);

    const partial = simulate(w, (t) => t === 0, 500, { reloadAt: 200 });
    expect(isReloading(partial.state)).toBe(true);
    const done = simulate(w, (t) => t === 0, 1100, { reloadAt: 200 });
    expect(done.state.ammo).toBe(w.magazine);
    expect(isReloading(done.state)).toBe(false);
  });

  it('cuts a burst short when the magazine runs out', () => {
    const w = { ...getWeapon('field-carbine'), magazine: 2 };
    const { shotTimes, state } = simulate(w, (t) => t === 0, 300);
    expect(shotTimes).toEqual([0, 60]);
    expect(isReloading(state)).toBe(true);
  });
});

describe('shots', () => {
  it('fans pellets symmetrically around the aim line', () => {
    const w = getWeapon('scattermaw');
    const { shots } = stepWeapon(createWeaponState(w), w, { time: 0, triggerDown: true, reloadPressed: false }, rng);
    expect(shots).toHaveLength(w.pellets);
    const offsets = shots.map((s) => s.angleOffset);
    expect(offsets.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    expect(offsets[1]! - offsets[0]!).toBeCloseTo((w.spreadDeg * Math.PI) / 180);
  });

  it('carries the weapon stats on each shot', () => {
    const w = getWeapon('cinder-lobber');
    const { shots } = stepWeapon(createWeaponState(w), w, { time: 0, triggerDown: true, reloadPressed: false }, rng);
    expect(shots[0]).toMatchObject({
      damage: w.damage,
      speed: w.projectileSpeed,
      gravity: w.gravity,
      blastRadius: w.blastRadius,
      texture: 'grenade',
    });
  });

  it('keeps scatter within the stability limit and is repeatable for a seed', () => {
    const w = getWeapon('scattermaw');
    const fireWith = (seed: number) =>
      stepWeapon(createWeaponState(w), w, { time: 0, triggerDown: true, reloadPressed: false }, createRng(seed)).shots;
    const a = fireWith(7);
    expect(fireWith(7)).toEqual(a);
    expect(fireWith(8)).not.toEqual(a);
    a.forEach((shot, i) => {
      const fan = ((i - (w.pellets - 1) / 2) * w.spreadDeg * Math.PI) / 180;
      expect(Math.abs(shot.angleOffset - fan)).toBeLessThanOrEqual(scatterRad(w.stability));
    });
  });
});

describe('swapping', () => {
  it('a drawn weapon waits out its swap delay and loses any reload in progress', () => {
    const w = getWeapon('cinder-lobber');
    const reloading: WeaponState = { ...createWeaponState(w), ammo: 1, reloadDoneAt: 9999 };
    const drawn = draw(reloading, w, 1000);
    expect(isReloading(drawn)).toBe(false);
    expect(drawn.ammo).toBe(1);

    const early = stepWeapon(drawn, w, { time: 1000 + swapMs(w.handling) - 1, triggerDown: true, reloadPressed: false }, rng);
    expect(early.shots).toHaveLength(0);
    const released = stepWeapon(early.state, w, { time: 1000 + swapMs(w.handling), triggerDown: false, reloadPressed: false }, rng);
    const ready = stepWeapon(released.state, w, { time: 1001 + swapMs(w.handling), triggerDown: true, reloadPressed: false }, rng);
    expect(ready.shots).toHaveLength(1);
  });
});

describe('rng', () => {
  it('is repeatable and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 200; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
