/**
 * Sound effects as data: each recipe is a few synthesizer voices (an
 * oscillator or noise, an envelope, a pitch sweep, an optional filter). The
 * player in audio/player.ts renders them with Web Audio. Pure, so recipes are
 * unit tested. Every sound is original and made here; there are no audio files.
 */
import type { WeaponElement } from '../data/weaponData';

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';

export interface Voice {
  wave: Wave;
  /** Start pitch in Hz (for noise, the filter does the shaping). */
  freq: number;
  /** Pitch at the end of the sound; omit to hold. */
  freqEnd?: number;
  /** Seconds to reach full volume. */
  attack: number;
  /** Seconds from full volume to silence. */
  decay: number;
  /** Peak volume, 0 to 1. */
  gain: number;
  /** Seconds before this voice starts. */
  delay?: number;
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: number; freqEnd?: number; q?: number };
}

export type Recipe = readonly Voice[];

/** Each element has its own colour, layered over the base sound. */
const ELEMENT_LAYER: Record<WeaponElement, (strength: number) => Voice[]> = {
  kinetic: () => [],
  // Crackle.
  Ember: (s) => [{ wave: 'noise', freq: 0, attack: 0.002, decay: 0.14, gain: 0.28 * s, filter: { type: 'bandpass', freq: 2400, freqEnd: 900, q: 1.2 } }],
  // A falling bubble.
  Tide: (s) => [{ wave: 'sine', freq: 900, freqEnd: 260, attack: 0.004, decay: 0.12, gain: 0.3 * s }],
  // A bright zap.
  Volt: (s) => [{ wave: 'square', freq: 1800, freqEnd: 3200, attack: 0.001, decay: 0.06, gain: 0.12 * s, filter: { type: 'highpass', freq: 1200 } }],
  // A soft wooden pluck.
  Verdant: (s) => [{ wave: 'triangle', freq: 520, freqEnd: 480, attack: 0.002, decay: 0.16, gain: 0.3 * s }],
  // A low, uneasy drone.
  Umbra: (s) => [
    { wave: 'sawtooth', freq: 110, freqEnd: 82, attack: 0.01, decay: 0.2, gain: 0.16 * s, filter: { type: 'lowpass', freq: 700 } },
    { wave: 'sawtooth', freq: 116, freqEnd: 87, attack: 0.01, decay: 0.2, gain: 0.12 * s, filter: { type: 'lowpass', freq: 700 } },
  ],
  // A whoosh of air.
  Gale: (s) => [{ wave: 'noise', freq: 0, attack: 0.02, decay: 0.16, gain: 0.22 * s, filter: { type: 'highpass', freq: 3000, freqEnd: 6000 } }],
};

/** The firing sound of each weapon archetype. */
const SHOT: Record<string, Voice[]> = {
  'pulse-rifle': [
    { wave: 'square', freq: 880, freqEnd: 220, attack: 0.001, decay: 0.07, gain: 0.18, filter: { type: 'lowpass', freq: 3000 } },
    { wave: 'noise', freq: 0, attack: 0.001, decay: 0.05, gain: 0.2, filter: { type: 'bandpass', freq: 1800, q: 0.8 } },
  ],
  'spread-gun': [
    { wave: 'noise', freq: 0, attack: 0.001, decay: 0.18, gain: 0.42, filter: { type: 'lowpass', freq: 2600, freqEnd: 500 } },
    { wave: 'square', freq: 220, freqEnd: 70, attack: 0.001, decay: 0.12, gain: 0.2 },
  ],
  beam: [{ wave: 'sawtooth', freq: 1400, freqEnd: 1300, attack: 0.002, decay: 0.05, gain: 0.08, filter: { type: 'bandpass', freq: 1500, q: 4 } }],
  launcher: [
    { wave: 'sine', freq: 180, freqEnd: 60, attack: 0.002, decay: 0.2, gain: 0.45 },
    { wave: 'noise', freq: 0, attack: 0.005, decay: 0.12, gain: 0.2, filter: { type: 'lowpass', freq: 900 } },
  ],
  sidearm: [
    { wave: 'square', freq: 1200, freqEnd: 400, attack: 0.001, decay: 0.05, gain: 0.16, filter: { type: 'lowpass', freq: 4000 } },
    { wave: 'noise', freq: 0, attack: 0.001, decay: 0.035, gain: 0.18, filter: { type: 'highpass', freq: 1500 } },
  ],
  'melee-burst': [{ wave: 'noise', freq: 0, attack: 0.01, decay: 0.13, gain: 0.32, filter: { type: 'bandpass', freq: 900, freqEnd: 3500, q: 1.5 } }],
  'charge-cannon': [
    { wave: 'sawtooth', freq: 300, freqEnd: 60, attack: 0.002, decay: 0.32, gain: 0.32, filter: { type: 'lowpass', freq: 2400, freqEnd: 300 } },
    { wave: 'sine', freq: 90, freqEnd: 40, attack: 0.002, decay: 0.3, gain: 0.4 },
  ],
};

