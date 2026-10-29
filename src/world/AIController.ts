import { CHIMERA } from "../core/config";
import { rand } from "../core/math";
import type { Host } from "../entities/Host";
import type { World } from "./World";

/** Gun hosts lock up for this long before firing. */
const GUN_WINDUP = 0.45;

/**
 * Hostile host behaviour.
 *
 *   Security  - hold mid range, strafe, fire precise telegraphed shots.
 *   Enforcer  - advance behind the shield, delete close range with a shotgun.
 *   Chimera   - NEVER chases. It stalks at 0 px/s, coils for 0.45s, bursts
 *               along a locked line for 0.22s, then sits in an 0.8s recovery.
 *
 * The chimera loop is deliberately rigid: stalk -> windup -> dash -> recover.
 * That fixed rhythm is what turns a formerly oppressive chaser into a fair,
 * punishable ambush predator.
 */
export class AIController {
  update(host: Host, dt: number, world: World): void {
    // Sealed chambers: hostiles in a chamber the player has not entered stay
    // completely dormant, staring at the bulkhead until their door opens.
    if (world.tutorial && world.tutorial.roomAt(host.position.x) !== world.playerRoom) {
      host.windup = 0;
      host.windupKind = null;
      host.aimLaser = 0;
      host.moving = 0;
      return;
    }
    if (host.kind === "mutant") {
      this.updateChimera(host, dt, world);
      return;
    }
    this.updateGunner(host, dt, world);
  }

  // --- Mutant Chimera -------------------------------------------------------

  private updateChimera(host: Host, dt: number, world: World): void {
    const ai = host.ai;
    const target = world.playerPoint;
    const dx = target.x - host.position.x;
    const dy = target.y - host.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);

    ai.leapCooldown = Math.max(0, ai.leapCooldown - dt);
    host.moving = 0;
    host.aimLaser = 0;

