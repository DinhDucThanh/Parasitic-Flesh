import type { Rect } from "../core/arena";
import { POSSESSION } from "../core/config";
import { clamp, distance, type Vec2 } from "../core/math";
import type { World } from "./World";

/**
 * THE PROVING GROUND
 *
 * A linear seven-chamber qualification. Geometry is fixed; the director only
 * advances objectives, opens the next blast door and seeds the props each
 * chamber needs. Every chamber teaches one verb of the hijack loop, then the
 * final chamber asks for all of them at once.
 *
 *   [01 awakening] [02 possession] [03 fire] [04 glide] [05 switch] [06 nova] [07 qualify]
 *        102            334            566        798        1170       1422       1654      1898
 *
 * Gates are blast doors d1..d5, the chamber-six barricade is the reinforced
 * d6, and a cycling pressure shutter splits the glide corridor.
 */

export const TUTORIAL_LAYOUT = {
  left: 70,
  right: 1930,
  top: 360,
  bottom: 1044,
  wall: 32,
  gapY: 620,
  gapH: 140,
  /** Partition centre-lines between the seven chambers (thickness = wall). */
  partitions: [302, 534, 766, 1138, 1390, 1622] as const,
  spawn: { x: 162, y: 702 } as Vec2,
  /** The stamina gate only opens once the host is past this line. */
  glideEnd: 1050,
  /** Pressure shutter splitting the glide corridor. */
  shutterX: 900,
} as const;

/** Horizontal centre of each chamber, used for floor stencils. */
export const TUTORIAL_ROOMS = [202, 434, 666, 968, 1280, 1522, 1776] as const;

/** Wall conduits in chamber one: lethal to an exposed spore, never to a host. */
export const TUTORIAL_CONDUITS: readonly Rect[] = [
  { x: 184, y: 392, w: 12, h: 392 },
  { x: 250, y: 616, w: 12, h: 396 },
];

export type DoorKind = "blast" | "reinforced";

/** A blast door, the acid barricade or the pressure shutter. */
export class Door {
  open = 0;
  target = 0;
  destroyed = false;

  constructor(
    readonly id: string,
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
    readonly kind: DoorKind = "blast",
  ) {}

  get center(): Vec2 {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }

