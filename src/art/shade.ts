/**
 * Turns a pixel-art grid into a detailed, shaded image: the "64-bit" look.
 * The grid is upscaled with edge smoothing, then every texel is lit as if the
 * sprite were a rounded 3D form (light from the upper left), with specular
 * highlights on metal, a rim light on the far edge, a thin dark outline, and
 * a glow around emissive (element-coloured) parts. Pure: no Phaser, no DOM,
 * so it runs in unit tests.
 */
import { TRANSPARENT, gridSize, type Grid } from './pixel';

export interface ShadeOptions {
  /** Texels per grid cell; a power of two. */
  detail: number;
  palette: Readonly<Record<string, string>>;
  outline: string;
  /** Palette letters that shine: not darkened by shading, and they glow. */
  emissive?: string;
  /** Palette letters that are polished metal and get a sharp highlight. */
  metal?: string;
  /** Colour of the rim light on the side away from the main light. */
  rim?: string;
  /** Colour of the glow around emissive parts; defaults to their own colour. */
  glow?: string;
}

export interface ShadedImage {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** Letters that belong to one material share a bevel, so hand-painted shading inside it stays smooth. */
const MATERIAL: Readonly<Record<string, string>> = {
  a: 'el', b: 'el', c: 'el',
  d: 'st', e: 'st', f: 'st',
  y: 'au', z: 'au',
  r: 'rd', s: 'rd',
  x: 'wd', v: 'wd',
  p: 'sk', q: 'sk',
};

/** The largest power of two that is at most `n` (and at least 1). */
export function powerOfTwoAtMost(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/** Scale2x (EPX): doubles a grid, rounding off stair-step diagonals. */
export function scale2x(grid: Grid): Grid {
  const { width, height } = gridSize(grid);
  const at = (x: number, y: number): string => grid[Math.min(height - 1, Math.max(0, y))]![Math.min(width - 1, Math.max(0, x))]!;
  const out: string[] = [];
  for (let y = 0; y < height; y++) {
    let top = '';
    let bottom = '';
    for (let x = 0; x < width; x++) {
      const e = at(x, y);
      const b = at(x, y - 1);
      const d = at(x - 1, y);
      const f = at(x + 1, y);
      const h = at(x, y + 1);
      top += (d === b && b !== f && d !== h ? d : e) + (b === f && b !== d && f !== h ? f : e);
      bottom += (d === h && d !== b && h !== f ? d : e) + (h === f && d !== h && b !== f ? f : e);
    }
    out.push(top, bottom);
  }
  return out;
}

/** Pads a grid with `cells` transparent cells on every side. */
export function pad(grid: Grid, cells: number): Grid {
  const { width } = gridSize(grid);
  const empty = TRANSPARENT.repeat(width + cells * 2);
  const side = TRANSPARENT.repeat(cells);
  return [...Array<string>(cells).fill(empty), ...grid.map((row) => side + row + side), ...Array<string>(cells).fill(empty)];
}

/** Two-pass chamfer distance (in texels) from each true cell to the nearest false one, capped. */
function distanceInside(inside: (i: number) => boolean, width: number, height: number, cap: number, edgeIsBoundary = true): Float32Array {
  const d = new Float32Array(width * height);
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = inside(i) ? cap : 0;
  const relax = (i: number, j: number, cost: number): void => {
    const v = d[j]! + cost;
    if (v < d[i]!) d[i] = v;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      if (edgeIsBoundary && (x === 0 || y === 0)) d[i] = Math.min(d[i]!, 1);
      if (x > 0) relax(i, i - 1, D1);
      if (y > 0) relax(i, i - width, D1);
      if (x > 0 && y > 0) relax(i, i - width - 1, D2);
      if (x < width - 1 && y > 0) relax(i, i - width + 1, D2);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      if (edgeIsBoundary && (x === width - 1 || y === height - 1)) d[i] = Math.min(d[i]!, 1);
      if (x < width - 1) relax(i, i + 1, D1);
      if (y < height - 1) relax(i, i + width, D1);
      if (x < width - 1 && y < height - 1) relax(i, i + width + 1, D2);
      if (x > 0 && y < height - 1) relax(i, i + width - 1, D2);
    }
  }
  return d;
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const LIGHT = normalize([-0.55, -0.75, 0.75]);
const SHADOW_TINT: [number, number, number] = [0.42, 0.36, 0.62]; // shadows lean cool violet
const LIGHT_TINT: [number, number, number] = [1.06, 1.02, 0.94]; // lights lean warm

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** A small deterministic per-texel jitter, for a faint surface grain. */
function grain(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255 - 0.5;
}

/**
 * Shades one grid. The image is (width + 2) x (height + 2) cells, matching the
 * old one-cell outline border, at `detail` texels per cell.
 */
export function shadeGrid(grid: Grid, options: ShadeOptions): ShadedImage {
  const { detail, palette } = options;
  let cells = pad(grid, 1);
  for (let s = 1; s < detail; s *= 2) cells = scale2x(cells);
  const { width, height } = gridSize(cells);
  const n = width * height;
  const chars: string[] = new Array<string>(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) chars[y * width + x] = cells[y]![x]!;
  const opaque = (i: number): boolean => chars[i] !== TRANSPARENT;
  const material = (i: number): string => MATERIAL[chars[i]!] ?? chars[i]!;

  // Volume: a rounded bevel per material, on top of a broad dome over the whole silhouette.
  const silhouette = distanceInside(opaque, width, height, detail * 6);
  const region = distanceInside((i) => {
    if (!opaque(i)) return false;
    const m = material(i);
    const x = i % width;
    const y = (i / width) | 0;
    const same = (j: number): boolean => opaque(j) && material(j) === m;
    return (x === 0 || same(i - 1)) && (x === width - 1 || same(i + 1)) && (y === 0 || same(i - width)) && (y === height - 1 || same(i + width));
  }, width, height, detail * 2);
  const heightAt = new Float32Array(n);
  const bevel = (d: number, r: number): number => {
    const t = Math.min(d, r) / r;
    return Math.sqrt(1 - (1 - t) * (1 - t));
  };
  for (let i = 0; i < n; i++) {
    if (!opaque(i)) continue;
    heightAt[i] = 0.5 * bevel(region[i]!, detail * 1.5) + 0.5 * bevel(silhouette[i]!, detail * 4);
  }

  const emissive = options.emissive ?? '';
  const metal = options.metal ?? '';
  const rim = hexToRgb(options.rim ?? '#bfe8ff');
  const outline = hexToRgb(options.outline);
  const rgb: Record<string, [number, number, number]> = {};
  for (const [k, v] of Object.entries(palette)) rgb[k] = hexToRgb(v);

  const data = new Uint8ClampedArray(n * 4);
  const glowMask = new Float32Array(n);
  const h = (x: number, y: number): number => heightAt[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  const slope = 2.2 / detail;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque(i)) continue;
      const char = chars[i]!;
      const base = rgb[char] ?? [255, 0, 255];
      const nx = -(h(x + 1, y) - h(x - 1, y)) / slope;
      const ny = -(h(x, y + 1) - h(x, y - 1)) / slope;
      const normal = normalize([nx, ny, 1]);
      const diffuse = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
      let r: number;
      let g: number;
      let b: number;
      if (emissive.includes(char)) {
        const lift = 1.05 + 0.2 * diffuse;
        [r, g, b] = [base[0] * lift, base[1] * lift, base[2] * lift];
        glowMask[i] = 1;
      } else {
        // Shadows lean cool violet and lights lean warm, as in painted pre-rendered art.
        const light = 0.42 + 0.78 * diffuse;
        const tint = (c: number): number => (light < 1 ? 1 + (SHADOW_TINT[c]! * 1.4 - 1) * (1 - light) : LIGHT_TINT[c]!);
        r = base[0] * light * tint(0);
        g = base[1] * light * tint(1);
        b = base[2] * light * tint(2);
      }
      // Specular: polished metal gets a hot, tight highlight; everything else a soft sheen.
      const halfway = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
      const ndoth = Math.max(0, normal[0] * halfway[0] + normal[1] * halfway[1] + normal[2] * halfway[2]);
      const spec = metal.includes(char) ? Math.pow(ndoth, 24) * 150 : Math.pow(ndoth, 10) * 28;
      r += spec; g += spec; b += spec;
      // Rim light along the lower-right silhouette, facing away from the main light.
      const edge = silhouette[i]!;
      if (edge <= detail * 0.5 + 0.5 && normal[0] - normal[1] * 0.3 > 0.15) {
        const k = 0.45 * (1 - edge / (detail * 0.5 + 1));
        r += (rim[0] - r) * k; g += (rim[1] - g) * k; b += (rim[2] - b) * k;
      }
      const j = grain(x, y) * 6;
      data[i * 4] = r + j;
      data[i * 4 + 1] = g + j;
      data[i * 4 + 2] = b + j;
      data[i * 4 + 3] = 255;
    }
  }

