import type { SfxSynth } from "../assets/SfxSynth";
import { clampToArena, resolveCircleWalls, segmentIntersectsRect, type Rect } from "../core/arena";
import type { Camera } from "../core/Camera";
import { BLAST, BULLET_TIME, DECAY, SPAWN_GRACE } from "../core/config";
import type { Input } from "../core/Input";
import { distance, type Vec2 } from "../core/math";
import { Host, GRAFT_LABEL, type GraftKind, type HostKind } from "../entities/Host";
import { Spore } from "../entities/Spore";
import { TrainingTarget } from "../entities/Target";
import { CombatSystem } from "../systems/CombatSystem";
import type { DecalSystem } from "../systems/DecalSystem";
import { spawnBurst, type Explosion, type Hazard, type Particle } from "../systems/Effects";
import { GRAFT_INFO, HijackSystem } from "../systems/HijackSystem";
import type { Projectile } from "../systems/Projectile";
import { LevelManager } from "../levels/LevelManager";
import type { LevelConfig, LevelHostType } from "../levels/Level";
import { AIController } from "./AIController";
import { LoreLog, WHISPERS } from "./Lore";
import { buildTutorialLayout, Door, Tutorial, type TutorialObjective } from "./Tutorial";

export type RunResult = "alive" | "dead" | "won" | "tutorialComplete";
export type GameMode = "tutorial" | "standard";

export interface Whisper {
  text: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  kind: HostKind;
}

export interface RunStats {
  hijacks: number;
  kills: number;
}

const HOST_BY_TYPE: Record<LevelHostType, HostKind> = {
  SECURITY: "security",
  ENFORCER: "enforcer",
  MUTANT: "mutant",
};

/**
 * The simulation. Engine owns this and drives it with real delta time; every
 * gameplay system is updated from here in a fixed, readable order.
 *
 * Two level modes share the same systems:
 *   tutorial - seven gated chambers, dormant dummies, blast doors, targets.
 *   standard - the open sector with eight hostile hosts.
 */
export class World {
  readonly spore: Spore;
  /** Registry + cursor for every playable level. */
  readonly levels = new LevelManager();
  level: LevelConfig | null = null;
  readonly hosts: Host[] = [];
  readonly whispers: Whisper[] = [];
  readonly combat = new CombatSystem();
  readonly hijack = new HijackSystem();
  readonly lore = new LoreLog();
  readonly stats: RunStats = { hijacks: 0, kills: 0 };

  /** Tutorial architecture. Empty in the standard sector. */
  readonly walls: Rect[] = [];
  readonly doors: Door[] = [];
  readonly targets: TrainingTarget[] = [];
  tutorial: Tutorial | null = null;
  mode: GameMode = "standard";

  projectiles: Projectile[] = [];
  effects: Explosion[] = [];
  particles: Particle[] = [];
  hazards: Hazard[] = [];

  timeScale = 1;
  elapsed = 0;
  result: RunResult = "alive";
  deathCause = "";
  hitStop = 0;
  grace = SPAWN_GRACE;
  lastHostKind: HostKind | null = null;
  damageFlash = 0;
  hitMarker = 0;
  graftBanner: { text: string; detail: string; life: number; maxLife: number } | null = null;

  private readonly ai = new AIController();
  private heartbeat = 0;
  private clearTimer = -1;
  /** Set when a tutorial death must roll back to the chamber checkpoint. */
  private pendingRespawn: string | null = null;

  constructor(
    readonly input: Input,
    readonly camera: Camera,
    readonly decals: DecalSystem,
    readonly sfx: SfxSynth,
  ) {
    this.spore = new Spore(0, 0);
    this.applyLevel(this.levels.loadLevel("tutorial"));
  }

