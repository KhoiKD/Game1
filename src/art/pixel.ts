/**
 * Pure helpers for pixel art written as text. A grid is a list of equal-length
 * rows; each character is a palette letter, and "." is transparent. Nothing
 * here touches Phaser, so the art data can be checked by unit tests.
 */
export type Grid = readonly string[];

export const TRANSPARENT = '.';

export function gridSize(grid: Grid): { width: number; height: number } {
  return { width: grid[0]?.length ?? 0, height: grid.length };
}

/** Problems with a grid: uneven rows, or letters the palette does not define. */
export function gridProblems(grid: Grid, palette: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  if (grid.length === 0) return ['empty grid'];
  const width = grid[0]!.length;
  grid.forEach((row, y) => {
    if (row.length !== width) problems.push(`row ${y} is ${row.length} wide, expected ${width}`);
    for (const char of row) {
      if (char !== TRANSPARENT && palette[char] === undefined) problems.push(`row ${y} uses "${char}", which has no colour`);
    }
  });
  return [...new Set(problems)];
}

/** Builds a symmetric grid from its left half: each row is followed by its own reverse. */
export function mirror(halfRows: Grid): Grid {
  return halfRows.map((row) => row + [...row].reverse().join(''));
}

/** A copy of `grid` with the rows starting at `at` replaced: how a second animation frame is made. */
export function replaceRows(grid: Grid, at: number, rows: Grid): Grid {
  const out = [...grid];
  rows.forEach((row, i) => {
    if (at + i < out.length) out[at + i] = row;
  });
  return out;
}

/** Swaps palette letters, for example to alternate which leg is shaded in a run cycle. */
export function swapChars(grid: Grid, swaps: Readonly<Record<string, string>>): Grid {
  return grid.map((row) => [...row].map((char) => swaps[char] ?? char).join(''));
}

/**
 * Draws `top` over `bottom` at a row offset; opaque pixels of `top` win. Used
 * to put a character's upper body (bobbing up and down) over a leg pose.
 */
export function layer(bottom: Grid, top: Grid, offsetY: number, height: number): Grid {
  const width = Math.max(gridSize(bottom).width, gridSize(top).width);
  const rows: string[][] = Array.from({ length: height }, () => Array<string>(width).fill(TRANSPARENT));
  const draw = (grid: Grid, dy: number): void => {
    grid.forEach((row, y) => {
      const target = rows[y + dy];
      if (!target) return;
      [...row].forEach((char, x) => {
        if (char !== TRANSPARENT) target[x] = char;
      });
    });
  };
  draw(bottom, height - bottom.length);
  draw(top, offsetY);
  return rows.map((row) => row.join(''));
}

/**
 * The pixels to paint, with a one-pixel outline added around every opaque
 * pixel. The result is two pixels wider and taller than the grid. Returns
 * [x, y, colour] for each pixel.
 */
export function rasterize(
  grid: Grid,
  palette: Readonly<Record<string, string>>,
  outline: string,
): { width: number; height: number; pixels: Array<[number, number, string]> } {
  const { width, height } = gridSize(grid);
  const opaque = (x: number, y: number): boolean => {
    const char = grid[y]?.[x];
    return char !== undefined && char !== TRANSPARENT;
  };
  const pixels: Array<[number, number, string]> = [];
  for (let y = -1; y <= height; y++) {
    for (let x = -1; x <= width; x++) {
      if (opaque(x, y)) {
        pixels.push([x + 1, y + 1, palette[grid[y]![x]!]!]);
      } else if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
        pixels.push([x + 1, y + 1, outline]);
      }
    }
  }
  return { width: width + 2, height: height + 2, pixels };
}