export function shotRecipe(archetype: string, element: WeaponElement): Recipe {
  return [...(SHOT[archetype] ?? SHOT['pulse-rifle']!), ...ELEMENT_LAYER[element](0.6)];
}

export function hitRecipe(element: WeaponElement, crit: boolean, effect: 'strong' | 'resisted' | 'neutral'): Recipe {
  // Strong hits ring higher, resisted hits thud lower, crits add a bright ping.
  const pitch = effect === 'strong' ? 1.4 : effect === 'resisted' ? 0.6 : 1;
  const voices: Voice[] = [
    { wave: 'noise', freq: 0, attack: 0.001, decay: 0.05, gain: 0.22, filter: { type: 'bandpass', freq: 1400 * pitch, q: 1 } },
    { wave: 'triangle', freq: 340 * pitch, freqEnd: 180 * pitch, attack: 0.001, decay: 0.06, gain: 0.18 },
    ...ELEMENT_LAYER[element](0.4),
  ];
  if (crit) voices.push({ wave: 'sine', freq: 2093, attack: 0.001, decay: 0.16, gain: 0.18 });
  return voices;
}

/** Notes as frequencies: a short helper for chimes. */
const note = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

function arpeggio(midis: number[], step: number, wave: Wave, gain: number, decay = 0.25): Voice[] {
  return midis.map((m, i) => ({ wave, freq: note(m), attack: 0.004, decay, gain, delay: i * step }));
}

/** Rarer loot gets a longer, higher jingle. */
const LOOT_NOTES: Record<string, number[]> = {
  common: [72, 76],
  uncommon: [72, 76, 79],
  rare: [72, 76, 79, 84],
  epic: [74, 78, 81, 86, 90],
  legendary: [72, 76, 79, 84, 88, 91, 96],
};

export function lootRecipe(rarity: string): Recipe {
  return arpeggio(LOOT_NOTES[rarity] ?? LOOT_NOTES.common!, 0.06, 'square', 0.12, 0.2);
}

