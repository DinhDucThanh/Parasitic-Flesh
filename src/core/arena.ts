import { ARENA } from "./config";
import { clamp, type Vec2 } from "./math";

/** Axis-aligned world rectangle (walls, doors, cover). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Keep a circle of `radius` inside the playable floor. */
export function clampToArena(p: Vec2, radius: number): void {
  const min = ARENA.wall + radius;
  p.x = clamp(p.x, min, ARENA.width - min);
  p.y = clamp(p.y, min, ARENA.height - min);
}

/**
 * Push a circle out of a single axis-aligned rectangle. When the center is
 * inside the box we eject along the nearest face, which stays stable in
 * corners and never leaves an entity permanently embedded.
 */
export function resolveCircleRect(p: Vec2, radius: number, rect: Rect): void {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const closestX = clamp(p.x, rect.x, right);
  const closestY = clamp(p.y, rect.y, bottom);
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq > radius * radius) return;

  if (distanceSq > 1e-6) {
    const distance = Math.sqrt(distanceSq);
    p.x = closestX + (dx / distance) * radius;
    p.y = closestY + (dy / distance) * radius;
    return;
  }

  // Center is inside the rectangle: pick the closest face.
  const toLeft = p.x - rect.x;
  const toRight = right - p.x;
  const toTop = p.y - rect.y;
  const toBottom = bottom - p.y;
  const nearest = Math.min(toLeft, toRight, toTop, toBottom);
  if (nearest === toLeft) p.x = rect.x - radius;
  else if (nearest === toRight) p.x = right + radius;
  else if (nearest === toTop) p.y = rect.y - radius;
  else p.y = bottom + radius;
}

/** Resolve a body against every solid rectangle. Two passes handle corners. */
export function resolveCircleWalls(p: Vec2, radius: number, walls: readonly Rect[]): void {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const wall of walls) resolveCircleRect(p, radius, wall);
  }
}

/** Slab test used for fast projectiles that could tunnel through a thin wall. */
export function segmentIntersectsRect(a: Vec2, b: Vec2, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let tMin = 0;
  let tMax = 1;

  const check = (start: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) < 1e-8) return start >= min && start <= max;
    let t1 = (min - start) / delta;
    let t2 = (max - start) / delta;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    return tMin <= tMax;
  };

  return (
    check(a.x, dx, rect.x, rect.x + rect.w) &&
    check(a.y, dy, rect.y, rect.y + rect.h)
  );
}
