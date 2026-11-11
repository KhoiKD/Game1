import type { Rarity } from '../data/weaponData';

/** Display colour per rarity, as a number (shapes) and a CSS string (text). */
export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xc8ccd6,
  uncommon: 0x7ef7a3,
  rare: 0x4cc9f0,
  epic: 0xc77dff,
  legendary: 0xffd166,
};

export function rarityCss(rarity: Rarity): string {
  return `#${RARITY_COLOR[rarity].toString(16).padStart(6, '0')}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
