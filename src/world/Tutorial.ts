import type { Rect } from "../core/arena";
import { POSSESSION } from "../core/config";
import { clamp, distance, type Vec2 } from "../core/math";
import type { World } from "./World";

/**
 * THE PROVING GROUND
 *
 * Five sealed 900x500 chambers, laid out left to right. The camera is locked
 * to one room at a time; crossing a room boundary hands the view to the next
 * chamber over half a second. Every chamber teaches one verb, and the fifth
 * asks for all of them at once.
 *
 *   [01 awakening]   [02 possession & fire]   [03 glide]   [04 chimera & nova]   [05 breach]
 *    0                900                     1800         2700                  3600      4500
 */

export const TUTORIAL = {
  roomWidth: 900,
  roomHeight: 500,
  wall: 34,
  gapY: 175,
  gapH: 150,
  rooms: 5,
  spawn: { x: 110, y: 250 } as Vec2,
  /** Damage-free sprint this many stamina points to arm the glide gate. */
  glideStamina: 15,
  /** Distance across the glide corridor that counts as "safely across". */
  glideTrigger: 2600,
} as const;

/** Horizontal centre of each chamber, for floor stencils and camera anchors. */
export const TUTORIAL_ROOMS = Array.from({ length: TUTORIAL.rooms }, (_, i) => (i + 0.5) * TUTORIAL.roomWidth);

/** Wall conduits in chamber one: lethal to an exposed spore, never to a host. */
export const TUTORIAL_CONDUITS: readonly Rect[] = [
  { x: 300, y: 34, w: 18, h: 270 },
  { x: 510, y: 196, w: 18, h: 270 },
];

const GATE_Y = TUTORIAL.gapY;
const GATE_H = TUTORIAL.gapH;
const GATE_W = 26;

export type DoorKind = "blast" | "reinforced";

