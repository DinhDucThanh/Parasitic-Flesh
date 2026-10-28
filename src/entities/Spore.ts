import { clampToArena } from "../core/arena";
import { SPORE } from "../core/config";
import { distance, type Vec2 } from "../core/math";
import { Entity } from "./Entity";

export type SporeState = "free" | "aiming" | "flying" | "ejectAim" | "hosted";

export interface TrailNode {
  x: number;
  y: number;
  life: number;
  size: number;
}

/**
 * The player's true body. Holds only state and movement; HijackSystem drives
 * the transitions, so the state machine reads in one place.
 */
export class Spore extends Entity {
  state: SporeState = "free";
  targetId: number | null = null;
  aimAngle = 0;
  flightTime = 0;
  /** Continuous clock used by the organic blob animation. */
  pulse = 0;
  readonly trail: TrailNode[] = [];

  private trailClock = 0;

  constructor(x: number, y: number) {
    super(x, y, SPORE.radius);
  }

  reset(pos: Vec2): void {
    this.position.x = pos.x;
    this.position.y = pos.y;
    this.state = "free";
    this.targetId = null;
    this.flightTime = 0;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.trail.length = 0;
  }

  /** Bullets can only touch the spore when it is outside a body. */
  get isExposed(): boolean {
    return this.state !== "hosted" && this.state !== "ejectAim";
  }

  tick(dt: number): void {
    this.pulse += dt;
    for (const node of this.trail) node.life -= dt;
    for (let i = this.trail.length - 1; i >= 0; i -= 1) {
      if ((this.trail[i] as TrailNode).life <= 0) this.trail.splice(i, 1);
    }
  }

  /** Free-roam movement. `dt` is already time-scaled by the caller. */
  move(dt: number, axis: Vec2): void {
    const len = Math.hypot(axis.x, axis.y);
    if (len < 1e-4) return;
    this.position.x += (axis.x / len) * SPORE.speed * dt;
    this.position.y += (axis.y / len) * SPORE.speed * dt;
    clampToArena(this.position, this.radius);
  }

  beginFlight(targetId: number): void {
    this.state = "flying";
    this.targetId = targetId;
    this.flightTime = 0;
    this.trail.length = 0;
  }

  /** Returns true when the spore reaches the (possibly moving) host body. */
  updateFlight(dt: number, target: Vec2): boolean {
    this.flightTime += dt;
    const dist = distance(this.position, target);
    const step = SPORE.flightSpeed * dt;

    if (dist <= step + this.radius || this.flightTime >= SPORE.maxFlightTime) {
      this.position.x = target.x;
      this.position.y = target.y;
      return true;
    }

    const dx = (target.x - this.position.x) / dist;
    const dy = (target.y - this.position.y) / dist;
    this.position.x += dx * step;
    this.position.y += dy * step;
    this.aimAngle = Math.atan2(dy, dx);

    this.trailClock += dt;
    if (this.trailClock >= 0.012) {
      this.trailClock = 0;
      this.trail.push({
        x: this.position.x,
        y: this.position.y,
        life: 0.3,
        size: this.radius * (0.6 + Math.random() * 0.5),
      });
    }
    return false;
  }
}
