import type { Vec2 } from "../core/math";

/**
 * Destructible proving-ground target. Stationary, not a host: it cannot be
 * hijacked and it never shoots back. Only the training chambers spawn these.
 */
export class TrainingTarget {
  readonly position: Vec2;
  readonly radius = 21;
  readonly maxHp = 3;
  hp = 3;
  alive = true;
  hitFlash = 0;
  phase = Math.random() * Math.PI * 2;

  constructor(x: number, y: number) {
    this.position = { x, y };
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.hitFlash = 1;
    if (this.hp <= 0) this.alive = false;
  }

  update(dt: number): void {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.phase += dt * 2.4;
  }
}
