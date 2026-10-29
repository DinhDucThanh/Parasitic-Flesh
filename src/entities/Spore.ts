import { clampToArena, type Bounds } from "../core/arena";
import { SPORE } from "../core/config";
import { clamp, distance, type Vec2 } from "../core/math";
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

  /** Smoothed heading of travel; picks the 4-way slither row and the lean. */
  visualAngle = 0;
  targetAngle = 0;
  /** Damped spring that sloshes the membrane after an abrupt turn. */
  wobbleVelocity = 0;
  wobbleDisplacement = 0;
  /** Last unit heading, used to detect a sharp reversal. */
  lastMoveDir: Vec2 = { x: 1, y: 0 };

  animation = "idle";
  animationTime = 0;
  private trailClock = 0;

  constructor(x: number, y: number) {
    super(x, y, SPORE.radius);
  }

  reset(pos: Vec2): void {
    this.position.x = pos.x;
    this.position.y = pos.y;
    this.state = "free";
    this.alive = true;
    this.targetId = null;
    this.flightTime = 0;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.trail.length = 0;
    this.animation = "idle";
    this.animationTime = 0;
    this.visualAngle = 0;
    this.targetAngle = 0;
    this.wobbleVelocity = 0;
    this.wobbleDisplacement = 0;
    this.lastMoveDir = { x: 1, y: 0 };
  }

  /** Bullets can only touch the spore when it is outside a body. */
  get isExposed(): boolean {
    return this.state !== "hosted" && this.state !== "ejectAim";
  }

  tick(dt: number): void {
    this.pulse += dt;
    this.updateWobble(dt);
    const moving = Math.hypot(this.velocity.x, this.velocity.y) > 1;
    const next = !this.alive ? "death"
      : this.state === "flying" ? "charge"
      : this.state === "aiming" || this.state === "ejectAim" ? "charge"
      : moving ? this.slitherTrack() : "idle";
    if (next !== this.animation) { this.animation = next; this.animationTime = 0; }
    else this.animationTime += dt;
    for (const node of this.trail) node.life -= dt;
    for (let i = this.trail.length - 1; i >= 0; i -= 1) {
      if ((this.trail[i] as TrailNode).life <= 0) this.trail.splice(i, 1);
    }
  }

  /** Eases the visual heading and integrates the surface-tension spring. */
  private updateWobble(dt: number): void {
    const diff = Math.atan2(Math.sin(this.targetAngle - this.visualAngle), Math.cos(this.targetAngle - this.visualAngle));
    this.visualAngle += diff * Math.min(1, dt * 14);
    const force = -140 * this.wobbleDisplacement - 12 * this.wobbleVelocity;
    this.wobbleVelocity = clamp(this.wobbleVelocity + force * dt, -30, 30);
    this.wobbleDisplacement = clamp(this.wobbleDisplacement + this.wobbleVelocity * dt, -1, 1);
  }

  /** Quantize the smoothed heading into the down / up / side sheet rows. */
  private slitherTrack(): "down" | "up" | "side" {
    const sy = Math.sin(this.visualAngle);
    if (sy > Math.SQRT1_2) return "down";
    if (sy < -Math.SQRT1_2) return "up";
    return "side";
  }

  /** 0..1 travel speed, used for the stretch half of the jelly deform. */
  get speedFraction(): number {
    return Math.min(1, Math.hypot(this.velocity.x, this.velocity.y) / SPORE.speed);
  }

  get deformX(): number {
    return 1 + this.speedFraction * 0.35 + this.wobbleDisplacement * 0.25;
  }

  get deformY(): number {
    return 1 - this.speedFraction * 0.21 - this.wobbleDisplacement * 0.25;
  }

  /** Free-roam movement. `dt` is already time-scaled by the caller. */
  move(dt: number, axis: Vec2, bounds?: Bounds): void {
    const len = Math.hypot(axis.x, axis.y);
    if (len < 1e-4) { this.velocity.x = 0; this.velocity.y = 0; return; }
    const nx = axis.x / len, ny = axis.y / len;
    // A sharp reversal sloshes the membrane: the spring converts it into torsion.
    if (nx * this.lastMoveDir.x + ny * this.lastMoveDir.y < 0.6) this.wobbleVelocity += 7.5;
    this.lastMoveDir = { x: nx, y: ny };
    this.targetAngle = Math.atan2(ny, nx);
    this.velocity.x = nx * SPORE.speed;
    this.velocity.y = ny * SPORE.speed;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    clampToArena(this.position, this.radius, bounds);
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
