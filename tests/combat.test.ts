import { describe, expect, it } from 'vitest';
import rawEnemies from '../src/data/enemies.json';
import { BEHAVIORS, bossKinds, enemyKinds, getBossStats, getEnemyStats, parseKind, validateEnemies } from '../src/data/enemyData';
import { BOSS_RAIN_SPACING } from '../src/config';
import creatures from '../src/data/creatures.json';
import { phaseIndex } from '../src/systems/bossPhase';
import { applyDamage, createHealth, isInvulnerable, refill } from '../src/systems/health';

describe('health', () => {
  it('applies damage and starts invulnerability frames', () => {
    const r = applyDamage(createHealth(5), 1, 1000, 900);
    expect(r.applied).toBe(true);
    expect(r.dead).toBe(false);
    expect(r.health.hp).toBe(4);
    expect(isInvulnerable(r.health, 1500)).toBe(true);
    expect(isInvulnerable(r.health, 1900)).toBe(false);
  });

  it('ignores hits during invulnerability frames', () => {
    const first = applyDamage(createHealth(5), 1, 1000, 900).health;
    const second = applyDamage(first, 1, 1500, 900);
    expect(second.applied).toBe(false);
    expect(second.health).toBe(first);
  });

  it('takes damage again once the frames expire', () => {
    const first = applyDamage(createHealth(5), 1, 1000, 900).health;
    expect(applyDamage(first, 1, 1900, 900).health.hp).toBe(3);
  });

  it('never drops below zero and reports death', () => {
    const r = applyDamage(createHealth(2), 10, 0, 900);
    expect(r.health.hp).toBe(0);
    expect(r.dead).toBe(true);
  });

  it('ignores zero or negative damage and hits on the dead', () => {
    const h = createHealth(3);
    expect(applyDamage(h, 0, 0, 900).applied).toBe(false);
    expect(applyDamage(h, -2, 0, 900).health).toBe(h);
    const dead = applyDamage(h, 3, 0, 0).health;
    const again = applyDamage(dead, 1, 5000, 0);
    expect(again.applied).toBe(false);
    expect(again.dead).toBe(true);
  });

  it('refill restores full health and clears invulnerability', () => {
    const hurt = applyDamage(createHealth(5), 3, 1000, 900).health;
    expect(refill(hurt)).toEqual({ hp: 5, max: 5, invulnerableUntil: 0 });
  });
});

describe('phaseIndex', () => {
  const phases = [{ untilHpFraction: 0.5 }, { untilHpFraction: 0 }];

  it('is the first phase at full health', () => {
    expect(phaseIndex(1, phases)).toBe(0);
    expect(phaseIndex(0.51, phases)).toBe(0);
  });

  it('switches exactly at the threshold', () => {
    expect(phaseIndex(0.5, phases)).toBe(1);
    expect(phaseIndex(0.1, phases)).toBe(1);
  });

  it('stays in the last phase at zero health', () => {
    expect(phaseIndex(0, phases)).toBe(1);
  });

  it('handles three phases', () => {
    const three = [{ untilHpFraction: 0.66 }, { untilHpFraction: 0.33 }, { untilHpFraction: 0 }];
    expect([0.9, 0.5, 0.2].map((f) => phaseIndex(f, three))).toEqual([0, 1, 2]);
  });

  it('rejects a boss with no phases', () => {
    expect(() => phaseIndex(1, [])).toThrow();
  });
});

