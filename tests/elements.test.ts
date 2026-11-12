import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementRules, validateElements } from '../src/data/elementData';
import rawElements from '../src/data/elements.json';
import { bossKinds, enemyKinds, getBossStats, getEnemyStats } from '../src/data/enemyData';
import { getPerk, resolveWeaponInstance } from '../src/data/lootData';
import { getWeapon, weaponData } from '../src/data/weaponData';
import { computeDamage, effectiveness, matchups, rollCrit, statusFor } from '../src/systems/combat';
import {
  NO_STATUS,
  STATUS_IDS,
  activeStatuses,
  addBuildup,
  isActive,
  statusModifiers,
  tickStatus,
  type StatusState,
} from '../src/systems/status';
import { createWeaponState, stepWeapon } from '../src/systems/weapon';
import { createRng } from '../src/util/rng';

const rules = elementRules;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hit = (base: number, attackElement: Parameters<typeof effectiveness>[0], targetElement: Parameters<typeof effectiveness>[1]) =>
  computeDamage({ base, attackElement, targetElement, crit: false, damageTakenMult: 1 }, rules);

describe('element wheel', () => {
  it('gives every element exactly one element it beats and one that beats it', () => {
    for (const element of ELEMENTS) {
      const { strongAgainst, weakAgainst } = matchups(element, rules);
      expect(strongAgainst).not.toBe(element);
      expect(weakAgainst).not.toBe(element);
      expect(effectiveness(element, strongAgainst, rules)).toBe('strong');
      expect(effectiveness(element, weakAgainst, rules)).toBe('weak');
      expect(effectiveness(weakAgainst, element, rules)).toBe('strong');
    }
  });

  it('forms a single ring through all six elements', () => {
    const seen = new Set<string>();
    let current = ELEMENTS[0]!;
    while (!seen.has(current)) {
      seen.add(current);
      current = rules.elements[current].strongAgainst;
    }
    expect(seen.size).toBe(6);
  });

  it('is neutral for kinetic attacks, targets without an element, and unrelated pairs', () => {
    expect(effectiveness('kinetic', 'Ember', rules)).toBe('neutral');
    expect(effectiveness('Tide', null, rules)).toBe('neutral');
    expect(effectiveness('Ember', 'Ember', rules)).toBe('neutral');
    expect(effectiveness('Tide', 'Volt', rules)).toBe('neutral');
  });

  it('gives each element its own status', () => {
    const statuses = ELEMENTS.map((e) => statusFor(e, rules));
    expect(new Set(statuses).size).toBe(6);
    expect([...statuses].sort()).toEqual([...STATUS_IDS].sort());
    expect(statusFor('kinetic', rules)).toBeNull();
    expect(statusFor(null, rules)).toBeNull();
  });

  it('rejects a broken wheel or bad numbers', () => {
    const twoBeatOne = clone(rawElements);
    twoBeatOne.elements.Tide.strongAgainst = 'Verdant';
    expect(() => validateElements(twoBeatOne)).toThrow(/beaten by exactly one/);

    const selfBeat = clone(rawElements);
    selfBeat.elements.Tide.strongAgainst = 'Tide';
    expect(() => validateElements(selfBeat)).toThrow(/different element/);

    const sharedStatus = clone(rawElements);
    sharedStatus.elements.Tide.status = 'burn';
    expect(() => validateElements(sharedStatus)).toThrow(/own status/);

    const weakTooHigh = clone(rawElements);
    weakTooHigh.multipliers.weak = 1.2;
    expect(() => validateElements(weakTooHigh)).toThrow(/weak < neutral < strong/);
  });
});

describe('computeDamage', () => {
  it('multiplies by the element matchup', () => {
    expect(hit(10, 'Tide', 'Ember')).toMatchObject({ amount: 10 * rules.multipliers.strong, effectiveness: 'strong' });
    expect(hit(10, 'Ember', 'Tide')).toMatchObject({ amount: 10 * rules.multipliers.weak, effectiveness: 'weak' });
    expect(hit(10, 'kinetic', 'Ember')).toMatchObject({ amount: 10, effectiveness: 'neutral' });
  });

  it('stacks crit and target status multipliers on top', () => {
    const result = computeDamage(
      { base: 4, attackElement: 'Tide', targetElement: 'Ember', crit: true, damageTakenMult: 1.25 },
      rules,
    );
    expect(result.amount).toBeCloseTo(4 * rules.multipliers.strong * rules.critMultiplier * 1.25);
    expect(result.crit).toBe(true);
  });

  it('never returns negative damage', () => {
    expect(hit(-5, 'kinetic', null).amount).toBe(0);
  });
});

