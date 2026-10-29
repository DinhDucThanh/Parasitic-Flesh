import type { Vec2 } from "../core/math";

export type Team = "player" | "enemy";
export type ProjectileKind = "rifle" | "pellet";

export class Projectile {
  readonly position: Vec2;
  readonly previous: Vec2;
  readonly velocity: Vec2;
  readonly damage: number;
  readonly team: Team;
  readonly kind: ProjectileKind;
  readonly color: string;
  readonly radius: number;
  readonly length: number;
  /** Slow, readable rounds need a long travel window to cross the arena. */
  life = 2.2;
  alive = true;

  constructor(
    x: number,
    y: number,
    vx: number,
    vy: number,
    damage: number,
    team: Team,
    kind: ProjectileKind,
    color: string,
  ) {
    this.position = { x, y };
    this.previous = { x, y };
    this.velocity = { x: vx, y: vy };
    this.damage = damage;
    this.team = team;
    this.kind = kind;
    this.color = color;
    this.radius = kind === "pellet" ? 2.6 : 3.1;
    this.length = kind === "pellet" ? 9 : 14;
  }

  update(dt: number): void {
    this.previous.x = this.position.x;
    this.previous.y = this.position.y;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }

  get angle(): number {
    return Math.atan2(this.velocity.y, this.velocity.x);
  }
}
