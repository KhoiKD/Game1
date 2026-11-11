import { describe, expect, it } from 'vitest';
import { bossKinds, enemyKinds, getBossStats, getEnemyStats } from '../src/data/enemyData';
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
  it('defines sane stats for every enemy', () => {
    expect(enemyKinds().length).toBeGreaterThan(0);
    for (const kind of enemyKinds()) {
      const stats = getEnemyStats(kind);
      expect(stats.hp, kind).toBeGreaterThan(0);
      expect(stats.contactDamage, kind).toBeGreaterThanOrEqual(0);
      expect(['walker', 'turret'], kind).toContain(stats.behavior);
      if (stats.behavior === 'walker') {
        expect(stats.speed, kind).toBeGreaterThan(0);
        expect(stats.patrolRange, kind).toBeGreaterThan(0);
      } else {
        expect(stats.telegraphMs, kind).toBeGreaterThan(0);
        expect(stats.fireIntervalMs, kind).toBeGreaterThan(0);
        expect(stats.bulletSpeed, kind).toBeGreaterThan(0);
      }
    }
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
      const thresholds = boss.phases.map((p) => p.untilHpFraction);
      expect([...thresholds].sort((a, b) => b - a), kind).toEqual(thresholds);
      expect(thresholds[thresholds.length - 1], kind).toBe(0);
    }
  });

  it('throws on unknown kinds', () => {
    expect(() => getEnemyStats('nope')).toThrow(/Unknown enemy/);
    expect(() => getBossStats('nope')).toThrow(/Unknown boss/);
  });
});