describe('rollCrit', () => {
  it('never crits at 0, always at 1, and tracks the chance in between', () => {
    const rng = createRng(4);
    let crits = 0;
    for (let i = 0; i < 5000; i++) {
      expect(rollCrit(0, rng)).toBe(false);
      expect(rollCrit(1, rng)).toBe(true);
      if (rollCrit(0.2, rng)) crits += 1;
    }
    expect(crits / 5000).toBeGreaterThan(0.17);
    expect(crits / 5000).toBeLessThan(0.23);
  });
});

describe('status build-up', () => {
  const threshold = rules.buildup.threshold;

  it('starts the status only once the meter reaches the threshold', () => {
    const first = addBuildup(NO_STATUS, 'burn', threshold * 0.6, 0, rules);
    expect(first.applied).toBe(false);
    expect(isActive(first.state, 'burn', 0)).toBe(false);
    const second = addBuildup(first.state, 'burn', threshold * 0.6, 100, rules);
    expect(second.applied).toBe(true);
    expect(isActive(second.state, 'burn', 100)).toBe(true);
    expect(second.state.buildup.burn).toBe(0);
  });

  it('keeps separate meters per status and allows several statuses at once', () => {
    let state = addBuildup(NO_STATUS, 'burn', threshold, 0, rules).state;
    state = addBuildup(state, 'soak', threshold * 0.5, 0, rules).state;
    expect(activeStatuses(state, 0)).toEqual(['burn']);
    state = addBuildup(state, 'soak', threshold * 0.5, 0, rules).state;
    expect(activeStatuses(state, 0)).toEqual(['burn', 'soak']);
  });

  it('cannot be refreshed or stacked while running', () => {
    const started = addBuildup(NO_STATUS, 'slow', threshold, 0, rules).state;
    const again = addBuildup(started, 'slow', threshold * 10, 500, rules);
    expect(again.applied).toBe(false);
    expect(again.state).toBe(started);
    expect(started.active.slow!.until).toBe(rules.statuses.slow.durationMs);
  });

  it('can be applied again after it expires', () => {
    let state = addBuildup(NO_STATUS, 'root', threshold, 0, rules).state;
    const after = rules.statuses.root.durationMs + 1;
    state = tickStatus(state, after, rules).state;
    expect(isActive(state, 'root', after)).toBe(false);
    expect(addBuildup(state, 'root', threshold, after, rules).applied).toBe(true);
  });

  it('makes bosses harder to affect and quicker to recover', () => {
    const scale = { thresholdMult: rules.buildup.bossThresholdMult, durationMult: rules.buildup.bossDurationMult };
    expect(addBuildup(NO_STATUS, 'soak', threshold, 0, rules, scale).applied).toBe(false);
    const applied = addBuildup(NO_STATUS, 'soak', threshold * scale.thresholdMult, 0, rules, scale);
    expect(applied.applied).toBe(true);
    expect(applied.state.active.soak!.until).toBe(rules.statuses.soak.durationMs * scale.durationMult);
  });

  it('ignores zero or negative build-up', () => {
    expect(addBuildup(NO_STATUS, 'burn', 0, 0, rules).state).toBe(NO_STATUS);
    expect(addBuildup(NO_STATUS, 'burn', -3, 0, rules).state).toBe(NO_STATUS);
  });
});

describe('tickStatus', () => {
  const burn = rules.statuses.burn;
  const burning = (): StatusState => addBuildup(NO_STATUS, 'burn', rules.buildup.threshold, 0, rules).state;

  it('deals burn damage on each tick and the full amount over its duration', () => {
    let state = burning();
    expect(tickStatus(state, burn.tickMs - 1, rules).burnDamage).toBe(0);
    const firstTick = tickStatus(state, burn.tickMs, rules);
    expect(firstTick.burnDamage).toBe(burn.tickDamage);
    state = firstTick.state;
    expect(tickStatus(state, burn.tickMs, rules).burnDamage).toBe(0);

    let total = firstTick.burnDamage;
    for (let time = burn.tickMs; time <= burn.durationMs + 1000; time += 16) {
      const step = tickStatus(state, time, rules);
      total += step.burnDamage;
      state = step.state;
    }
    expect(total).toBeCloseTo((burn.durationMs / burn.tickMs) * burn.tickDamage);
    expect(isActive(state, 'burn', burn.durationMs + 1000)).toBe(false);
  });

  it('catches up correctly after a long gap without overshooting the duration', () => {
    const result = tickStatus(burning(), burn.durationMs * 10, rules);
    expect(result.burnDamage).toBeCloseTo((burn.durationMs / burn.tickMs) * burn.tickDamage);
    expect(result.state.active.burn).toBeUndefined();
  });

  it('returns the same state when nothing changes', () => {
    const state = addBuildup(NO_STATUS, 'slow', rules.buildup.threshold, 0, rules).state;
    expect(tickStatus(state, 10, rules).state).toBe(state);
    expect(tickStatus(NO_STATUS, 10, rules).state).toBe(NO_STATUS);
  });
});

