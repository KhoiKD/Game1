import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/util/events';

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
