import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/util/events';
import { FrameProbe } from '../src/util/frameProbe';

describe('event bus', () => {
  it('delivers payloads to listeners of that event only, and unsubscribes', () => {
    const bus = new EventBus<{ a: number; b: string }>();
    const seen: string[] = [];
    const off = bus.on('a', (n) => seen.push(`a${n}`));
    bus.on('b', (s) => seen.push(`b${s}`));
    bus.emit('a', 1);
    bus.emit('b', 'x');
    off();
    bus.emit('a', 2);
    expect(seen).toEqual(['a1', 'bx']);
    bus.clear();
    bus.emit('b', 'y');
    expect(seen).toEqual(['a1', 'bx']);
  });
});

describe('frame probe', () => {
  it('ignores the warm-up, then reports the average frame time once', () => {
    const probe = new FrameProbe(1000, 500);
    expect(probe.sample(0, 100)).toBeNull();
    expect(probe.sample(900, 100)).toBeNull();
    let t = 1000;
    let result: number | null = null;
    while (result === null) {
      result = probe.sample(t, 40);
      t += 40;
    }
    expect(result).toBeCloseTo(40);
    expect(probe.done).toBe(true);
    expect(probe.sample(t, 10)).toBeNull();
  });
});
