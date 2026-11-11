import { describe, expect, it } from 'vitest';
import { aimAngle, aimVector } from '../src/util/aim';

describe('aimAngle', () => {
  it('points right at 0 radians', () => {
    expect(aimAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
  });

  it('points down (screen space) at +PI/2', () => {
    expect(aimAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });

  it('points left at PI', () => {
    expect(Math.abs(aimAngle({ x: 0, y: 0 }, { x: -10, y: 0 }))).toBeCloseTo(Math.PI);
  });
});

describe('aimVector', () => {
  it('returns a unit vector', () => {
    const v = aimVector({ x: 5, y: 5 }, { x: 8, y: 9 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
  });

  it('falls back to facing right when the pointer sits on the origin', () => {
    expect(aimVector({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 1, y: 0 });
  });
});
