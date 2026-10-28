import { AIM, BLAST, CHIMERA, HITSTOP, POSSESSION, SPORE } from "../core/config";
import { angleDelta, clamp, type Vec2 } from "../core/math";
import { GRAFT_BY_KIND, type GraftKind, type Host } from "../entities/Host";
import type { World } from "../world/World";
import { spawnBurst } from "./Effects";

/**
 * The hijack loop: snap-aim, launch, possession, ejection.
 *
 * All player input that concerns the spore or a possessed body lives here so
 * the state machine is readable top to bottom.
 */
export class HijackSystem {
  /** Enemy host currently under the pulsing reticle. */
  locked: Host | null = null;
  aimAngle = 0;
  /** Time spent holding RMB, used to suppress the "no target" click on taps. */
  private aimTime = 0;
  /** True while bullet-time is active (recorded at the end of each update). */
  aiming = false;
  /** True while R is held in a body: bullet-time aim, release to detonate. */
  detonating = false;
  /** Detonation charges left; one refills every POSSESSION.chargeRecharge seconds. */
  charges: number = POSSESSION.maxCharges;
  private rechargeTimer = 0;

  /** 0..1 progress toward the next charge (1 when full). */
  get rechargeFraction(): number {
    if (this.charges >= POSSESSION.maxCharges) return 1;
    return clamp(this.rechargeTimer / POSSESSION.chargeRecharge, 0, 1);
  }

  reset(): void {
    this.locked = null;
    this.aiming = false;
    this.aimTime = 0;
    this.detonating = false;
    this.charges = POSSESSION.maxCharges;
    this.rechargeTimer = 0;
  }

  update(dtReal: number, dtSim: number, world: World): void {
    const spore = world.spore;
    const input = world.input;
    const mouse = world.mouseWorld;
    this.tickCharges(dtReal);

    switch (spore.state) {
      case "free": {
        spore.move(dtSim, input.moveAxis);
        spore.aimAngle = Math.atan2(mouse.y - spore.position.y, mouse.x - spore.position.x);
        if (input.rightPressed) {
          spore.state = "aiming";
          this.aimTime = 0;
          this.clearLock();
          world.sfx.play("whisper");
        }
        break;
      }

      case "aiming": {
        this.aimTime += dtReal;
        // Real-time drift keeps aiming responsive inside 0.18x bullet-time.
        spore.move(dtReal * SPORE.aimMove, input.moveAxis);
        this.updateAim(world, spore.position, mouse);
        if (!input.rightHeld) this.releaseAim(world);
        break;
      }

      case "flying": {
        const target = world.hostById(spore.targetId);
        if (!target || !target.alive || target.possessed) {
          spore.state = "free";
          spore.targetId = null;
          break;
        }
        if (spore.updateFlight(dtSim, target.position)) this.hijack(target, world);
        break;
      }

      case "hosted": {
        const host = world.possessed;
        if (!host) {
          spore.state = "free";
          break;
        }
        spore.position.x = host.position.x;
        spore.position.y = host.position.y;
        if (this.detonating) {
          // Bullet-time aim only: the body holds still while the charge is armed.
          host.sprinting = false;
          this.updateAim(world, host.position, mouse);
          if (!input.isDown("KeyR")) this.detonate(host, world);
          break;
        }
        this.driveHost(host, dtSim, world, mouse);
        if (input.wasPressed("KeyR")) {
          if (this.charges > 0) {
            this.detonating = true;
            this.aimTime = 0;
            this.clearLock();
            world.sfx.play("whisper");
          } else {
            world.sfx.play("denied");
          }
        } else if (input.rightPressed || input.wasPressed("Space")) {
          this.beginLeap(host, world);
        }
        break;
      }

      case "ejectAim": {
        const host = world.possessed;
        if (!host) {
          spore.state = "free";
          break;
        }
        this.aimTime += dtReal;
        spore.position.x = host.position.x;
        spore.position.y = host.position.y;
        this.driveHost(host, dtSim, world, mouse);
        this.updateAim(world, host.position, mouse);
        if (!input.rightHeld && !input.isDown("Space")) this.leap(host, world);
        break;
      }
    }

    if (spore.state !== "hosted") this.detonating = false;
    spore.tick(dtReal);
    this.aiming = spore.state === "aiming" || spore.state === "ejectAim" || this.detonating;
  }

