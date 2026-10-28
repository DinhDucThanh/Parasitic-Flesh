import { BLAST } from "../core/config";
import { TAU, rand, type Vec2 } from "../core/math";

export type ExplosionKind = "acid" | "meltdown" | "spark";

export class Explosion {
  readonly position: Vec2;
  readonly radius: number;
  readonly duration: number;
  readonly kind: ExplosionKind;
  age = 0;
  alive = true;

  constructor(x: number, y: number, radius: number, duration: number, kind: ExplosionKind) {
    this.position = { x, y };
    this.radius = radius;
    this.duration = duration;
    this.kind = kind;
  }

  get t(): number {
    return Math.min(1, this.age / this.duration);
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age >= this.duration) this.alive = false;
  }
}

export class Particle {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly maxLife: number;
  readonly size: number;
  readonly color: string;
  readonly gravity: number;
  life: number;
  alive = true;

  constructor(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, gravity = 0) {
    this.position = { x, y };
    this.velocity = { x: vx, y: vy };
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.color = color;
    this.gravity = gravity;
  }

  update(dt: number): void {
    this.life -= dt;
    if (this.life <= 0) {
      this.alive = false;
      return;
    }
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.velocity.x *= 1 - 3.2 * dt;
    this.velocity.y = this.velocity.y * (1 - 3.2 * dt) + this.gravity * dt;
  }

  get alpha(): number {
    return Math.max(0, this.life / this.maxLife);
  }
}

/** Lingering acid puddle from the mutant graft. Damages enemies, never the player. */
export class Hazard {
  readonly position: Vec2;
  readonly radius: number;
  readonly dps: number;
  readonly maxLife: number;
  life: number;
  alive = true;
  phase = Math.random() * TAU;

  constructor(x: number, y: number, radius: number, life: number, dps: number) {
    this.position = { x, y };
    this.radius = radius;
    this.life = life;
    this.maxLife = life;
    this.dps = dps;
  }

  update(dt: number): void {
    this.phase += dt * 3;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  get alpha(): number {
    return Math.min(1, this.life / (this.maxLife * 0.4));
  }
}

/** Spray of gibs / acid droplets, purely cosmetic. */
export function spawnBurst(
  out: Particle[],
  x: number,
  y: number,
  count: number,
  speed: number,
  color: string,
  size = 3,
  life = 0.6,
): void {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, TAU);
    const force = rand(speed * 0.25, speed);
    out.push(
      new Particle(
        x,
        y,
        Math.cos(angle) * force,
        Math.sin(angle) * force,
        rand(life * 0.4, life),
        rand(size * 0.5, size * 1.6),
        color,
      ),
    );
  }
}

/** Shockwave ring that expands to the blast radius. */
export class BlastWave {
  readonly position: Vec2;
  readonly radius: number;
  age = 0;
  readonly duration = 0.42;
  alive = true;

  constructor(x: number, y: number, radius: number) {
    this.position = { x, y };
    this.radius = radius;
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age >= this.duration) this.alive = false;
  }

  get t(): number {
    return Math.min(1, this.age / this.duration);
  }
}

export function spawnExplosion(
  effects: Explosion[],
  particles: Particle[],
  x: number,
  y: number,
  radius: number = BLAST.radius,
  kind: ExplosionKind = "acid",
): void {
  effects.push(new Explosion(x, y, radius, kind === "meltdown" ? 0.9 : 0.5, kind));
  spawnBurst(particles, x, y, kind === "spark" ? 6 : 22, 420, kind === "meltdown" ? "#ff5a3c" : "#b6ff3d", 3.4, 0.75);
  // Gib chunks
  if (kind !== "spark") {
    spawnBurst(particles, x, y, 8, 260, "#7d1420", 5, 0.9);
  }
}
