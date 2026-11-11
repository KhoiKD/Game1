import { describe, expect, it } from 'vitest';
import { checkpointTriggerZone, parseLevelObjects, type RawObject } from '../src/level/parseLevelObjects';

const spawn: RawObject = { name: 'spawn', type: 'spawn', x: 96, y: 480 };
const cp = (name: string, order: number, x: number): RawObject => ({
  name,
  type: 'checkpoint',
  x,
  y: 384,
  width: 32,
  height: 96,
  properties: [{ name: 'order', value: order }],
});

describe('parseLevelObjects', () => {
  it('parses spawn, checkpoints (sorted by order), and pickups', () => {
    const level = parseLevelObjects([
      cp('cp-2', 2, 2000),
      spawn,
      cp('cp-1', 1, 1000),
      { name: 'p1', type: 'pickup', x: 300, y: 448 },
    ]);
    expect(level.spawn).toEqual({ x: 96, y: 480 });
    expect(level.checkpoints.map((c) => c.id)).toEqual(['cp-1', 'cp-2']);
    expect(level.checkpoints[0]?.rect).toEqual({ x: 1000, y: 384, width: 32, height: 96 });
    expect(level.pickups).toEqual([{ id: 'p1', x: 300, y: 448 }]);
  });

  it('ignores unknown object types', () => {
    const level = parseLevelObjects([spawn, { name: 'note', type: 'comment', x: 0, y: 0 }]);
    expect(level.checkpoints).toEqual([]);
    expect(level.pickups).toEqual([]);
  });

  it('throws when there is no spawn', () => {
    expect(() => parseLevelObjects([cp('cp-1', 1, 0)])).toThrow(/no spawn/);
  });

  it('throws on a second spawn', () => {
    expect(() => parseLevelObjects([spawn, { ...spawn, name: 'spawn-2' }])).toThrow(/more than one spawn/);
  });

  it('throws on duplicate names', () => {
    expect(() =>
      parseLevelObjects([
        spawn,
        { name: 'dup', type: 'pickup', x: 0, y: 0 },
        { name: 'dup', type: 'pickup', x: 5, y: 5 },
      ]),
    ).toThrow(/Duplicate/);
  });

  it('throws when a checkpoint has no order or a pickup has no name', () => {
    expect(() =>
      parseLevelObjects([spawn, { name: 'cp', type: 'checkpoint', x: 0, y: 0 }]),
    ).toThrow(/order/);
    expect(() => parseLevelObjects([spawn, { type: 'pickup', x: 0, y: 0 }])).toThrow(/needs a name/);
  });
});

describe('checkpointTriggerZone', () => {
  const flag = { x: 1152, y: 384, width: 32, height: 96 };

  it('spans the flag column from the top of the map to the flag base', () => {
    expect(checkpointTriggerZone(flag)).toEqual({ x: 1152, y: 0, width: 32, height: 480 });
  });

  it('covers the flag itself and all the space above it', () => {
    const zone = checkpointTriggerZone(flag);
    expect(zone.y).toBeLessThanOrEqual(flag.y);
    expect(zone.y + zone.height).toBe(flag.y + flag.height);
  });

  it('keeps the flag column width', () => {
    expect(checkpointTriggerZone(flag).x).toBe(flag.x);
    expect(checkpointTriggerZone(flag).width).toBe(flag.width);
  });
});