/** A blast door, the acid barricade or the timed pressure shutter. */
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
    // The shutter is the only door that ever closes again.
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
    prompt: "[WASD] — EVADE HAZARDS. YOU HAVE ONLY 1 HP.",
    objective: "REACH THE GREEN SENSOR PAD",
  },
  {
    title: "POSSESSION & KINETIC FIRE",
    prompt: "HOLD [RMB] TO SLOW TIME & HIJACK // [LMB] TO FIRE RIFLE BEFORE DECAY EXPIRES.",
    objective: "HIJACK THE SECURITY GUARD",
  },
  {
    title: "KINETIC GLIDE",
    prompt: "HOLD [SHIFT] — GLIDE SPRINT (2.2x). CONSUMES STAMINA. STAND STILL TO RECHARGE.",
    objective: "SPRINT THE CORRIDOR BEFORE THE SHUTTER FALLS",
  },
  {
    title: "THE CHIMERA & DETONATION",
    prompt: "SWITCH BODIES WITH [RMB/SPACE] (3s COOLDOWN) // HOLD & RELEASE [R] TO DETONATE YOUR HOST.",
    objective: "WAIT FOR THE NEURAL LINK TO STABILISE",
  },
  {
    title: "BREACH PROTOCOL",
    prompt: "FLANK THE SHIELD. GLIDE, SWITCH OR DETONATE TO CLEAR THE CHAMBER.",
    objective: "CLEAR THE BREACH TEAM",
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

/** Build the five-room floor, its bulkheads, gates, barricade and shutter. */
export function buildTutorialLayout(): { walls: Rect[]; doors: Door[] } {
  const { roomWidth, roomHeight, wall, rooms } = TUTORIAL;
  const width = roomWidth * rooms;

  const walls: Rect[] = [
    { x: 0, y: 0, w: width, h: wall },
    { x: 0, y: roomHeight - wall, w: width, h: wall },
    { x: 0, y: 0, w: wall, h: roomHeight },
    { x: width - wall, y: 0, w: wall, h: roomHeight },
  ];

  // Every gate sits in a bulkhead with a central doorway.
  for (const x of [874, 1774, 2210, 2674, 3420, 3520, 3574]) {
    walls.push({ x, y: wall, w: GATE_W, h: GATE_Y - wall });
    walls.push({ x, y: GATE_Y + GATE_H, w: GATE_W, h: roomHeight - wall - (GATE_Y + GATE_H) });
  }

  const doors: Door[] = [
    new Door("d1", 874, GATE_Y, GATE_W, GATE_H),
    new Door("d2", 1774, GATE_Y, GATE_W, GATE_H),
    new Door("shutter", 2210, GATE_Y, GATE_W, GATE_H),
    new Door("d3", 2674, GATE_Y, GATE_W, GATE_H),
    // The armored barricade sits in front of the fourth gate.
    new Door("barricade", 3420, GATE_Y, GATE_W, GATE_H, "reinforced"),
    new Door("d4", 3520, GATE_Y, GATE_W, GATE_H),
    new Door("breach-lock", 3574, GATE_Y, GATE_W, GATE_H),
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
  readonly scanner = { x: 820, y: 250, radius: 34 };
  readonly portal = { x: 4420, y: 250, radius: 34, active: false };
  readonly capsule = { x: 4100, y: 250 };
  readonly conduits = TUTORIAL_CONDUITS;
  /** Cumulative stamina drained during the glide chamber. */
  staminaSpent = 0;
  /** True once the host is across the glide corridor and recharging. */
  crossed = false;
  /** False for the first POSSESSION.switchLockout seconds of chamber four. */
  linkReady = false;
  linkRemaining: number = POSSESSION.switchLockout;

  private targetsRemaining = 0;
  private enemiesLeft = 0;
  private wearingBody = false;
  private wearingMutant = false;
  private resupply = 2.4;
  private lastStamina = 100;
  private shutterClosed = false;
  private shutterTimer = 0;
  private combatSpawned = false;
  private breachState: "waiting" | "telegraph" | "fighting" | "cleared" = "waiting";
  private breachTimer = 0;
  private breachEnemies: number[] = [];
  readonly breachMarkers: Vec2[] = [];
  capsuleOpened = false;
  draft = false;
  chosenMutation: number | null = null;

  reset(): void {
    this.phase = 0;
    this.promptTime = 0;
    this.portal.active = false;
    this.staminaSpent = 0;
    this.crossed = false;
    this.linkReady = false;
    this.linkRemaining = POSSESSION.switchLockout;
    this.targetsRemaining = 0;
    this.enemiesLeft = 0;
    this.resupply = 2.4;
    this.lastStamina = 100;
    this.shutterClosed = false;
    this.shutterTimer = 0;
    this.combatSpawned = false;
    this.breachState = "waiting";
    this.breachTimer = 0;
    this.breachEnemies = [];
    this.breachMarkers.length = 0;
    this.capsuleOpened = false;
    this.draft = false;
    this.chosenMutation = null;
  }

  update(dt: number, world: World): void {
    this.promptTime += dt;
    this.targetsRemaining = world.targets.filter((target) => target.alive).length;
    this.enemiesLeft = world.enemiesRemaining;
    this.updateLink(world);

    if (this.phase === 0) this.checkConduits(world);
    if (this.phase >= 1) this.ensureUsableHost(dt, world);
    if (this.phase === 2) this.tickShutter(dt, world);

    switch (this.phase) {
      case 0: {
        if (distance(world.spore.position, this.scanner) <= this.scanner.radius + 6) {
          world.openDoor("d1");
          this.advance(1, world);
        }
        break;
      }

      case 1: {
        if (world.possessed && world.targets.length > 0 && world.targets.every((target) => !target.alive)) {
          world.openDoor("d2");
          this.advance(2, world);
        }
        break;
      }

      case 2: {
        const host = world.possessed;
        if (!host) break;
        const spent = this.lastStamina - host.currentStamina;
        if (spent > 0) this.staminaSpent += spent;
        this.lastStamina = host.currentStamina;
        if (!this.crossed && this.staminaSpent >= TUTORIAL.glideStamina && host.position.x >= TUTORIAL.glideTrigger) {
          this.crossed = true;
        }
        // The gate opens once the lesson lands: across the room, stamina back up.
        if (this.crossed && host.currentStamina >= 99) {
          world.openDoor("d3");
          this.advance(3, world);
        }
        break;
      }

      case 3: {
        if (world.doorById("barricade")?.destroyed) {
          world.openDoor("d4");
          this.advance(4, world);
        }
        break;
      }

      default: {
        if (this.roomAt(world.playerPoint.x) === 4 && this.breachState === "waiting") this.startBreach(world);
        this.updateBreach(dt, world);
        break;
      }
    }
  }

  get objective(): TutorialObjective {
    const data = CHAMBERS[Math.min(this.phase, CHAMBER_COUNT - 1)];
    let prompt = data.prompt;
    let objective = data.objective;

    if (this.phase === 1) {
      if (!this.wearingBody) objective = "HIJACK THE SECURITY GUARD";
      else if (this.targetsRemaining > 0) objective = `DESTROY BOTH TARGET DRONES — ${this.targetsRemaining} REMAIN`;
      else objective = "CHAMBER CLEAR";
    } else if (this.phase === 2) {
      objective = this.crossed
        ? "STAND STILL TO RECHARGE STAMINA (5s)."
        : `SPRINT THE CORRIDOR — STAMINA SPENT ${Math.floor(this.staminaSpent)} / ${TUTORIAL.glideStamina}`;
    } else if (this.phase === 3) {
      if (this.wearingMutant) {
        objective = "HOLD & RELEASE [R] — DETONATE THE CORPSE BOMB";
      } else if (this.linkReady) {
        prompt = "LINK STABLE. PRESS [RMB] OR [SPACE] TO SWITCH BODIES.";
        objective = "LEAP INTO THE MUTANT CHIMERA";
      } else {
        prompt = `NEURAL LINK CALIBRATING... [${this.linkRemaining.toFixed(1)}s]`;
        objective = "WAIT FOR THE LINK TO STABILISE";
      }
    } else if (this.phase === 4) {
      objective = this.breachState === "waiting" ? "ENTER THE BREACH CHAMBER" : this.breachState === "telegraph" ? "LOCKDOWN — WATCH THE SPAWN MARKERS" : this.portal.active
        ? this.capsuleOpened ? "ENTER THE EXTRACTION PORTAL" : "OPEN THE MUTATION CAPSULE"
        : `CLEAR THE BREACH TEAM — ${this.enemiesLeft} REMAIN`;
    }

    return {
      chamber: this.phase + 1,
      title: data.title,
      prompt,
      objective,
      alpha: Math.min(1, this.promptTime / 0.35),
    };
  }

  /** The world is capped to the last chamber. */
  roomAt(x: number): number {
    return clamp(Math.floor(x / TUTORIAL.roomWidth), 0, TUTORIAL.rooms - 1);
  }

  roomCenter(index: number): Vec2 {
    const i = clamp(index, 0, TUTORIAL.rooms - 1);
    return { x: i * TUTORIAL.roomWidth + TUTORIAL.roomWidth / 2, y: TUTORIAL.roomHeight / 2 };
  }

  roomRect(index: number): { x: number; y: number; w: number; h: number } {
    const i = clamp(index, 0, TUTORIAL.rooms - 1);
    return { x: i * TUTORIAL.roomWidth, y: 0, w: TUTORIAL.roomWidth, h: TUTORIAL.roomHeight };
  }

  chamberStart(index: number): Vec2 {
    if (index <= 0) return { ...TUTORIAL.spawn };
    return { x: index * TUTORIAL.roomWidth + 80, y: TUTORIAL.roomHeight / 2 };
  }

  /** Called the moment the player crosses into a new room. */
  onEnterRoom(room: number, world: World): void {
    if (room === 2) {
      this.shutterTimer = 0;
      this.shutterClosed = false;
    } else if (room === 3) {
      const host = world.possessed;
      if (host) {
        host.possessedTime = 0;
        host.calibrateFlash = 0.6;
      }
      this.linkRemaining = POSSESSION.switchLockout;
      this.linkReady = false;
    } else if (room === 4 && this.phase === 4) {
      this.startBreach(world);
    }
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
    if (target >= 4) {
      const barricade = world.doorById("barricade");
      if (barricade) {
        barricade.destroyed = true;
        barricade.open = 1;
        barricade.target = 1;
      }
    }

    const start = this.chamberStart(target);
    world.spore.reset(start);
    // Chamber two is the possession lesson; later chambers start you in a body.
    if (target >= 2) this.possessFreshHost(world, start.x, start.y);

    this.setupChamber(target, world);
    if (target === 4) this.startBreach(world);
    this.lastStamina = world.possessed?.currentStamina ?? 100;
  }

  private advance(next: number, world: World): void {
    this.phase = next;
    this.promptTime = 0;
    this.staminaSpent = 0;
    this.crossed = false;
    this.linkReady = false;
    this.linkRemaining = POSSESSION.switchLockout;
    this.shutterTimer = 0;
    this.shutterClosed = false;
    this.lastStamina = world.possessed?.currentStamina ?? 100;
    this.setupChamber(next, world);
  }

  /** Seed the props a chamber needs; safe to call twice. */
  private setupChamber(phase: number, world: World): void {
    switch (phase) {
      case 1:
        this.ensureDummy(world);
        this.ensureTargets(world);
        break;
      case 3:
        this.ensureMutant(world);
        break;
      case 4:
        // Leave the entrance open until the player crosses into chamber five.
        { const door = world.doorById("breach-lock"); if (door) { door.open = 1; door.target = 1; } }
        // The detonation in chamber four leaves the spore naked: hand it a
        // fresh practice body at the breach entrance before the guns wake up.
        this.ensureBreachBody(world);
        break;
      default:
        break;
    }
  }

  private possessFreshHost(world: World, x: number, y: number): void {
    const host = world.spawnTrainingDummy(x, y);
    host.becomePossessed();
    world.spore.reset({ x, y });
    world.spore.state = "hosted";
  }

  private ensureDummy(world: World): void {
    const present = world.hosts.some(
      (host) => host.alive && !host.possessed && host.isTrainingDummy && this.roomAt(host.position.x) === 1,
    );
    if (!present) world.spawnTrainingDummy(1210, 250);
  }

  private ensureTargets(world: World): void {
    if (world.targets.length > 0) return;
    world.spawnTutorialTarget(1600, 165);
    world.spawnTutorialTarget(1600, 335);
    this.targetsRemaining = 2;
  }

  private ensureMutant(world: World): void {
    const present = world.hosts.some(
      (host) => host.alive && !host.possessed && host.isTrainingDummy && host.kind === "mutant" && this.roomAt(host.position.x) === 3,
    );
    if (!present) {
      const mutant = world.spawnTrainingDummy(3000, 250, "mutant");
      mutant.facing = Math.PI;
    }
  }

  private ensureBreachBody(world: World): void {
    const present = world.hosts.some(
      (host) => host.alive && host.isTrainingDummy && this.roomAt(host.position.x) === 4,
    );
    if (!present) world.spawnTrainingDummy(3700, 250);
  }

  private startBreach(world: World): void {
    if (this.breachState !== "waiting") return;
    this.breachState = "telegraph";
    this.breachTimer = 0.85;
    this.breachMarkers.push({ x: 3940, y: 150 }, { x: 4250, y: 350 });
    const entrance = world.doorById("breach-lock");
    if (entrance) { entrance.open = 0; entrance.target = 0; }
    world.sfx.play("door");
    world.sfx.play("warning");
  }

  private updateBreach(dt: number, world: World): void {
    if (this.breachState === "telegraph") {
      this.breachTimer -= dt;
      if (this.breachTimer <= 0 && this.breachMarkers.every(p => distance(p, world.playerPoint) >= 60)) {
        const enforcer = world.spawnTutorialHost("enforcer", this.breachMarkers[0]!.x, this.breachMarkers[0]!.y);
        const guard = world.spawnTutorialHost("security", this.breachMarkers[1]!.x, this.breachMarkers[1]!.y);
        enforcer.ai.reaction = 1.1; guard.ai.reaction = 1.4;
        this.breachEnemies = [enforcer.id, guard.id];
        this.breachMarkers.length = 0;
        this.combatSpawned = true;
        this.breachState = "fighting";
      }
    } else if (this.breachState === "fighting" && this.combatSpawned && this.breachEnemies.every(id => {
      const host = world.hostById(id);
      return !host || !host.alive || host.possessed;
    })) {
      this.breachState = "cleared";
      this.portal.active = true;
      world.openDoor("breach-lock");
      world.sfx.play("win");
    }
    if (this.breachState !== "cleared") return;
    if (!this.capsuleOpened && distance(world.playerPoint, this.capsule) < 40) {
      this.capsuleOpened = true;
      this.draft = true;
      world.sfx.play("graft");
    }
    if (this.capsuleOpened && !this.draft && distance(world.playerPoint, this.portal) <= this.portal.radius + 10) world.finishTutorial();
  }

  chooseMutation(index: number): void {
    if (!this.draft || index < 0 || index > 2) return;
    this.chosenMutation = index;
    this.draft = false;
  }

  /** A player who ejects in the wrong place is never soft-locked. */
  private ensureUsableHost(dt: number, world: World): void {
    if (world.possessed) {
      this.resupply = 2.4;
      return;
    }
    const hasDummy = world.hosts.some(
      (host) => host.alive && !host.possessed && host.isTrainingDummy && this.roomAt(host.position.x) === this.phase,
    );
    if (hasDummy) {
      this.resupply = 2.4;
      return;
    }
    this.resupply -= dt;
    if (this.resupply > 0) return;
    this.resupply = 2.4;
    const start = this.chamberStart(this.phase);
    world.spawnTrainingDummy(start.x + 120, TUTORIAL.roomHeight / 2);
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

  /** The shutter opens for four seconds, then slams; it never crushes a body. */
  private tickShutter(dt: number, world: World): void {
    const shutter = world.doorById("shutter");
    if (!shutter) return;
    const host = world.possessed;
    const x = host?.position.x ?? world.spore.position.x;
    // Once the runner is through, the shutter seals the corridor behind them.
    if (x > shutter.x + 40) {
      shutter.target = 0;
      return;
    }
    this.shutterTimer += dt;
    if (!this.shutterClosed && this.shutterTimer >= 4) {
      if (!this.bodyInBand(world, shutter.x)) {
        this.shutterClosed = true;
        this.shutterTimer = 0;
      }
    } else if (this.shutterClosed && this.shutterTimer >= 2.5) {
      this.shutterClosed = false;
      this.shutterTimer = 0;
    }
    shutter.target = this.shutterClosed ? 0 : 1;
  }

  private bodyInBand(world: World, x: number): boolean {
    const x0 = x - 30;
    const x1 = x + 56;
    if (world.spore.state !== "flying" && world.spore.position.x + world.spore.radius > x0 && world.spore.position.x - world.spore.radius < x1) {
      return true;
    }
    return world.hosts.some(
      (host) => host.alive && host.position.x + host.radius > x0 && host.position.x - host.radius < x1,
    );
  }

  private updateLink(world: World): void {
    const host = world.possessed;
    this.wearingBody = Boolean(host);
    this.wearingMutant = host?.kind === "mutant";
    if (this.phase !== 3 || !host) return;
    if (host.kind === "mutant") {
      this.linkReady = true;
      this.linkRemaining = 0;
      return;
    }
    this.linkRemaining = Math.max(0, POSSESSION.switchLockout - host.possessedTime);
    this.linkReady = this.linkRemaining <= 0;
  }
}