  /**
   * Build the whole simulation from declarative level data. This is the only
   * level boot path: menu entries, retries and the next-sector hand-off all
   * arrive here through LevelManager.
   */
  applyLevel(config: LevelConfig): void {
    const mode: GameMode = config.preset === "tutorial" ? "tutorial" : "standard";
    this.clearRun(mode);
    this.level = config;

    if (mode === "tutorial") {
      const layout = buildTutorialLayout();
      this.walls.push(...layout.walls);
      this.doors.push(...layout.doors);
      this.tutorial = new Tutorial();
      // jumpTo(0) also places the spore and seeds the first chamber.
      this.tutorial.jumpTo(0, this);
      this.decals.reset("tutorial");
    } else {
      this.decals.reset("standard");
      this.grace = SPAWN_GRACE;
    }

    config.hosts.forEach((spawn, index) => {
      const host = new Host(HOST_BY_TYPE[spawn.type], spawn.x, spawn.y);
      if (spawn.isPatrolling === false) {
        host.aiEnabled = false;
        if (mode === "tutorial") {
          host.isTrainingDummy = true;
          host.facing = Math.PI;
        }
      }
      // Stagger the opening reaction so eight bodies never fire as one volley.
      host.ai.reaction = 0.5 + index * 0.06;
      this.hosts.push(host);
    });

    (config.barriers ?? []).forEach((barrier, index) => {
      if (barrier.destructibleByAcid) {
        this.doors.push(
          new Door(`barrier-${config.id}-${index}`, barrier.x, barrier.y, barrier.width, barrier.height, "reinforced"),
        );
      } else {
        this.walls.push({ x: barrier.x, y: barrier.y, w: barrier.width, h: barrier.height });
      }
    });

    this.spore.reset(config.sporeSpawn);
    const view = config.cameraView ?? { width: 1560, height: 880 };
    this.camera.setViewSize(view.width, view.height);
    this.camera.snapTo(this.focusPoint);
  }

  /** Start the Proving Ground. The menu's tutorial entry lands here. */
  startTutorial(): void {
    this.applyLevel(this.levels.loadLevel("tutorial"));
  }

  /** Deploy into the main containment sector. */
  startRun(): void {
    this.applyLevel(this.levels.loadLevel("sector_1"));
  }

  /** Replay whichever mission is loaded. */
  reset(): void {
    this.applyLevel(this.levels.restartCurrentLevel());
  }

  private clearRun(mode: GameMode): void {
    this.mode = mode;
    this.hosts.length = 0;
    this.walls.length = 0;
    this.doors.length = 0;
    this.targets.length = 0;
    this.tutorial = null;
    this.projectiles = [];
    this.effects = [];
    this.particles = [];
    this.hazards = [];
    this.whispers.length = 0;

    this.result = "alive";
    this.deathCause = "";
    this.elapsed = 0;
    this.timeScale = 1;
    this.hitStop = 0;
    this.grace = 0;
    this.lastHostKind = null;
    this.damageFlash = 0;
    this.hitMarker = 0;
    this.graftBanner = null;
    this.heartbeat = 0;
    this.clearTimer = -1;
    this.pendingRespawn = null;
    this.stats.hijacks = 0;
    this.stats.kills = 0;
    this.hijack.reset();
  }

  update(rawDt: number): void {
    const dt = Math.min(rawDt, 1 / 30);

    if (this.result !== "alive") {
      for (const door of this.doors) door.update(dt);
      this.updateEffects(dt);
      this.camera.update(dt, this.focusPoint);
      return;
    }

    this.elapsed += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 7);
    if (this.graftBanner) {
      this.graftBanner.life -= dt;
      if (this.graftBanner.life <= 0) this.graftBanner = null;
    }

    // Win freeze-frame: let the last corpse settle, then report the clear.
    if (this.clearTimer >= 0) {
      this.clearTimer -= dt;
      this.updateEffects(dt);
      this.camera.update(dt, this.focusPoint);
      if (this.clearTimer <= 0) {
        this.result = "won";
        this.sfx.play("win");
        this.lore.unlock("log_06");
      }
      return;
    }