    switch (host.lungePhase) {
      case "dash": {
        // CombatSystem owns the burst movement; the AI only watches for the end.
        host.windup = 0;
        host.facing = Math.atan2(host.dashDir.y, host.dashDir.x);
        if (host.dashTime <= 0) {
          host.lungePhase = "recover";
          host.lungeTimer = CHIMERA.recovery;
        }
        return;
      }

      case "recover": {
        // Fully helpless: no movement, no turning, no attack.
        host.lungeTimer = Math.max(0, host.lungeTimer - dt);
        host.windup = 0;
        if (host.lungeTimer <= 0) {
          host.lungePhase = "stalk";
          ai.leapCooldown = CHIMERA.cooldown;
        }
        return;
      }

      case "windup": {
        host.lungeTimer = Math.max(0, host.lungeTimer - dt);
        host.windup = host.lungeTimer;
        host.windupKind = "leap";
        host.windupDir = { x: Math.cos(host.facing), y: Math.sin(host.facing) };
        host.aimLaser = 1;
        // Head tracks slowly during the coil, then the direction locks at launch.
        if (dist <= CHIMERA.detectRange) host.turnToward(angle, CHIMERA.turnRate, dt);
        if (host.lungeTimer <= 0) this.launchLunge(host, world);
        return;
      }

      default: {
        // Stalk: rooted in place, slowly tracking only inside detection range.
        host.windup = 0;
        if (dist <= CHIMERA.detectRange) host.turnToward(angle, CHIMERA.turnRate, dt);
        if (dist <= CHIMERA.lungeRange && ai.leapCooldown <= 0) {
          host.lungePhase = "windup";
          host.lungeTimer = CHIMERA.windup;
          host.windup = CHIMERA.windup;
          host.windupKind = "leap";
          host.windupDir = { x: Math.cos(host.facing), y: Math.sin(host.facing) };
          host.aimLaser = 1;
        }
      }
    }
  }

  /** Lock the line to where the player is NOW, then hand the burst to combat. */
  private launchLunge(host: Host, world: World): void {
    const target = world.playerPoint;
    const angle = Math.atan2(target.y - host.position.y, target.x - host.position.x);
    host.facing = angle;
    host.windup = 0;
    host.aimLaser = 0;
    host.lungePhase = "dash";
    host.lungeTimer = 0;
    world.combat.lunge(host, angle, world);
  }

  // --- Security / Enforcer --------------------------------------------------

  private updateGunner(host: Host, dt: number, world: World): void {
    const ai = host.ai;
    const target = world.playerPoint;
    const dx = target.x - host.position.x;
    const dy = target.y - host.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx);
    const dir = { x: dx / dist, y: dy / dist };
    const perp = { x: -dir.y, y: dir.x };

    ai.reaction = Math.max(0, ai.reaction - dt);
    ai.fireTimer = Math.max(0, ai.fireTimer - dt);
    ai.decide -= dt;
    if (ai.decide <= 0) {
      ai.decide = rand(1.2, 2.4);
      ai.strafe = Math.random() < 0.5 ? -1 : 1;
    }

    const turnRate = host.kind === "enforcer" ? 3.1 : 6.4;
    host.turnToward(angle, turnRate, dt);

    // --- Telegraph window: feet planted, laser live, facing still tracking.
    if (ai.windup > 0) {
      ai.windup -= dt;
      host.windup = Math.max(0, ai.windup);
      host.windupKind = ai.windupKind;
      host.windupDir = dir;
      host.aimLaser = 1;
      host.moving = Math.max(0, host.moving - dt * 10);
      if (ai.windup <= 0) {
        this.release(host, world, target, dist);
        ai.windup = 0;
        ai.windupKind = null;
        host.windup = 0;
        host.windupKind = null;
        host.aimLaser = 0;
      }
      return;
    }

    host.aimLaser = 0;

    // --- Steering -----------------------------------------------------------
    let steerX = 0;
    let steerY = 0;
    if (host.kind === "security") {
      const ideal = 340;
      const push = dist > ideal + 70 ? 1 : dist < ideal - 90 ? -1 : 0;
      steerX = dir.x * push + perp.x * ai.strafe * 0.42;
      steerY = dir.y * push + perp.y * ai.strafe * 0.42;
    } else {
      const push = dist > 210 ? 1 : 0;
      steerX = dir.x * push + perp.x * ai.strafe * 0.18;
      steerY = dir.y * push + perp.y * ai.strafe * 0.18;
    }

    // Separation so packs don't stack into one silhouette.
    for (const other of world.hosts) {
      if (other === host || !other.alive) continue;
      const ox = host.position.x - other.position.x;
      const oy = host.position.y - other.position.y;
      const d = Math.hypot(ox, oy);
      const min = host.radius + other.radius + 14;
      if (d > 0.01 && d < min) {
        const force = (1 - d / min) * 1.4;
        steerX += (ox / d) * force;
        steerY += (oy / d) * force;
      }
    }

    host.move({ x: steerX, y: steerY }, dt, host.speed, world.bounds);
    host.moving = Math.max(host.moving, 0.4);

    if (!this.canAttack(host, dist, ai)) return;

    ai.windupKind = "shot";
    ai.windup = GUN_WINDUP;
    host.windup = GUN_WINDUP;
    host.windupKind = ai.windupKind;
    host.windupDir = dir;
    host.aimLaser = 1;
  }

  private canAttack(host: Host, dist: number, ai: Host["ai"]): boolean {
    if (ai.reaction > 0 || ai.fireTimer > 0) return false;
    if (host.kind === "security") return dist < 700;
    return dist < 300;
  }

  private release(host: Host, world: World, target: { x: number; y: number }, dist: number): void {
    const ai = host.ai;
    if (!host.alive) return;

    // Aim error grows with distance; the telegraph gave the player time to move.
    const error = host.kind === "enforcer" ? 26 : 14 + dist * 0.045;
    const aim = {
      x: target.x + rand(-error, error),
      y: target.y + rand(-error, error),
    };
    world.combat.attack(host, aim, world);
    ai.fireTimer = host.kind === "enforcer" ? rand(1.6, 2.3) : rand(1.2, 1.9);
    ai.reaction = host.kind === "enforcer" ? rand(0.7, 1) : rand(0.4, 0.7);
  }
}
