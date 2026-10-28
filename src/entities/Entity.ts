import { distance, type Vec2 } from "../core/math";

/** Base for anything that owns a world position and a collision radius. */
export class Entity {
  private static sequence = 1;

  readonly id: number = Entity.sequence++;
  readonly position: Vec2;
  readonly velocity: Vec2 = { x: 0, y: 0 };
  radius: number;
  alive = true;

  constructor(x: number, y: number, radius: number) {
    this.position = { x, y };
    this.radius = radius;
  }

  distanceTo(p: Vec2): number {
    return distance(this.position, p);
  }

  /** Integrate velocity for one step. Systems usually move entities directly. */
  integrate(dt: number): void {
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
  }
}