describe('enemy data', () => {
  it('gives every creature enemy sane stats at every stage', () => {
    expect(enemyKinds().length).toBeGreaterThan(0);
    for (const kind of enemyKinds()) {
      for (const bonus of [0, 1, 2]) {
        const stats = getEnemyStats(kind, bonus);
        const label = `${kind} stage ${bonus + 1}`;
        expect(stats.creature.stage, label).toBe(bonus + 1);
        expect(stats.hp, label).toBeGreaterThan(0);
        expect(stats.xp, label).toBeGreaterThan(0);
        expect(stats.contactDamage, label).toBeGreaterThanOrEqual(1);
        expect(BEHAVIORS, label).toContain(stats.behavior);
        // Anything that shoots, leaps, or charges warns first.
        if (stats.behavior !== 'walker') expect(stats.telegraphMs, label).toBeGreaterThan(0);
      }
    }
  });

  it('makes later stages tougher, more rewarding, and bigger', () => {
    for (const kind of enemyKinds()) {
      const [one, two, three] = [0, 1, 2].map((bonus) => getEnemyStats(kind, bonus));
      expect(two!.hp, kind).toBeGreaterThan(one!.hp);
      expect(three!.hp, kind).toBeGreaterThan(two!.hp);
      expect(three!.xp, kind).toBeGreaterThan(one!.xp);
      expect(three!.size, kind).toBeGreaterThan(one!.size);
    }
  });

  it('reads a starting stage from the kind and caps the stage at 3', () => {
    expect(parseKind('verdant-oak')).toEqual({ family: 'verdant-oak', stage: 1 });
    expect(parseKind('verdant-oak@2')).toEqual({ family: 'verdant-oak', stage: 2 });
    expect(getEnemyStats('verdant-oak@2', 0).creature.stage).toBe(2);
    expect(getEnemyStats('verdant-oak@2', 2).creature.stage).toBe(3);
    expect(() => parseKind('verdant-oak@4')).toThrow(/Bad enemy kind/);
  });

  it('applies creature overrides on top of the behavior', () => {
    expect(getEnemyStats('verdant-oak').hp).toBeGreaterThan(getEnemyStats('verdant-stickinsect').hp);
    expect(getEnemyStats('verdant-oak').behavior).toBe('walker');
  });

  it('defines bosses with descending phase thresholds, a telegraph, and a roster family', () => {
    const families = new Set(creatures.families.map((f) => f.id));
    expect(bossKinds().length).toBeGreaterThan(0);
    for (const kind of bossKinds()) {
      const boss = getBossStats(kind);
      expect(boss.hp, kind).toBeGreaterThan(0);
      expect(boss.telegraphMs, kind).toBeGreaterThan(0);
      expect(boss.phases.length, kind).toBeGreaterThanOrEqual(2);
      expect(families.has(boss.family), `${kind} family`).toBe(true);
      expect(boss.creature, kind).toEqual({ family: boss.family, stage: 3 });
      const thresholds = boss.phases.map((p) => p.untilHpFraction);
      expect([...thresholds].sort((a, b) => b - a), kind).toEqual(thresholds);
      expect(thresholds[thresholds.length - 1], kind).toBe(0);
    }
  });

  it('scales boss health with the tier multiplier', () => {
    expect(getBossStats('komodrake', 1.6).hp).toBeCloseTo(getBossStats('komodrake').hp * 1.6);
  });

  it('leaves gaps in every boss attack that the player can get through', () => {
    // The player is 64px tall and 32px wide.
    const fightingDistance = 300;
    for (const kind of bossKinds()) {
      for (const [i, phase] of getBossStats(kind).phases.entries()) {
        const label = `${kind} phase ${i + 1}`;
        if (phase.pattern === 'aimed' && phase.bullets > 1) {
          expect(fightingDistance * Math.tan((phase.spreadDeg * Math.PI) / 180), label).toBeGreaterThanOrEqual(96);
        }
        if (phase.pattern === 'ring') {
          expect(fightingDistance * ((2 * Math.PI) / phase.bullets), label).toBeGreaterThanOrEqual(96);
        }
        if (phase.pattern === 'rain') expect(BOSS_RAIN_SPACING, label).toBeGreaterThanOrEqual(64);
      }
    }
  });

  it('rejects bad enemy data', () => {
    const clone = () => JSON.parse(JSON.stringify(rawEnemies)) as typeof rawEnemies;
    const noBehavior = clone();
    delete (noBehavior.behaviors as Record<string, unknown>).lobber;
    expect(() => validateEnemies(noBehavior)).toThrow(/missing behavior "lobber"/);

    const unknownFamily = clone();
    (unknownFamily.creatures as Record<string, unknown>)['made-up'] = { behavior: 'walker' };
    expect(() => validateEnemies(unknownFamily)).toThrow(/not a family/);

    const badOverride = clone();
    (badOverride.creatures['verdant-oak'] as { overrides: Record<string, number> }).overrides = { bulletSpeed: 5 };
    expect(() => validateEnemies(badOverride)).toThrow(/is not a walker stat/);

    const badPattern = clone();
    badPattern.bosses.komodrake.phases[0]!.pattern = 'laser';
    expect(() => validateEnemies(badPattern)).toThrow(/unknown pattern/);

    const risingPhases = clone();
    risingPhases.bosses.komodrake.phases[1]!.untilHpFraction = 0.9;
    expect(() => validateEnemies(risingPhases)).toThrow(/descend/);
  });

  it('throws on unknown kinds', () => {
    expect(() => getEnemyStats('nope')).toThrow(/Unknown enemy/);
    expect(() => getBossStats('nope')).toThrow(/Unknown boss/);
  });
});
