import { ARENA, BLAST, CHIMERA, DECAY } from "../core/config";
import { clamp, normalize, rand, type Vec2 } from "../core/math";
import type { Host } from "../entities/Host";
import type { World } from "../world/World";
import { Hazard, Particle, spawnBurst, spawnExplosion } from "./Effects";
import { Projectile } from "./Projectile";

interface GraftTimers {
  stride: number;
}

function segmentHitsCircle(a: Vec2, b: Vec2, center: Vec2, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 1e-6 ? ((center.x - a.x) * dx + (center.y - a.y) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  const px = a.x + dx * t;
  const py = a.y + dy * t;
  return Math.hypot(center.x - px, center.y - py) <= radius;
}

/**
 * Owns everything that hurts something: projectiles, shield deflection,
 * melee dashes, AOE detonations and lingering acid. Damage to a possessed
 * host is converted into lost lifespan, never HP.
 */
export class CombatSystem {
  private readonly timers = new WeakMap<Host, GraftTimers>();

  update(dt: number, world: World): void {
    for (const host of world.hosts) {
      host.fireCooldown = Math.max(0, host.fireCooldown - dt);
    }
    this.updateProjectiles(dt, world);
    this.updateDashes(dt, world);
    this.updateHazards(dt, world);
    for (const host of world.hosts) {
      if (host.alive) this.updateGrafts(host, dt, world);
    }
  }

  /** Fires the host's weapon toward `aim` (world position). Shares code with the AI. */
  attack(host: Host, aim: Vec2, world: World): boolean {
    if (!host.alive || host.fireCooldown > 0) return false;
    const weapon = host.weapon;
    const angle = Math.atan2(aim.y - host.position.y, aim.x - host.position.x);
    host.facing = angle;
    host.fireCooldown = weapon.cooldown;

    // The mutant archetype is melee-only by definition: it must never reach the
    // projectile block below, even if its weapon spec is changed by mistake.
    if (host.kind === "mutant" || weapon.kind === "claw") {
      // The chimera's attack and its locomotion are the same burst.
      // AI lunges use the telegraphed 680/0.22 profile; possession trades a
      // longer 220px range for a tight 0.65s cooldown.
      this.beginDash(
        host,
        angle,
        world,
        host.possessed ? CHIMERA.playerDashTime : CHIMERA.dashTime,
        host.possessed ? CHIMERA.playerDashSpeed : CHIMERA.dashSpeed,
        host.possessed ? CHIMERA.playerDashDistance : CHIMERA.dashDistance,
      );
      world.sfx.play("claw");
      return true;
    }

    const team = host.possessed ? "player" : "enemy";
    const muzzle = host.radius + 9;
    const kind = weapon.kind === "shotgun" ? "pellet" : "rifle";
    const color = team === "player" ? "#bfffe0" : "#ff8b7a";

    for (let i = 0; i < weapon.pellets; i += 1) {
      const shotAngle = angle + rand(-weapon.spread, weapon.spread);
      const ox = Math.cos(shotAngle) * muzzle;
      const oy = Math.sin(shotAngle) * muzzle;
      world.projectiles.push(
        new Projectile(
          host.position.x + ox,
          host.position.y + oy,
          Math.cos(shotAngle) * weapon.projectileSpeed,
          Math.sin(shotAngle) * weapon.projectileSpeed,
          weapon.damage,
          team,
          kind,
          color,
        ),
      );
    }

    host.recoil = weapon.kind === "shotgun" ? 1.6 : 1;
    host.muzzle = 1;
    spawnBurst(world.particles, host.position.x + Math.cos(angle) * muzzle, host.position.y + Math.sin(angle) * muzzle, 4, 220, "#ffd9a0", 1.8, 0.18);
    world.sfx.play(weapon.kind === "shotgun" ? "shotgun" : "shot");
    if (host.possessed) {
      world.addTrauma(weapon.kind === "shotgun" ? 0.14 : 0.02);
    } else if (world.distanceToSpore(host) < 700) {
      world.addTrauma(0.02);
    }
    return true;
  }

  /** Chimera AI burst: locked direction, fixed speed, hard distance budget. */
  lunge(host: Host, angle: number, world: World): void {
    if (!host.alive) return;
    this.beginDash(host, angle, world, CHIMERA.dashTime, CHIMERA.dashSpeed, CHIMERA.dashDistance);
    spawnBurst(world.particles, host.position.x, host.position.y, 5, 150, "#ff5566", 2.2, 0.32);
  }

  private beginDash(
    host: Host,
    angle: number,
    world: World,
    duration: number,
    speed: number,
    distance: number,
  ): void {
    host.dashTime = duration;
    host.dashSpeed = speed;
    host.dashDistanceLeft = distance;
    host.dashDir = { x: Math.cos(angle), y: Math.sin(angle) };
    host.dashHits.clear();
    world.sfx.play("dash");
  }

  private updateDashes(dt: number, world: World): void {
    for (const host of world.hosts) {
      if (!host.alive || host.dashTime <= 0) continue;
      host.dashTime = Math.max(0, host.dashTime - dt);
      const speed = host.dashSpeed > 0 ? host.dashSpeed : 820;
      // Never overshoot the declared distance budget: the last step is clipped.
      const step = Math.min(speed * dt, host.dashDistanceLeft);
      const fromX = host.position.x;
      const fromY = host.position.y;
      host.position.x += host.dashDir.x * step;
      host.position.y += host.dashDir.y * step;
      host.dashDistanceLeft = Math.max(0, host.dashDistanceLeft - step);
      if (host.dashDistanceLeft <= 1e-3) host.dashTime = 0;
      host.moving = 1;
      clampToArenaHost(host, world);
      // A burst must never tunnel through a bulkhead, shutter or the armored
      // barricade: the body slams into the seam and the lunge ends there.
      if (world.segmentBlocked({ x: fromX, y: fromY }, host.position)) {
        host.position.x = fromX;
        host.position.y = fromY;
        host.dashTime = 0;
        host.dashDistanceLeft = 0;
        spawnBurst(world.particles, host.position.x + host.dashDir.x * host.radius, host.position.y + host.dashDir.y * host.radius, 5, 130, "#ffe089", 1.8, 0.25);
      }

      // Sharp claw streaks trailing along the lunge vector.
      if (Math.random() < 0.85) {
        const back = host.radius + 6;
        world.particles.push(
          new Particle(
            host.position.x - host.dashDir.x * back + rand(-3, 3),
            host.position.y - host.dashDir.y * back + rand(-3, 3),
            -host.dashDir.x * rand(80, 170),
            -host.dashDir.y * rand(80, 170),
            0.22,
            rand(2, 4.5),
            host.possessed ? "#8effc0" : "#ff5566",
          ),
        );
      }

      if (host.possessed) {
        for (const other of world.hosts) {
          if (other === host || !other.alive || other.possessed) continue;
          if (!host.dashHits.has(other.id)) {
            if (host.distanceTo(other.position) > host.radius + other.radius + 10) continue;
            host.dashHits.add(other.id);
            other.takeDamage(host.weapon.damage);
            world.hitMarker = 1;
            spawnBurst(world.particles, other.position.x, other.position.y, 10, 260, "#a8252f", 3, 0.5);
            world.sfx.play("hurt");
            if (!other.alive) world.killHost(other);
          }
        }
      } else {
        const player = world.possessed;
        // One hit per leap: the dash sweep overlaps for several frames.
        if (
          player &&
          !host.dashHits.has(player.id) &&
          host.distanceTo(player.position) < host.radius + player.radius + 6
        ) {
          host.dashHits.add(player.id);
          world.damagePlayerHost(player, DECAY.hitPenalty);
        } else if (world.spore.isExposed && host.distanceTo(world.spore.position) < host.radius + world.spore.radius) {
          world.killSpore("RIPPED APART BY CLAWS");
        }
      }
    }
  }

  private updateProjectiles(dt: number, world: World): void {
    for (const p of world.projectiles) {
      p.update(dt);
      if (!p.alive) continue;
      if (world.dungeon?.hitProps(p.previous, p.position, p.damage)) {
        p.alive = false;
        continue;
      }
      if (
        p.position.x < ARENA.wall ||
        p.position.x > world.bounds.width - ARENA.wall ||
        p.position.y < ARENA.wall ||
        p.position.y > world.bounds.height - ARENA.wall ||
        world.segmentBlocked(p.previous, p.position)
      ) {
        p.alive = false;
        spawnBurst(world.particles, p.position.x, p.position.y, 2, 90, "#ffd9a0", 1.4, 0.2);
        continue;
      }

      if (p.team === "player") {
        // Proving-ground targets are hit before bodies behind them.
        for (const target of world.targets) {
          if (!target.alive) continue;
          if (!segmentHitsCircle(p.previous, p.position, target.position, target.radius + p.radius)) continue;
          p.alive = false;
          world.damageTarget(target, p.damage);
          break;
        }
        if (!p.alive) continue;

        for (const host of world.hosts) {
          if (!host.alive || host.possessed) continue;
          if (!segmentHitsCircle(p.previous, p.position, host.position, host.radius + p.radius)) continue;
          p.alive = false;
          if (this.isShielded(host, p)) {
            this.deflect(host, p, world);
          } else {
            host.takeDamage(p.damage);
            world.hitMarker = 1;
            spawnBurst(world.particles, host.position.x, host.position.y, 6, 180, "#a8252f", 2.4, 0.4);
            if (!host.alive) world.killHost(host);
          }
          break;
        }
        continue;
      }

      // Enemy fire: first the possessed shell, then the exposed spore.
      const player = world.possessed;
      if (player) {
        if (segmentHitsCircle(p.previous, p.position, player.position, player.radius + p.radius)) {
          p.alive = false;
          if (this.isShielded(player, p)) {
            this.deflect(player, p, world);
          } else {
            spawnBurst(world.particles, player.position.x, player.position.y, 8, 210, "#a8252f", 2.6, 0.45);
            world.damagePlayerHost(player, DECAY.hitPenalty);
          }
          continue;
        }
      } else if (world.spore.isExposed) {
        if (segmentHitsCircle(p.previous, p.position, world.spore.position, world.spore.radius + p.radius)) {
          p.alive = false;
          world.killSpore("SHOT THROUGH THE SPORE");
          continue;
        }
      }
    }
    world.projectiles = world.projectiles.filter((p) => p.alive);
  }

  /** Frontal riot shields and grafted dorsal plating. */
  private isShielded(host: Host, p: Projectile): boolean {
    const dir = normalize(p.velocity);
    const facing = { x: Math.cos(host.facing), y: Math.sin(host.facing) };
    // 1 when the round is travelling straight into the host's face.
    const front = -(dir.x * facing.x + dir.y * facing.y);
    if (host.kind === "enforcer" && front > 0.32) return true;
    if (host.grafts.has("dorsalShield") && front < -0.32) return true;
    return false;
  }

  private deflect(host: Host, p: Projectile, world: World): void {
    host.shieldFlash = 1;
    world.sfx.play("shield");
    spawnBurst(world.particles, p.position.x, p.position.y, 6, 260, "#ffe089", 1.8, 0.3);
    world.addTrauma(0.05);
  }

  private updateHazards(dt: number, world: World): void {
    for (const hazard of world.hazards) {
      hazard.update(dt);
      if (hazard.hurtsPlayer && Math.hypot(world.playerPoint.x - hazard.position.x, world.playerPoint.y - hazard.position.y) < hazard.radius) {
        if (world.possessed) world.damagePlayerHost(world.possessed, 1);
        else if (world.spore.isExposed) world.killSpore("TOXIC BARREL");
      }
      for (const host of world.hosts) {
        if (!host.alive || host.possessed) continue;
        if (host.distanceTo(hazard.position) > hazard.radius + host.radius * 0.5) continue;
        host.hp -= hazard.dps * dt;
        host.flash = Math.max(host.flash, 0.3);
        if (host.hp <= 0) world.killHost(host);
      }
    }
    world.hazards = world.hazards.filter((h) => h.alive);
  }

  /** Signature passives donated by the previously worn host. */
  private updateGrafts(host: Host, dt: number, world: World): void {
    if (host.grafts.size === 0) return;
    let timers = this.timers.get(host);
    if (!timers) {
      timers = { stride: 0.12 };
      this.timers.set(host, timers);
    }

    if (host.grafts.has("acidStride")) {
      if (host.moving > 0.35) {
        timers.stride -= dt;
        if (timers.stride <= 0) {
          timers.stride = 0.22;
          world.hazards.push(new Hazard(host.position.x, host.position.y, 38, 4.5, 7));
          world.decals.stampFootprint(host.position.x, host.position.y, host.facing);
        }
      }
    }

  }

  /** Radial acid detonation used by ejection and meltdowns. */
  explode(x: number, y: number, radius: number, damage: number, world: World, kind: "acid" | "meltdown" = "acid"): void {
    world.decals.stampScorch(x, y, radius * 0.9);
    world.decals.stampAcid(x, y, radius);
    spawnExplosion(world.effects, world.particles, x, y, radius, kind);
    world.addTrauma(0.6);
    world.stop(kind === "meltdown" ? 0.12 : 0.035);
    world.sfx.play("blast");

    for (const host of world.hosts) {
      if (!host.alive || host.possessed) continue;
      const dist = Math.hypot(host.position.x - x, host.position.y - y);
      if (dist > radius + host.radius * 0.5) continue;
      host.peelArmor();
      host.takeDamage(damage);
      const falloff = 1 - Math.min(1, dist / radius);
      const dir = normalize({ x: host.position.x - x, y: host.position.y - y });
      host.position.x += dir.x * BLAST.knockback * falloff;
      host.position.y += dir.y * BLAST.knockback * falloff;
      clampToArenaHost(host, world);
      spawnBurst(world.particles, host.position.x, host.position.y, 8, 260, "#b6ff3d", 3, 0.6);
      if (!host.alive) world.killHost(host);
    }

    // Level props: the reinforced barrier and training targets.
    world.blastBarriers(x, y, radius);
    world.blastTargets(x, y, radius, damage);
  }
}

function clampToArenaHost(host: Host, world: World): void {
  const min = ARENA.wall + host.radius;
  host.position.x = clamp(host.position.x, min, world.bounds.width - min);
  host.position.y = clamp(host.position.y, min, world.bounds.height - min);
}