/** Fixed sounds, by name. */
export const SOUNDS = {
  weakened: [
    { wave: 'triangle', freq: 660, freqEnd: 330, attack: 0.005, decay: 0.3, gain: 0.25 },
    { wave: 'sine', freq: 990, freqEnd: 495, attack: 0.005, decay: 0.3, gain: 0.12, delay: 0.04 },
  ],
  captured: [
    ...arpeggio([72, 79, 84, 88, 91], 0.05, 'sine', 0.2, 0.4),
    { wave: 'noise', freq: 0, attack: 0.15, decay: 0.35, gain: 0.12, filter: { type: 'highpass', freq: 5000 } },
  ],
  defeated: [
    { wave: 'noise', freq: 0, attack: 0.002, decay: 0.22, gain: 0.3, filter: { type: 'lowpass', freq: 1800, freqEnd: 300 } },
    { wave: 'square', freq: 300, freqEnd: 80, attack: 0.002, decay: 0.18, gain: 0.14, filter: { type: 'lowpass', freq: 1500 } },
  ],
  bossDefeated: [
    { wave: 'noise', freq: 0, attack: 0.005, decay: 1.2, gain: 0.45, filter: { type: 'lowpass', freq: 2500, freqEnd: 120 } },
    { wave: 'sine', freq: 120, freqEnd: 30, attack: 0.005, decay: 1.0, gain: 0.5 },
  ],
  explosion: [
    { wave: 'noise', freq: 0, attack: 0.002, decay: 0.45, gain: 0.5, filter: { type: 'lowpass', freq: 2200, freqEnd: 150 } },
    { wave: 'sine', freq: 110, freqEnd: 35, attack: 0.002, decay: 0.35, gain: 0.45 },
  ],
  hurt: [
    { wave: 'square', freq: 260, freqEnd: 110, attack: 0.002, decay: 0.16, gain: 0.25, filter: { type: 'lowpass', freq: 1800 } },
    { wave: 'noise', freq: 0, attack: 0.002, decay: 0.08, gain: 0.25, filter: { type: 'bandpass', freq: 800 } },
  ],
  died: [
    ...arpeggio([67, 63, 60, 55], 0.12, 'triangle', 0.25, 0.35),
    { wave: 'sawtooth', freq: 160, freqEnd: 50, attack: 0.01, decay: 0.8, gain: 0.15, filter: { type: 'lowpass', freq: 900 } },
  ],
  checkpoint: arpeggio([67, 72, 76, 79], 0.07, 'triangle', 0.24, 0.45),
  pickup: arpeggio([84, 91], 0.045, 'sine', 0.2, 0.15),
  telegraph: [{ wave: 'square', freq: 1320, attack: 0.001, decay: 0.05, gain: 0.08, filter: { type: 'highpass', freq: 800 } }],
  bossTelegraph: [
    { wave: 'sawtooth', freq: 70, freqEnd: 95, attack: 0.05, decay: 0.45, gain: 0.3, filter: { type: 'lowpass', freq: 600 } },
    { wave: 'noise', freq: 0, attack: 0.08, decay: 0.4, gain: 0.15, filter: { type: 'bandpass', freq: 400, q: 2 } },
  ],
  bossPhase: [
    { wave: 'sawtooth', freq: 90, freqEnd: 45, attack: 0.02, decay: 0.9, gain: 0.35, filter: { type: 'lowpass', freq: 1200, freqEnd: 200 } },
    { wave: 'noise', freq: 0, attack: 0.02, decay: 0.7, gain: 0.25, filter: { type: 'lowpass', freq: 1500, freqEnd: 200 } },
  ],
  stageClear: arpeggio([72, 76, 79, 84, 79, 84, 88], 0.11, 'square', 0.14, 0.5),
  ability: [
    { wave: 'sine', freq: 300, freqEnd: 1200, attack: 0.01, decay: 0.25, gain: 0.25 },
    { wave: 'noise', freq: 0, attack: 0.03, decay: 0.2, gain: 0.12, filter: { type: 'bandpass', freq: 2500, freqEnd: 5000, q: 2 } },
  ],
  reload: [
    { wave: 'noise', freq: 0, attack: 0.001, decay: 0.03, gain: 0.22, filter: { type: 'bandpass', freq: 2500, q: 3 } },
    { wave: 'noise', freq: 0, attack: 0.001, decay: 0.04, gain: 0.22, delay: 0.12, filter: { type: 'bandpass', freq: 1700, q: 3 } },
  ],
  swap: [{ wave: 'noise', freq: 0, attack: 0.001, decay: 0.05, gain: 0.18, filter: { type: 'bandpass', freq: 3000, freqEnd: 1500, q: 2 } }],
  click: [{ wave: 'square', freq: 990, attack: 0.001, decay: 0.03, gain: 0.08, filter: { type: 'lowpass', freq: 3000 } }],
} satisfies Record<string, Recipe>;

export type SoundName = keyof typeof SOUNDS;

/** How long a recipe sounds, in seconds. */
export function recipeLength(recipe: Recipe): number {
  return Math.max(0, ...recipe.map((v) => (v.delay ?? 0) + v.attack + v.decay));
}