  get rect(): Rect {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get solid(): boolean {
    return !this.destroyed && this.open < 0.78;
  }

  update(dt: number): void {
    if (this.destroyed) {
      this.open = 1;
      return;
    }
    // Doors open and close; the shutter is the only one that ever closes.
    if (this.open < this.target) this.open = Math.min(this.target, this.open + dt * 1.6);
    else if (this.open > this.target) this.open = Math.max(this.target, this.open - dt * 1.6);
  }
}

export interface TutorialObjective {
  chamber: number;
  title: string;
  prompt: string;
  objective: string;
  alpha: number;
}

interface ChamberData {
  title: string;
  prompt: string;
  objective: string;
}

const CHAMBERS: readonly ChamberData[] = [
  {
    title: "AWAKENING",
    prompt: "[WASD] — EVADE & SLITHER. YOU HAVE ONLY 1 HP.",
    objective: "REACH THE GREEN SENSOR PAD",
  },
  {
    title: "POSSESSION",
    prompt: "HOLD [RMB] TO ENTER BULLET-TIME. RELEASE TO INHABIT THE HOST.",
    objective: "HIJACK THE SECURITY DUMMY",
  },
  {
    title: "DECAY & KINETIC FIRE",
    prompt: "[LMB] — FIRE WEAPON. WATCH THE TOP-LEFT DECAY CLOCK.",
    objective: "DESTROY BOTH TRAINING TARGETS",
  },
  {
    title: "KINETIC GLIDE",
    prompt: "HOLD [SHIFT] — GLIDE SPRINT (2.2x). MONITOR THE HORIZONTAL STAMINA BAR.",
    objective: "SPRINT THE CORRIDOR — STAMINA SPENT 0 / 30",
  },
  {
    title: "SILENT SWITCH",
    prompt: "HOLD [RMB] OR [SPACE] — LEAP BETWEEN BODIES WITHOUT AN EXPLOSION.",
    objective: "WAIT FOR THE NEURAL LINK TO STABILISE",
  },
  {
    title: "CATASTROPHIC DETONATION",
    prompt: "HOLD & RELEASE [R] — CONSUME 1 CHARGE TO DETONATE HOST IN A MASSIVE ACID NOVA.",
    objective: "BLOW THE ACID-REINFORCED BARRICADE",
  },
  {
    title: "SECTOR QUALIFICATION",
    prompt: "CHAIN HIJACKS: FLANK THE SHIELD, GLIDE, AND DETONATE TO QUALIFY.",
    objective: "CLEAR THE QUALIFICATION HOSTILES",
  },
];

const CHAMBER_COUNT = CHAMBERS.length;

function circleHitsRect(p: Vec2, radius: number, rect: Rect): boolean {
  const closestX = clamp(p.x, rect.x, rect.x + rect.w);
  const closestY = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - closestX;
  const dy = p.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

/** Build the seven-room corridor, its five gates, the barricade and the shutter. */
export function buildTutorialLayout(): { walls: Rect[]; doors: Door[] } {
  const { left, right, top, bottom, wall, gapY, gapH, partitions, shutterX } = TUTORIAL_LAYOUT;
  const walls: Rect[] = [
    // Outer shell.
    { x: left, y: top, w: right - left, h: wall },
    { x: left, y: bottom - wall, w: right - left, h: wall },
    { x: left, y: top, w: wall, h: bottom - top },
    { x: right - wall, y: top, w: wall, h: bottom - top },
  ];

  for (const x of partitions) {
    walls.push({ x, y: top + wall, w: wall, h: gapY - (top + wall) });
    walls.push({ x, y: gapY + gapH, w: wall, h: bottom - wall - (gapY + gapH) });
  }

  // Bulkhead framing for the pressure shutter inside the glide corridor.
  walls.push({ x: shutterX, y: top + wall, w: 24, h: gapY - (top + wall) });
  walls.push({ x: shutterX, y: gapY + gapH, w: 24, h: bottom - wall - (gapY + gapH) });

  const doors: Door[] = [
    new Door("d1", partitions[0], gapY, wall, gapH),
    new Door("d2", partitions[1], gapY, wall, gapH),
    new Door("d3", partitions[2], gapY, wall, gapH),
    new Door("d4", partitions[3], gapY, wall, gapH),
    new Door("d5", partitions[4], gapY, wall, gapH),
    new Door("d6", partitions[5], gapY, wall, gapH, "reinforced"),
    new Door("shutter", shutterX, gapY, 24, gapH),
  ];

  return { walls, doors };
}

/**
 * Objective director. It never mutates geometry directly: doors, dummies and
 * guards all go through explicit World methods so the simulation stays the
 * single owner of state.
 */
export class Tutorial {
  phase = 0;
  promptTime = 0;
  /** Seconds spent in the current chamber; used for the neural-link window. */
  chamberTime = 0;
  readonly scanner = { x: 272, y: 880, radius: 34 };
  readonly portal = { x: 1862, y: 702, radius: 32, active: false };
  readonly conduits = TUTORIAL_CONDUITS;
  /** Cumulative stamina drained by the player during the glide chamber. */
  staminaSpent = 0;
  /** False for the first POSSESSION.switchLockout seconds of chamber five. */
  linkReady = false;
  linkRemaining: number = POSSESSION.switchLockout;

  /** Live count behind the chamber-three objective line. */
  private targetsRemaining = 0;
  private resupply = 2.4;
  private lastStamina = 100;
  private shutterClock = 0;
  private shutterOpen = true;
  private combatSpawned = false;

  reset(): void {
    this.phase = 0;
    this.promptTime = 0;
    this.chamberTime = 0;
    this.portal.active = false;
    this.staminaSpent = 0;
    this.linkReady = false;
    this.linkRemaining = POSSESSION.switchLockout;
    this.resupply = 2.4;
    this.lastStamina = 100;
    this.shutterClock = 0;
    this.shutterOpen = true;
    this.combatSpawned = false;
  }

  update(dt: number, world: World): void {
    this.promptTime += dt;
    this.chamberTime += dt;
    this.targetsRemaining = world.targets.filter((target) => target.alive).length;

    this.tickShutter(dt, world);
    if (this.phase === 0) this.checkConduits(world);
    // Chamber one is deliberately naked; resupply only starts once a body matters.
    if (this.phase >= 1) this.ensureUsableHost(dt, world);

    switch (this.phase) {
      case 0: {
        if (distance(world.spore.position, this.scanner) <= this.scanner.radius + 6) {
          world.openDoor("d1");
          this.advance(1, world);
        }
        break;
      }

      case 1: {
        if (world.possessed) {
          world.openDoor("d2");
          this.advance(2, world);
        }
        break;
      }

      case 2: {
        if (world.targets.length > 0 && world.targets.every((target) => !target.alive)) {
          world.openDoor("d3");
          const host = world.possessed;
          if (host) host.decay = Math.max(host.decay, 12);
          this.advance(3, world);
        }
        break;
      }

      case 3: {
        const host = world.possessed;
        if (!host) break;
        const spent = this.lastStamina - host.currentStamina;
        if (spent > 0) this.staminaSpent += spent;
        this.lastStamina = host.currentStamina;
        if (this.staminaSpent >= 30 && host.position.x >= TUTORIAL_LAYOUT.glideEnd) {
          world.openDoor("d4");
          this.advance(4, world);
        }
        break;
      }

      case 4: {
        const host = world.possessed;
        if (host) {
          this.linkRemaining = Math.max(0, POSSESSION.switchLockout - host.possessedTime);
          this.linkReady = this.linkRemaining <= 0;
          // The body is dying: the switch must be made before the clock runs out.
          if (host.kind === "mutant" && host.possessedTime > 0.1) {
            world.openDoor("d5");
            this.advance(5, world);
          }
        }
        break;
      }

      case 5: {
        if (world.doorById("d6")?.destroyed) this.advance(6, world);
        break;
      }

      default: {
        this.portal.active = world.enemiesRemaining === 0;
        if (
          this.portal.active &&
          distance(world.spore.position, this.portal) <= this.portal.radius + world.spore.radius
        ) {
          world.finishTutorial();
        }
        break;
      }
    }
  }

  get objective(): TutorialObjective {
    const data = CHAMBERS[Math.min(this.phase, CHAMBER_COUNT - 1)] as ChamberData;
    let prompt = data.prompt;
    let objective = data.objective;

    if (this.phase === 2) {
      objective =
        this.targetsRemaining > 0
          ? `DESTROY BOTH TRAINING TARGETS — ${this.targetsRemaining} REMAIN`
          : "CHAMBER CLEAR";
    } else if (this.phase === 3) {
      objective = `SPRINT THE CORRIDOR — STAMINA SPENT ${Math.floor(this.staminaSpent)} / 30`;
    } else if (this.phase === 4) {
      if (this.linkReady) {
        prompt = "LINK STABLE. PRESS [RMB] OR [SPACE] TO SWITCH BODIES.";
        objective = "LEAP INTO THE MUTANT CHIMERA";
      } else {
        prompt = `NEURAL LINK CALIBRATING... [${this.linkRemaining.toFixed(1)}s]`;
        objective = "WAIT FOR THE LINK TO STABILISE";
      }
    } else if (this.phase === 6) {
      objective = this.portal.active ? "ENTER THE EXTRACTION ELEVATOR" : "CLEAR THE QUALIFICATION HOSTILES";
    }

    return {
      chamber: this.phase + 1,
      title: data.title,
      prompt,
      objective,
      alpha: Math.min(1, this.promptTime / 0.35),
    };
  }

  /** Restore a chamber checkpoint after a death: doors, props, host and gear. */
  jumpTo(phase: number, world: World): void {
    this.reset();
    const target = clamp(Math.floor(phase), 0, CHAMBER_COUNT - 1);
    this.phase = target;

    for (let i = 0; i < target; i += 1) {
      const door = world.doorById(`d${i + 1}`);
      if (door) {
        door.open = 1;
        door.target = 1;
      }
    }
    if (target >= 6) {
      const barricade = world.doorById("d6");
      if (barricade) {
        barricade.destroyed = true;
        barricade.open = 1;
        barricade.target = 1;
      }
    }

    const start = this.chamberStart(target);
    world.spore.reset(start);
    // Chambers three and later assume the player is already wearing a body.
    if (target >= 2) this.possessFreshHost(world, start.x, start.y);

    this.setupChamber(target, world);
    this.lastStamina = world.possessed?.currentStamina ?? 100;
  }

  private advance(next: number, world: World): void {
    this.phase = next;
    this.promptTime = 0;
    this.chamberTime = 0;
    this.staminaSpent = 0;
    this.linkReady = false;
    this.linkRemaining = POSSESSION.switchLockout;
    this.lastStamina = world.possessed?.currentStamina ?? 100;
    this.setupChamber(next, world);
  }

  /** Seed the props a chamber needs. Safe to call twice. */
  private setupChamber(phase: number, world: World): void {
    switch (phase) {
      case 1:
        this.ensureDummy(world, 470);
        break;
      case 2:
        this.ensureTargets(world);
        break;
      case 4:
        this.ensureMutant(world, 1330);
        this.configureLinkHost(world);
        break;
      case 6:
        this.ensureCombat(world);
        break;
      default:
        break;
    }
  }

  private chamberStart(index: number): Vec2 {
    if (index <= 0) return { ...TUTORIAL_LAYOUT.spawn };
    const partition = TUTORIAL_LAYOUT.partitions[index - 1] as number;
    return { x: partition + TUTORIAL_LAYOUT.wall + 62, y: 702 };
  }

  private possessFreshHost(world: World, x: number, y: number): void {
    const host = world.spawnTrainingDummy(x, y);
    host.becomePossessed();
    world.spore.reset({ x, y });
    world.spore.state = "hosted";
  }

  private ensureDummy(world: World, x: number): void {
    const present = world.hosts.some(
      (host) => host.alive && !host.possessed && host.isTrainingDummy && Math.abs(host.position.x - x) < 110,
    );
    if (!present) world.spawnTrainingDummy(x, 702);
  }

  private ensureMutant(world: World, x: number): void {
    const present = world.hosts.some(
      (host) =>
        host.alive &&
        !host.possessed &&
        host.isTrainingDummy &&
        host.kind === "mutant" &&
        Math.abs(host.position.x - x) < 120,
    );
    if (!present) {
      const mutant = world.spawnTrainingDummy(x, 702, "mutant");
      mutant.facing = Math.PI;
    }
  }

  private ensureTargets(world: World): void {
    if (world.targets.length > 0) return;
    world.spawnTutorialTarget(660, 560);
    world.spawnTutorialTarget(660, 844);
    // Keep the banner honest on the frame the targets appear.
    this.targetsRemaining = 2;
  }

  private ensureCombat(world: World): void {
    if (this.combatSpawned) return;
    this.combatSpawned = true;
    const enforcer = world.spawnTutorialHost("enforcer", 1750, 600);
    enforcer.ai.reaction = 1.1;
    enforcer.ai.fireTimer = 0.8;
    const guard = world.spawnTutorialHost("security", 1814, 862);
    guard.ai.reaction = 1.4;
    guard.ai.fireTimer = 1.1;
    world.sfx.play("denied");
  }

  /** Chamber five opens with five seconds of life and a locked neural link. */
  private configureLinkHost(world: World): void {
    const host = world.possessed;
    if (!host) return;
    host.possessedTime = 0;
    host.decay = 5;
    host.currentStamina = host.maxStamina;
    host.calibrateFlash = 0.6;
  }

  /** A player who ejects in the wrong place is never soft-locked. */
  private ensureUsableHost(dt: number, world: World): void {
    if (world.possessed) {
      this.resupply = 2.4;
      return;
    }
    const hasDummy = world.hosts.some((host) => host.alive && !host.possessed && host.isTrainingDummy);
    if (hasDummy) {
      this.resupply = 2.4;
      return;
    }
    this.resupply -= dt;
    if (this.resupply > 0) return;
    this.resupply = 2.4;
    const start = this.chamberStart(this.phase);
    world.spawnTrainingDummy(start.x + 40, start.y);
  }

  /** Wall conduits only hurt an exposed spore; a worn body shrugs them off. */
  private checkConduits(world: World): void {
    if (world.possessed || world.spore.state === "flying") return;
    for (const rect of this.conduits) {
      if (circleHitsRect(world.spore.position, world.spore.radius, rect)) {
        world.killSpore("WALL CONDUIT DISCHARGE");
        return;
      }
    }
  }

  /** The shutter opens and closes on a fixed cycle and never closes on a body. */
  private tickShutter(dt: number, world: World): void {
    const shutter = world.doorById("shutter");
    if (!shutter) return;
    this.shutterClock += dt;
    const window = this.shutterOpen ? 2.2 : 1.7;
    if (this.shutterClock >= window) {
      this.shutterClock = 0;
      this.shutterOpen = !this.shutterOpen;
    }
    // A closed shutter that would trap someone stays open until they clear it.
    const occupied = this.bodyInBand(world, shutter.x - 30, shutter.x + shutter.w + 30);
    shutter.target = this.shutterOpen || occupied ? 1 : 0;
  }

  private bodyInBand(world: World, x0: number, x1: number): boolean {
    if (world.spore.state !== "flying" && world.spore.position.x + world.spore.radius > x0 && world.spore.position.x - world.spore.radius < x1) {
      return true;
    }
    return world.hosts.some(
      (host) => host.alive && host.position.x + host.radius > x0 && host.position.x - host.radius < x1,
    );
  }

}