  private tickCharges(dtReal: number): void {
    if (this.charges >= POSSESSION.maxCharges) {
      this.rechargeTimer = 0;
      return;
    }
    this.rechargeTimer += dtReal;
    if (this.rechargeTimer >= POSSESSION.chargeRecharge) {
      this.rechargeTimer = 0;
      this.charges += 1;
    }
  }

  /** Starts a leap aim, or refuses while the neural link is still calibrating. */
  private beginLeap(host: Host, world: World): void {
    if (host.possessedTime < POSSESSION.switchLockout) {
      host.calibrateFlash = 1.2;
      world.sfx.play("denied");
      return;
    }
    world.spore.state = "ejectAim";
    this.aimTime = 0;
    this.clearLock();
    world.sfx.play("whisper");
  }

  /** Movement + weapon for a possessed host, including critical-decay aim jitter. */
  private driveHost(host: Host, dtSim: number, world: World, mouse: Vec2): void {
    // A chimera mid-burst has one committed trajectory: no steering, no shots.
    if (host.isDashing) {
      host.sprinting = false;
      host.facing = Math.atan2(host.dashDir.y, host.dashDir.x);
      return;
    }

    // Shift sprints: faster movement, but the decay clock drains faster too.
    const axis = world.input.moveAxis;
    const moving = Math.hypot(axis.x, axis.y) > 1e-4;
    // Sprint drains stamina and is refused while exhausted or out of stamina.
    host.sprinting = host.updateStamina(
      dtSim,
      moving,
      world.input.anyDown("ShiftLeft", "ShiftRight"),
    );
    // Chimera creep: enough to reposition, never enough to chase.
    const creep = CHIMERA.creep * (host.sprinting ? POSSESSION.sprintMultiplier : 1);
    const moveSpeed = host.kind === "mutant" ? creep : host.speed;
    // Glide carries sprint momentum through a release instead of stopping dead.
    host.glide(axis, dtSim, moveSpeed);
    if (host.sprinting && moving) {
      // Dust kicked up behind the body while sprinting.
      const len = Math.hypot(axis.x, axis.y) || 1;
      spawnBurst(
        world.particles,
        host.position.x - (axis.x / len) * host.radius,
        host.position.y - (axis.y / len) * host.radius,
        1,
        30,
        "#9dffc9",
        2.4,
        0.35,
      );
    }

    let aim = Math.atan2(mouse.y - host.position.y, mouse.x - host.position.x);
    if (host.decay < 3) {
      const panic = 1 - clamp(host.decay / 3, 0, 1);
      aim += Math.sin(world.elapsed * 23.7) * 0.055 * panic;
    }
    host.facing = aim;

    if (host.kind === "mutant") {
      // Attacking IS moving: LMB fires a 220px dash toward the cursor.
      if (world.input.leftPressed) {
        world.combat.attack(host, mouse, world);
      }
      return;
    }

    if (world.input.leftHeld) {
      const reach = 700;
      world.combat.attack(host, {
        x: host.position.x + Math.cos(aim) * reach,
        y: host.position.y + Math.sin(aim) * reach,
      }, world);
    }
  }

  private updateAim(world: World, from: Vec2, mouse: Vec2): void {
    const angle = Math.atan2(mouse.y - from.y, mouse.x - from.x);
    this.aimAngle = angle;
    world.spore.aimAngle = angle;
    this.locked = this.findTarget(world, from, angle);
  }