  // Outline: a thin dark band just outside the silhouette (half a cell thick).
  const outside = distanceInside((i) => !opaque(i), width, height, detail, false);
  const thickness = Math.max(1.5, detail * 0.5);
  for (let i = 0; i < n; i++) {
    if (opaque(i) || outside[i]! > thickness) continue;
    const soft = Math.min(1, thickness + 1 - outside[i]!);
    data[i * 4] = outline[0];
    data[i * 4 + 1] = outline[1];
    data[i * 4 + 2] = outline[2];
    data[i * 4 + 3] = 255 * soft;
  }

  // Glow: a soft halo of the emissive colour in the empty space around shining parts.
  if (emissive) {
    const glow = options.glow ? hexToRgb(options.glow) : rgb[emissive[0]!] ?? [255, 255, 255];
    const radius = Math.max(2, detail);
    const blurred = boxBlur(boxBlur(glowMask, width, height, radius), width, height, radius);
    for (let i = 0; i < n; i++) {
      if (opaque(i)) continue;
      const a = Math.min(1, blurred[i]! * 1.8) * 0.75;
      if (a < 0.02) continue;
      const alpha = data[i * 4 + 3]! / 255;
      // Over the outline, the glow brightens it; over empty space, it is the halo itself.
      const outA = alpha + a * (1 - alpha);
      for (let c = 0; c < 3; c++) data[i * 4 + c] = (data[i * 4 + c]! * alpha + glow[c]! * a * (1 - alpha * 0.6)) / Math.max(outA, 1e-3);
      data[i * 4 + 3] = outA * 255;
    }
  }

  return { width, height, data };
}

/** Separable box blur of a scalar field. */
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * width + Math.min(width - 1, Math.max(0, x))]!;
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / span;
      sum += src[y * width + Math.min(width - 1, x + radius + 1)]! - src[y * width + Math.max(0, x - radius)]!;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x]!;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      sum += tmp[Math.min(height - 1, y + radius + 1) * width + x]! - tmp[Math.max(0, y - radius) * width + x]!;
    }
  }
  return out;
}
