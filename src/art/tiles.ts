/**
 * Detailed ground tiles, painted texel by texel. Each tile's look depends on
 * which neighbours are solid (an exposed top gets the surface material, exposed
 * corners are rounded, exposed sides are lit or shaded) plus a variant for
 * variety. Pure: returns RGBA arrays, so the shapes can be unit tested.
 */
import { OUTLINE } from './palette';
import { hexToRgb } from './shade';
import type { StageTheme } from './themes';

/** Neighbour bits: which sides of a tile have solid ground next to them. */
export const UP = 1;
export const RIGHT = 2;
export const DOWN = 4;
export const LEFT = 8;
export const VARIANTS = 2;
/** Tiles in a tileset: every neighbour combination times every variant. */
export const TILE_COUNT = 16 * VARIANTS;

/** Which neighbours of (x, y) are solid. Outside the map counts as solid, except above it. */
export function neighbourMask(solid: (x: number, y: number) => boolean, x: number, y: number, width: number, height: number): number {
  const at = (cx: number, cy: number): boolean => {
    if (cy < 0) return false;
    if (cx < 0 || cx >= width || cy >= height) return true;
    return solid(cx, cy);
  };
  return (at(x, y - 1) ? UP : 0) | (at(x + 1, y) ? RIGHT : 0) | (at(x, y + 1) ? DOWN : 0) | (at(x - 1, y) ? LEFT : 0);
}

/** Index of a tile in the tileset (0-based). */
export function tileIndex(mask: number, variant: number): number {
  return mask * VARIANTS + (variant % VARIANTS);
}

/** A stable variant per map cell, so the ground does not visibly repeat. */
export function cellVariant(x: number, y: number): number {
  return (hash(x * 7 + 3, y * 13 + 5) >>> 3) % VARIANTS;
}

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth value noise in 0..1, tiling every `period` texels so neighbouring tiles join up. */
function noise(u: number, v: number, cell: number, seed: number, period: number): number {
  const p = period / cell;
  const x = u / cell;
  const y = v / cell;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const corner = (cx: number, cy: number): number => (hash((((cx % p) + p) % p) + seed * 101, (((cy % p) + p) % p) + seed * 57) & 1023) / 1023;
  const top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * sx;
  const bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}

type Rgb = [number, number, number];
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ramp = (r: readonly [Rgb, Rgb, Rgb], t: number): Rgb => (t < 0.5 ? mixRgb(r[2], r[1], t * 2) : mixRgb(r[1], r[0], (t - 0.5) * 2));