describe('statusModifiers', () => {
  const withStatus = (status: (typeof STATUS_IDS)[number]) =>
    statusModifiers(addBuildup(NO_STATUS, status, rules.buildup.threshold, 0, rules).state, 1, rules);

  it('is neutral with no statuses', () => {
    expect(statusModifiers(NO_STATUS, 0, rules)).toEqual({
      speedMult: 1, cooldownMult: 1, damageTakenMult: 1, rooted: false, aimErrorRad: 0, arcFraction: 0, arcRadius: 0,
    });
  });

  it('maps each status to its effect', () => {
    expect(withStatus('soak').damageTakenMult).toBe(rules.statuses.soak.damageTakenMult);
    expect(withStatus('root').rooted).toBe(true);
    expect(withStatus('blind').aimErrorRad).toBeCloseTo((rules.statuses.blind.aimErrorDeg * Math.PI) / 180);
    expect(withStatus('slow')).toMatchObject({
      speedMult: rules.statuses.slow.speedMult,
      cooldownMult: rules.statuses.slow.cooldownMult,
    });
    expect(withStatus('shock')).toMatchObject({
      arcFraction: rules.statuses.shock.arcFraction,
      arcRadius: rules.statuses.shock.arcRadius,
    });
    expect(withStatus('burn').damageTakenMult).toBe(1);
  });

  it('stops applying once the status has run out', () => {
    const state = addBuildup(NO_STATUS, 'root', rules.buildup.threshold, 0, rules).state;
    expect(statusModifiers(state, rules.statuses.root.durationMs, rules).rooted).toBe(false);
  });
});

describe('elements in the data', () => {
  it('gives every enemy and boss a valid element or none', () => {
    for (const kind of enemyKinds()) {
      const element = getEnemyStats(kind).element;
      expect(element === null || ELEMENTS.includes(element), kind).toBe(true);
    }
    for (const kind of bossKinds()) {
      const element = getBossStats(kind).element;
      expect(element === null || ELEMENTS.includes(element), kind).toBe(true);
    }
  });

  it('offers a weapon that is strong against each boss', () => {
    for (const kind of bossKinds()) {
      const element = getBossStats(kind).element;
      if (element === null) continue;
      const counter = matchups(element, rules).weakAgainst;
      expect(weaponData.weapons.some((w) => w.element === counter), `${kind} needs a ${counter} weapon`).toBe(true);
    }
  });

  it('has at least one weapon of every element, so every status can be inflicted', () => {
    for (const element of ELEMENTS) {
      expect(weaponData.weapons.some((w) => w.element === element), element).toBe(true);
    }
  });

  it('carries element, crit, build-up, and refund from the weapon onto each shot', () => {
    const lance = getWeapon('volt-lance');
    const { shots } = stepWeapon(createWeaponState(lance), lance, { time: 0, triggerDown: true, reloadPressed: false }, () => 0.5);
    expect(shots[0]).toMatchObject({
      element: 'Volt',
      critChance: lance.critChance,
      statusBuildup: lance.statusBuildup,
      killRefund: lance.killRefund,
    });
  });

  it('applies the new effect perks to weapon stats', () => {
    const base = getWeapon('pocket-sting');
    const resolved = resolveWeaponInstance({
      uid: 'x', baseId: 'pocket-sting', rarity: 'rare', damageRoll: 1,
      perks: ['scavenger', 'keen-edge', 'saturating-rounds'],
    });
    expect(resolved.killRefund).toBeCloseTo(0.2);
    expect(resolved.critChance).toBeCloseTo(base.critChance + 0.1);
    expect(resolved.statusBuildup).toBeCloseTo(1.5);
    expect(getPerk('keen-edge').slot).toBe('trait');
  });
});
