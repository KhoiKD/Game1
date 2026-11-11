export interface Vec2 {
  x: number;
  y: number;
}

/** Angle in radians from `from` to `to` (0 = right, positive = clockwise on screen). */
export function aimAngle(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Unit vector pointing from `from` toward `to`. Returns (1, 0) when the points coincide. */
export function aimVector(from: Vec2, to: Vec2): Vec2 {
  if (from.x === to.x && from.y === to.y) return { x: 1, y: 0 };
  const a = aimAngle(from, to);
  return { x: Math.cos(a), y: Math.sin(a) };
}