  /** Nearest valid host inside the aiming cone, preferring the aim line. */
  private findTarget(world: World, from: Vec2, angle: number): Host | null {
    let best: Host | null = null;
    let bestScore = Infinity;
    for (const host of world.hosts) {
      if (!host.alive || host.possessed) continue;
      const dist = Math.hypot(host.position.x - from.x, host.position.y - from.y);
      if (dist > AIM.range || dist < 1) continue;
      // Chamber walls and sealed blast doors block the leap; this is what keeps
      // the Proving Ground linear and prevents hijacking through geometry.
      if (world.segmentBlocked(from, host.position)) continue;
      const delta = Math.abs(angleDelta(angle, Math.atan2(host.position.y - from.y, host.position.x - from.x)));
      if (delta > AIM.cone) continue;
      const score = (delta / AIM.cone) * 0.65 + (dist / AIM.range) * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = host;
      }
    }
    return best;
  }

  private releaseAim(world: World): void {
    const target = this.locked;
    if (target) {
      world.spore.beginFlight(target.id);
      world.sfx.play("launch");
      world.addTrauma(0.1);
    } else {
      world.spore.state = "free";
      if (this.aimTime > 0.18) world.sfx.play("denied");
    }
    this.clearLock();
  }

  /**
   * Silent leap: the old body collapses limp with no blast and the spore flies
   * to the locked host. Without a target the switch is cancelled and the body stays.
   */
  private leap(host: Host, world: World): void {
    const target = this.locked;
    if (!target) {
      world.spore.state = "hosted";
      if (this.aimTime > 0.18) world.sfx.play("denied");
      this.clearLock();
      return;
    }
    const origin = { x: host.position.x, y: host.position.y };

    host.alive = false;
    host.possessed = false;
    host.sprinting = false;
    world.lastHostKind = host.kind;
    world.decals.stampBlood(origin.x, origin.y, host.radius + 12);
    spawnBurst(world.particles, origin.x, origin.y, 8, 160, "#7d1420", 3, 0.5);
    world.addTrauma(0.2);
    world.sfx.play("launch");
    world.lore.unlock("log_04");

    world.spore.reset(origin);
    world.spore.beginFlight(target.id);
    this.clearLock();
  }

  /** Releasing R: spend one charge to blow the current body apart. */
  private detonate(host: Host, world: World): void {
    this.detonating = false;
    if (this.charges <= 0) return;
    this.charges -= 1;

    const target = this.locked;
    const origin = { x: host.position.x, y: host.position.y };
    const kind = host.kind;

    host.alive = false;
    host.possessed = false;
    host.sprinting = false;
    world.lastHostKind = kind;
    world.decals.stampDetonation(origin.x, origin.y, POSSESSION.detonateRadius);
    world.decals.stampBlood(origin.x, origin.y, host.radius + 12);
    spawnBurst(world.particles, origin.x, origin.y, 18, 380, "#7d1420", 4, 0.8);
    world.combat.explode(origin.x, origin.y, POSSESSION.detonateRadius, BLAST.damage, world, "acid");
    world.addTrauma(0.7);
    world.stop(HITSTOP.blast);
    world.sfx.play("eject");
    world.lore.unlock("log_04");

    world.spore.reset(origin);
    if (target && target.alive) {
      world.spore.beginFlight(target.id);
    }
    this.clearLock();
  }

  /** Impact: micro-freeze, shake, body swap, graft transfer and a memory whisper. */
  private hijack(target: Host, world: World): void {
    const source = world.lastHostKind;
    // Flush the click that was held during the leap before the body can act.
    world.input.clearMouseState();
    target.becomePossessed();
    world.spore.state = "hosted";
    world.spore.targetId = null;

    if (source) {
      const graft = GRAFT_BY_KIND[source];
      target.grafts.add(graft);
      world.announceGraft(graft);
      world.lastHostKind = null;
    }

    world.stats.hijacks += 1;
    world.addTrauma(0.4);
    world.stop(HITSTOP.hijack);
    world.sfx.play("hijack");
    world.decals.stampBlood(target.position.x, target.position.y, target.radius + 6);
    spawnBurst(world.particles, target.position.x, target.position.y, 14, 260, "#00ff88", 2.8, 0.6);
    world.showWhisper(target);
    this.clearLock();
  }

  private clearLock(): void {
    this.locked = null;
  }
}

/** Named for the codex: which body grants which passive. */
export const GRAFT_INFO: Record<Host["kind"], { graft: GraftKind; name: string; detail: string }> = {
  security: {
    graft: "sidearm",
    name: "SHOULDER SIDEARM",
    detail: "An autonomous sidearm tracks the nearest hostile.",
  },
  enforcer: {
    graft: "dorsalShield",
    name: "DORSAL PLATING",
    detail: "Grafted plating turns your back into a wall.",
  },
  mutant: {
    graft: "acidStride",
    name: "ACID STRIDE",
    detail: "Caustic footsteps burn anything that follows.",
  },
};
