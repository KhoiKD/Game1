import type { WeaponElement } from '../data/weaponData';

/**
 * Colours for the pixel art. Every sprite is drawn with a dark outline and
 * three-tone shading (light, mid, dark), in the style of 16-bit console RPGs.
 */
export type Ramp = readonly [light: string, mid: string, dark: string];

/** The outline drawn around every sprite. */
export const OUTLINE = '#1b1426';

/** Element colours as shading ramps; "kinetic" weapons use brass. */
export const ELEMENT_RAMPS: Record<WeaponElement, Ramp> = {
  kinetic: ['#ffe6a8', '#c9a14f', '#8a6a2a'],
  Ember: ['#ffb35c', '#f2683a', '#a8321c'],
  Tide: ['#8fd0ff', '#4c8df0', '#2a4fa8'],
  Volt: ['#fff7a8', '#f5d743', '#b08a1a'],
  Verdant: ['#a8f0a0', '#5fd38d', '#2f8a4f'],
  Umbra: ['#d2b0ff', '#a56bff', '#5a2fa8'],
  Gale: ['#f4ffff', '#bff4ff', '#6fb6c8'],
};

/** Shown on the frames before an enemy attacks: the element colours go pale gold. */
export const WARN_RAMP: Ramp = ['#fffbe0', '#fff0a0', '#e0b050'];

/** Colours every sprite can use. Each sprite adds or overrides its own. */
export const BASE_PALETTE: Readonly<Record<string, string>> = {
  w: '#f4f1ff', // white
  k: '#140f1f', // eyes, deepest shadow
  r: '#e23b3b', // red
  s: '#9e1f2a', // dark red
  y: '#ffd166', // gold
  z: '#b8862b', // dark gold
  d: '#dfe6f2', // steel light
  e: '#9aa6bd', // steel
  f: '#5c6680', // steel dark
  x: '#a8703f', // wood
  v: '#6e4424', // dark wood
  p: '#f6cfa3', // skin
  q: '#d39a6e', // skin shadow
};

/** The light, mid, and dark ramp as the palette letters a, b, and c. */
export function rampPalette(ramp: Ramp): Record<'a' | 'b' | 'c', string> {
  return { a: ramp[0], b: ramp[1], c: ramp[2] };
}
