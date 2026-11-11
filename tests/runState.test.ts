import { describe, expect, it } from 'vitest';
import {
  activateCheckpoint,
  collectPickup,
  createRunState,
  die,
  hasCollected,
  securedCount,
  unsecuredCount,
} from '../src/systems/runState';

describe('collectPickup', () => {
  it('adds new pickups to the unsecured set', () => {
    const s = collectPickup(createRunState(), 'a');
    expect(s.unsecured).toEqual(['a']);
    expect(hasCollected(s, 'a')).toBe(true);
  });

  it('ignores a pickup that was already collected', () => {
    const s = collectPickup(createRunState(), 'a');
    expect(collectPickup(s, 'a')).toBe(s);
  });

  it('does not mutate the previous state', () => {
    const before = createRunState();
    collectPickup(before, 'a');
    expect(before.unsecured).toEqual([]);
  });
});

describe('activateCheckpoint', () => {
  it('banks unsecured gains and records the checkpoint', () => {
    let s = collectPickup(createRunState(), 'a');
    s = collectPickup(s, 'b');
    s = activateCheckpoint(s, 'cp-1', 1);
    expect(s.checkpointId).toBe('cp-1');
    expect(s.checkpointOrder).toBe(1);
    expect(s.secured).toEqual(['a', 'b']);
    expect(unsecuredCount(s)).toBe(0);
  });

  it('ignores an earlier checkpoint so respawn never moves backwards', () => {
    let s = activateCheckpoint(createRunState(), 'cp-2', 2);
    s = collectPickup(s, 'x');
    expect(activateCheckpoint(s, 'cp-1', 1)).toBe(s);
  });

  it('reactivating the current checkpoint banks new gains', () => {
    let s = activateCheckpoint(createRunState(), 'cp-1', 1);
    s = collectPickup(s, 'x');
    s = activateCheckpoint(s, 'cp-1', 1);
    expect(s.secured).toEqual(['x']);
    expect(unsecuredCount(s)).toBe(0);
  });

  it('returns the same object when nothing changes', () => {
    const s = activateCheckpoint(createRunState(), 'cp-1', 1);
    expect(activateCheckpoint(s, 'cp-1', 1)).toBe(s);
  });
});

describe('die', () => {
  it('discards unsecured gains and keeps secured ones', () => {
    let s = collectPickup(createRunState(), 'a');
    s = activateCheckpoint(s, 'cp-1', 1);
    s = collectPickup(s, 'b');
    s = die(s);
    expect(s.secured).toEqual(['a']);
    expect(s.unsecured).toEqual([]);
    expect(hasCollected(s, 'b')).toBe(false);
    expect(s.checkpointId).toBe('cp-1');
  });

  it('lets a rolled-back pickup be collected again', () => {
    let s = collectPickup(activateCheckpoint(createRunState(), 'cp-1', 1), 'b');
    s = die(s);
    s = collectPickup(s, 'b');
    expect(unsecuredCount(s)).toBe(1);
    expect(securedCount(s)).toBe(0);
  });

  it('returns the same object when there is nothing to lose', () => {
    const s = createRunState();
    expect(die(s)).toBe(s);
  });
});