/** Paints one tile, `size` texels square, as RGBA. */
export function paintTile(theme: StageTheme, mask: number, variant: number, size = 64): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(size * size * 4);
  const top = theme.top.map(hexToRgb) as [Rgb, Rgb, Rgb];
  const body = theme.body.map(hexToRgb) as [Rgb, Rgb, Rgb];
  const accent = hexToRgb(theme.accent);
  const outline = hexToRgb(OUTLINE);
  const openUp = !(mask & UP);
  const openDown = !(mask & DOWN);
  const openLeft = !(mask & LEFT);
  const openRight = !(mask & RIGHT);
  const k = size / 64; // all measurements below are for a 64-texel tile
  const edge = 2 * k;
  const seed = variant + 1;

  // Pebbles, shells, or crystals: a few per tile, placed by the variant.
  const specks = Array.from({ length: 3 }, (_, i) => {
    const h = hash(seed * 31 + i, mask + 7);
    return { x: (h % 52) * k + 6 * k, y: ((h >>> 8) % 40) * k + 18 * k, r: (2 + ((h >>> 16) % 4)) * k, show: ((h >>> 20) & 3) !== 0 };
  });

  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      const i = (v * size + u) * 4;
      // Rounded corners where two exposed sides meet.
      const corner = (cx: number, cy: number, r: number): number => Math.hypot(u + 0.5 - cx, v + 0.5 - cy) - r;
      const rTop = 14 * k;
      const rBottom = 9 * k;
      let cut = -Infinity; // > 0 is outside the tile shape
      if (openUp && openLeft && u < rTop && v < rTop) cut = corner(rTop, rTop, rTop);
      if (openUp && openRight && u >= size - rTop && v < rTop) cut = corner(size - rTop, rTop, rTop);
      if (openDown && openLeft && u < rBottom && v >= size - rBottom) cut = corner(rBottom, size - rBottom, rBottom);
      if (openDown && openRight && u >= size - rBottom && v >= size - rBottom) cut = corner(size - rBottom, size - rBottom, rBottom);
      if (cut > 0) continue;

      // Distance to each exposed edge (or the rounded corner), for outlines and lighting.
      const dTop = openUp ? v : Infinity;
      const dBottom = openDown ? size - 1 - v : Infinity;
      const dLeft = openLeft ? u : Infinity;
      const dRight = openRight ? size - 1 - u : Infinity;
      const dEdge = Math.min(dTop, dBottom, dLeft, dRight, cut === -Infinity ? Infinity : -cut);

      // Inside the ground: mottled body material with soft strata.
      const n = noise(u, v, 16 * k, seed, size) * 0.6 + noise(u, v, 6 * k, seed + 9, size) * 0.4;
      const strata = Math.sin((v / size) * Math.PI * 4 + n * 3) * 0.08;
      let colour = ramp(body, 0.35 + n * 0.45 + strata);

      for (const s of specks) {
        if (!s.show) continue;
        const d = Math.hypot((u - s.x) * 0.8, v - s.y) - s.r;
        if (d < 0) {
          const lit = Math.max(0, (s.x - u) * 0.5 + (s.y - v)) / (s.r * 1.4);
          colour = theme.glowingAccent ? mixRgb(accent, [255, 255, 255], Math.min(0.6, lit)) : mixRgb(mixRgb(accent, body[2], 0.35), accent, Math.min(1, lit));
        } else if (theme.glowingAccent && d < 4 * k) {
          colour = mixRgb(colour, accent, 0.35 * (1 - d / (4 * k)));
        }
      }

      // Surface layer (grass, sand, moss) on an exposed top, with a wavy lower edge.
      if (openUp) {
        const depth = (13 + Math.sin((u / size) * Math.PI * 2 * 2 + seed) * 3 + noise(u, 0, 5 * k, seed + 3, size) * 4) * k;
        if (v < depth) {
          const blades = noise(u * 3, v * 0.5, 4 * k, seed + 5, size * 3);
          colour = ramp(top, 1 - v / depth * 0.75 + (blades - 0.5) * 0.35);
        } else if (v < depth + 3 * k) {
          colour = mixRgb(colour, body[2], 0.55); // shadow cast by the surface lip
        }
      }

      // Light from the upper left: lit top and left faces, shaded right and bottom faces.
      const glint = (d: number, width: number): number => (d < width ? 1 - d / width : 0);
      colour = mixRgb(colour, [255, 255, 240], 0.28 * glint(dTop - edge, 4 * k) + 0.12 * glint(dLeft - edge, 6 * k));
      colour = mixRgb(colour, outline, 0.35 * glint(dRight - edge, 8 * k) + 0.5 * glint(dBottom - edge, 10 * k));
      if (openDown) colour = mixRgb(colour, outline, 0.25 * (v / size));

      // Dark outline along exposed edges.
      if (dEdge < edge) colour = mixRgb(colour, outline, Math.min(1, edge - dEdge + 0.4));

      const grain = ((hash(u + seed * 977, v) & 15) - 7.5) * 0.9;
      data[i] = colour[0] + grain;
      data[i + 1] = colour[1] + grain;
      data[i + 2] = colour[2] + grain;
      data[i + 3] = cut > -1 ? 255 * Math.min(1, -cut) : 255;
    }
  }
  return data;
}
