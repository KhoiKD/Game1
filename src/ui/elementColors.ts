import type { WeaponElement } from '../data/weaponData';
import type { StatusId } from '../systems/status';

/** Hue family per element, from the Art Direction palette. */
export const ELEMENT_COLOR: Record<WeaponElement, number> = {
  kinetic: 0xc8ccd6,
  Ember: 0xf2683a,
  Tide: 0x4c8df0,
  Volt: 0xfff275,
  Verdant: 0x5fd38d,
  Umbra: 0xa56bff,
  Gale: 0xbff4ff,
};

/** A status takes the colour of the element that inflicts it. */
export const STATUS_COLOR: Record<StatusId, number> = {
  burn: ELEMENT_COLOR.Ember,
  soak: ELEMENT_COLOR.Tide,
  shock: ELEMENT_COLOR.Volt,
  root: ELEMENT_COLOR.Verdant,
  blind: ELEMENT_COLOR.Umbra,
  slow: ELEMENT_COLOR.Gale,
};

export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