    // Micro-freeze on impact moments. The clock still moves for effects only.
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.updateEffects(dt * 0.35);
      this.camera.update(dt, this.focusPoint);
      return;
    }

    const aiming =
      this.spore.state === "aiming" ||
      this.spore.state === "ejectAim" ||
      this.hijack.detonating ||
      (this.input.rightHeld && (this.spore.state === "free" || this.spore.state === "hosted"));
    this.timeScale = aiming ? BULLET_TIME : 1;
    const dtSim = dt * this.timeScale;
    this.grace = Math.max(0, this.grace - dt);

    for (const door of this.doors) door.update(dt);

    this.hijack.update(dt, dtSim, this);
    this.updateHosts(dt, dtSim);
    if (this.flushRespawn()) return;
    this.combat.update(dtSim, this);
    if (this.flushRespawn()) return;
    this.constrainBodies();
    this.syncPassenger();
    this.updateTargets(dtSim);
    if (this.result === "alive") this.tutorial?.update(dt, this);
    if (this.flushRespawn()) return;
    this.updateEffects(dtSim);
    this.updateWhispers(dt);
    this.updateHeartbeat(dt);
    if (this.result === "alive") this.checkClear();
    this.camera.update(dt, this.focusPoint);
  }

  private updateHosts(dtReal: number, dtSim: number): void {
    for (const host of this.hosts) {
      if (!host.alive) continue;
      // I-frames tick on real time so bullet-time cannot stretch them.
      host.tickDefense(dtReal);
      host.tickAfterimages(dtReal);
      if (host.possessed) {
        // Decay runs on real time: bullet-time never buys extra lifespan.
        if (host.tickDecay(dtReal)) {
          this.meltdown(host);
          return;
        }
      } else if (this.grace <= 0 && host.aiEnabled) {
        this.ai.update(host, dtSim, this);
      }
      host.updateVisual(dtSim);
    }
  }

  private updateTargets(dt: number): void {
    for (const target of this.targets) target.update(dt);
  }

  /** Keep the passenger glued to the body after wall resolution moved it. */
  private syncPassenger(): void {
    if (this.spore.state !== "hosted" && this.spore.state !== "ejectAim") return;
    const host = this.possessed;
    if (!host) return;
    this.spore.position.x = host.position.x;
    this.spore.position.y = host.position.y;
  }

  private constrainBodies(): void {
    const solids: Rect[] = this.walls.slice();
    for (const door of this.doors) {
      if (door.solid) solids.push(door.rect);
    }

    if (this.spore.state !== "flying") {
      resolveCircleWalls(this.spore.position, this.spore.radius, solids);
      clampToArena(this.spore.position, this.spore.radius);
    }
    for (const host of this.hosts) {
      if (!host.alive) continue;
      resolveCircleWalls(host.position, host.radius, solids);
      clampToArena(host.position, host.radius);
    }
  }

  private updateEffects(dt: number): void {
    for (const effect of this.effects) effect.update(dt);
    this.effects = this.effects.filter((effect) => effect.alive);

    // Live particles only: dead ones are spliced in place, and the pool is
    // hard-capped so a chain of explosions cannot bloat the frame.
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      if (!particle) continue;
      particle.update(dt);
      if (!particle.alive) this.particles.splice(i, 1);
    }
    if (this.particles.length > 150) this.particles.splice(0, this.particles.length - 150);
  }

  private updateWhispers(dt: number): void {
    for (const whisper of this.whispers) whisper.life -= dt;
    for (let i = this.whispers.length - 1; i >= 0; i -= 1) {
      if ((this.whispers[i] as Whisper).life <= 0) this.whispers.splice(i, 1);
    }
  }

  private updateHeartbeat(dt: number): void {
    const host = this.possessed;
    if (!host || host.decay > DECAY.warn) {
      this.heartbeat = 0;
      return;
    }
    this.heartbeat -= dt;
    if (this.heartbeat <= 0) {
      const panic = 1 - Math.max(0, host.decay) / DECAY.warn;
      this.heartbeat = 0.32 + (1 - panic) * 0.42;
      this.sfx.play("heartbeat");
      this.addTrauma(0.05);
    }
  }

  private checkClear(): void {
    if (this.mode !== "standard") return;
    if (this.result !== "alive" || this.clearTimer >= 0) return;
    // Level configs own the win condition; fall back to a full sweep.
    const objectives = this.level?.objectives;
    if (objectives && objectives.length > 0) {
      if (!objectives.every((objective) => objective.isCompleted(this))) return;
    } else if (this.hosts.some((host) => host.alive && !host.possessed)) {
      return;
    }
    this.clearTimer = 1;
  }

  /** The worn body ran out of time: it folds inward with the spore still inside. */
  meltdown(host: Host): void {
    if (this.result !== "alive") return;
    host.alive = false;
    host.possessed = false;
    this.decals.stampDetonation(host.position.x, host.position.y, 150);
    this.combat.explode(host.position.x, host.position.y, BLAST.radius * 1.1, BLAST.damage, this, "meltdown");
    this.lore.unlock("log_05");
    this.killSpore("HOST LIFESPAN EXHAUSTED — MELTDOWN");
  }

  /** Incoming damage on a possessed host is converted to lost lifespan. */
  damagePlayerHost(host: Host, seconds: number): void {
    if (this.result !== "alive") return;

    // I-frames: a shotgun spread or a burst deals one penalty, not five.
    if (host.damageGrace > 0) {
      host.flash = Math.max(host.flash, 0.45);
      return;
    }

    host.damageGrace = DECAY.grace;

    // The arrival shield eats the first hit whole, with no clock loss.
    if (host.bioShield > 0) {
      host.bioShield -= 1;
      host.flash = 1;
      this.damageFlash = 0.5;
      this.addTrauma(0.12);
      this.sfx.play("shield");
      return;
    }

    if (host.penalizeDecay(seconds)) {
      this.meltdown(host);
      return;
    }
    this.damageFlash = 1;
    this.addTrauma(0.3);
    this.stop(0.022);
    this.sfx.play("hurt");
  }

  killHost(host: Host): void {
    if (!host.alive) return;
    host.alive = false;
    host.possessed = false;
    if (!host.isTrainingDummy) this.stats.kills += 1;
    this.decals.stampBlood(host.position.x, host.position.y, host.radius + 16, host.facing);
    spawnBurst(this.particles, host.position.x, host.position.y, 16, 320, "#7d1420", 3.6, 0.9);
    spawnBurst(this.particles, host.position.x, host.position.y, 8, 210, host.spec.accent, 2, 0.5);
    this.addTrauma(0.16);
    this.sfx.play("hurt");
  }

  /** Bullet or blast impact on a proving-ground target. */
  damageTarget(target: TrainingTarget, amount: number): void {
    if (!target.alive) return;
    target.takeDamage(amount);
    this.hitMarker = 1;
    spawnBurst(this.particles, target.position.x, target.position.y, 6, 190, "#ffd27a", 2.4, 0.4);
    if (target.alive) {
      this.sfx.play("shield");
      return;
    }
    this.decals.stampScorch(target.position.x, target.position.y, 48);
    spawnBurst(this.particles, target.position.x, target.position.y, 20, 360, "#ffcf6a", 3.2, 0.75);
    spawnBurst(this.particles, target.position.x, target.position.y, 8, 220, "#6d7780", 4, 0.65);
    this.addTrauma(0.18);
    this.sfx.play("blast");
  }

  killSpore(cause: string): void {
    if (this.result !== "alive") return;
    // Training never sends the player back to chamber one: the director rolls
    // the run back to the current chamber checkpoint at a safe point instead.
    if (this.mode === "tutorial" && this.tutorial) {
      if (this.pendingRespawn) return;
      this.pendingRespawn = cause;
      this.decals.stampBlood(this.spore.position.x, this.spore.position.y, 30);
      spawnBurst(this.particles, this.spore.position.x, this.spore.position.y, 22, 360, "#00ff88", 3, 0.9);
      spawnBurst(this.particles, this.spore.position.x, this.spore.position.y, 10, 240, "#a8252f", 4, 0.8);
      this.addTrauma(0.8);
      this.stop(0.06);
      this.sfx.play("meltdown");
      return;
    }
    this.result = "dead";
    this.deathCause = cause;
    this.spore.state = "free";
    this.decals.stampBlood(this.spore.position.x, this.spore.position.y, 34);
    spawnBurst(this.particles, this.spore.position.x, this.spore.position.y, 26, 400, "#00ff88", 3, 0.9);
    spawnBurst(this.particles, this.spore.position.x, this.spore.position.y, 10, 240, "#a8252f", 4, 0.8);
    this.addTrauma(1);
    this.stop(0.1);
    this.sfx.play("meltdown");
  }

  finishTutorial(): void {
    if (this.result !== "alive") return;
    this.result = "tutorialComplete";
    spawnBurst(this.particles, this.tutorial?.portal.x ?? this.spore.position.x, this.tutorial?.portal.y ?? this.spore.position.y, 28, 330, "#8dffca", 3, 0.9);
    this.addTrauma(0.4);
    this.sfx.play("win");
    this.lore.unlock("log_06");
  }

  announceGraft(graft: GraftKind): void {
    const info = Object.values(GRAFT_INFO).find((entry) => entry.graft === graft);
    this.graftBanner = {
      text: GRAFT_LABEL[graft],
      detail: info?.detail ?? "",
      life: 3.2,
      maxLife: 3.2,
    };
    this.sfx.play("graft");
    this.lore.unlock("log_03");
  }

  showWhisper(host: Host): void {
    const lines = WHISPERS[host.kind];
    const text = lines[Math.floor(Math.random() * lines.length)] as string;
    this.whispers.push({
      text,
      x: host.position.x,
      y: host.position.y - host.radius - 24,
      life: 2.4,
      maxLife: 2.4,
      kind: host.kind,
    });
    if (this.whispers.length > 3) this.whispers.shift();
    this.lore.recordWhisper(host.kind, text);
    this.lore.unlock("log_02");
    this.sfx.play("whisper");
  }

  // --- Tutorial level controls -------------------------------------------

  spawnTrainingDummy(x: number, y: number, kind: HostKind = "security"): Host {
    const host = new Host(kind, x, y);
    host.aiEnabled = false;
    host.isTrainingDummy = true;
    host.facing = Math.PI;
    this.hosts.push(host);
    return host;
  }

  /** Live hostile spawned by the director for the final qualification chamber. */
  spawnTutorialHost(kind: HostKind, x: number, y: number): Host {
    const host = new Host(kind, x, y);
    this.hosts.push(host);
    spawnBurst(this.particles, x, y, 14, 220, "#ff8b7a", 2.6, 0.6);
    return host;
  }

  spawnTutorialTarget(x: number, y: number): TrainingTarget {
    const target = new TrainingTarget(x, y);
    this.targets.push(target);
    return target;
  }

  /** Roll a tutorial death back to the start of the current chamber. */
  private flushRespawn(): boolean {
    if (!this.pendingRespawn) return false;
    const cause = this.pendingRespawn;
    this.pendingRespawn = null;
    this.respawnChamber(cause);
    return true;
  }

  private respawnChamber(cause: string): void {
    const phase = this.tutorial?.phase ?? 0;
    const config = this.level;
    if (!config) return;
    // A clean rebuild keeps geometry, bodies and charges consistent.
    this.applyLevel(config);
    this.tutorial?.jumpTo(phase, this);
    this.deathCause = cause;
    this.damageFlash = 1;
    this.grace = 0.7;
    this.addTrauma(0.6);
    this.sfx.play("meltdown");
  }

  openDoor(id: string): void {
    const door = this.doorById(id);
    if (!door || door.kind === "reinforced" || door.target === 1) return;
    door.target = 1;
    this.sfx.play("uiClick");
  }

  doorById(id: string): Door | undefined {
    return this.doors.find((door) => door.id === id);
  }

  /** A corpse blast tears the armored barrier out of its frame. */
  blastBarriers(x: number, y: number, radius: number): void {
    for (const door of this.doors) {
      if (door.kind !== "reinforced" || door.destroyed) continue;
      const center = door.center;
      if (Math.hypot(center.x - x, center.y - y) > radius + Math.max(door.w, door.h) * 0.35) continue;
      door.destroyed = true;
      door.target = 1;
      this.decals.stampScorch(center.x, center.y, 86);
      spawnBurst(this.particles, center.x, center.y, 26, 420, "#e6c455", 4, 0.9);
      spawnBurst(this.particles, center.x, center.y, 14, 300, "#7d1420", 4.5, 1);
      this.addTrauma(0.5);
      this.sfx.play("shield");
    }
  }

  blastTargets(x: number, y: number, radius: number, damage: number): void {
    for (const target of this.targets) {
      if (!target.alive) continue;
      if (distance(target.position, { x, y }) > radius + target.radius) continue;
      this.damageTarget(target, damage);
    }
  }

  /** True when a projectile's travel segment crosses solid level geometry. */
  segmentBlocked(a: Vec2, b: Vec2): boolean {
    for (const wall of this.walls) {
      if (segmentIntersectsRect(a, b, wall)) return true;
    }
    for (const door of this.doors) {
      if (door.solid && segmentIntersectsRect(a, b, door.rect)) return true;
    }
    return false;
  }

  get tutorialPrompt(): TutorialObjective | null {
    return this.tutorial?.objective ?? null;
  }

  get targetsRemaining(): number {
    return this.targets.filter((target) => target.alive).length;
  }

  hostById(id: number | null): Host | undefined {
    if (id === null) return undefined;
    return this.hosts.find((host) => host.id === id);
  }

  nearestEnemy(from: Vec2, range: number): Host | undefined {
    let best: Host | undefined;
    let bestDist = range;
    for (const host of this.hosts) {
      if (!host.alive || host.possessed || host.isTrainingDummy) continue;
      const d = distance(from, host.position);
      if (d < bestDist) {
        bestDist = d;
        best = host;
      }
    }
    return best;
  }

  distanceToSpore(host: Host): number {
    return distance(host.position, this.spore.position);
  }

  get possessed(): Host | undefined {
    return this.hosts.find((host) => host.possessed && host.alive);
  }

  /** What the AI shoots at: the worn body if any, otherwise the exposed spore. */
  get playerPoint(): Vec2 {
    return this.possessed?.position ?? this.spore.position;
  }

  get focusPoint(): Vec2 {
    const focus = this.possessed?.position ?? this.spore.position;
    // The seven chambers share one horizontal band. Locking the camera's Y to
    // its center keeps the floor, ceiling and doors all readable while the
    // player moves through the proving ground.
    if (this.mode === "tutorial") return { x: focus.x, y: 702 };
    return focus;
  }

  get mouseWorld(): Vec2 {
    return this.camera.screenToWorld(this.input.mouse);
  }

  get enemiesRemaining(): number {
    return this.hosts.filter((host) => host.alive && !host.possessed && !host.isTrainingDummy).length;
  }

  addTrauma(amount: number): void {
    this.camera.addTrauma(amount);
  }

  /** Request a micro-freeze, keeping the longest pending one. */
  stop(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds);
  }
}
