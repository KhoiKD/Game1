/**
 * The music, as short original note patterns played by audio/music.ts. Each
 * pattern is a string with one character per step: a digit or letter is a
 * scale degree (0-9, then a-e for 10-14), "-" holds the previous note, and "."
 * is a rest. Every track is four bars of sixteen steps, looping. Pure.
 */
export interface Track {
  bpm: number;
  /** MIDI note of scale degree 0 for the lead; the bass plays two octaves lower. */
  root: number;
  /** Semitones above the root for each scale degree. */
  scale: readonly number[];
  lead: string;
  bass: string;
  kick: string;
  snare: string;
  hat: string;
  leadWave: OscillatorType;
  /** Overall loudness, 0 to 1. */
  level: number;
}

export const STEPS = 64;

const bars = (...parts: string[]): string => parts.join('');
const repeat = (bar: string): string => bar.repeat(4);

const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export const TRACKS: Record<string, Track> = {
  // Thornway: bright and bouncy.
  level1: {
    bpm: 118,
    root: 62,
    scale: MAJOR_PENTATONIC,
    lead: bars('4-3-2-0-1-2-4---', '5-6-5-4-3-2-1---', '0-1-2-4-5-4-2-1-', '2---1---0-------'),
    bass: bars('0...0...3...3...', '4...4...3...3...', '0...0...1...1...', '3...3...0...0...'),
    kick: repeat('x...x...x...x...'),
    snare: repeat('....x.......x...'),
    hat: repeat('..x...x...x...x.'),
    leadWave: 'square',
    level: 0.55,
  },
  // Brinemere: a slow, rolling sea shanty feel.
  level2: {
    bpm: 96,
    root: 62,
    scale: DORIAN,
    lead: bars('4---3-2-0---2---', '3---4-5-4-------', '6---5-4-3---2-3-', '4-------0-------'),
    bass: bars('0.......0...4...', '3.......3...6...', '5.......5...2...', '4.......4...0...'),
    kick: repeat('x.......x.x.....'),
    snare: repeat('....x.......x...'),
    hat: repeat('x.x.x.x.x.x.x.x.'),
    leadWave: 'triangle',
    level: 0.6,
  },
  // Duskhollow: sparse and uneasy.
  level3: {
    bpm: 84,
    root: 64,
    scale: PHRYGIAN,
    lead: bars('0---1---0-------', '3---4---5---4---', '5-4-3-1-0---1---', '0---------------'),
    bass: bars('0...............', '5...............', '3...............', '1...........0...'),
    kick: repeat('x.........x.....'),
    snare: repeat('........x.......'),
    hat: repeat('....x.......x...'),
    leadWave: 'sawtooth',
    level: 0.45,
  },
  // Boss fights: fast and driving.
  boss: {
    bpm: 148,
    root: 57,
    scale: MINOR,
    lead: bars('7.7.6.7.4...3.4.', '5.5.4.5.2...0...', '7.7.8.9.8.7.6.5.', '4.3.2.3.4-------'),
    bass: bars('0.0.0.0.0.0.0.0.', '5.5.5.5.5.5.5.5.', '3.3.3.3.3.3.3.3.', '4.4.4.4.4.4.4.4.'),
    kick: repeat('x...x...x...x...'),
    snare: repeat('....x.......x..x'),
    hat: repeat('xxxxxxxxxxxxxxxx'),
    leadWave: 'square',
    level: 0.55,
  },
  // Hub, title, and class select: calm.
  hub: {
    bpm: 76,
    root: 60,
    scale: MAJOR,
    lead: bars('4---2---3---1---', '2---0---1-------', '4---5---6---7---', '4---------------'),
    bass: bars('0.......4.......', '5.......3.......', '3.......4.......', '0...............'),
    kick: repeat('x...............'),
    snare: repeat('................'),
    hat: repeat('....x.......x...'),
    leadWave: 'triangle',
    level: 0.5,
  },
};

export interface NoteEvent {
  step: number;
  /** Length in steps. */
  length: number;
  midi: number;
}

const DEGREE = '0123456789abcde';

/** Turns a pattern into notes. */
export function parsePattern(pattern: string, root: number, scale: readonly number[]): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let step = 0; step < pattern.length; step++) {
    const char = pattern[step]!;
    if (char === '-') {
      const last = notes[notes.length - 1];
      if (last && last.step + last.length === step) last.length += 1;
      continue;
    }
    const degree = DEGREE.indexOf(char);
    if (degree < 0) continue;
    const octave = Math.floor(degree / scale.length);
    notes.push({ step, length: 1, midi: root + scale[degree % scale.length]! + octave * 12 });
  }
  return notes;
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
