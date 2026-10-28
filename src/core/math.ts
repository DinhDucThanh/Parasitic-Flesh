/** Small, dependency-free 2D math helpers shared by every layer. */

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len > 1e-6 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/** Frame-rate independent smoothing factor for `lerp`-style interpolation. */
export const smoothing = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Shortest signed rotation from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function approachAngle(current: number, target: number, maxStep: number): number {
  return current + clamp(angleDelta(current, target), -maxStep, maxStep);
}

export const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
