import { clampToArena, type Bounds } from "../core/arena";
import { DECAY, POSSESSION } from "../core/config";
import { approachAngle, clamp, smoothing, type Vec2 } from "../core/math";
import { Entity } from "./Entity";

export type HostKind = "security" | "enforcer" | "mutant";
export type WeaponKind = "rifle" | "shotgun" | "claw";
/** Chimera lunge state machine, readable by AI, input and renderer. */
export type LungePhase = "stalk" | "windup" | "dash" | "recover";
/** Signature traits harvested by the spore when it leaves a host. */
export type GraftKind = "dorsalShield" | "acidStride";

/** Leaving body A grafts A's signature trait onto the next body you enter. */
export const GRAFT_BY_KIND: Record<HostKind, GraftKind | null> = {
  security: null,
  enforcer: "dorsalShield",
  mutant: "acidStride",
};

export const GRAFT_LABEL: Record<GraftKind, string> = {
  dorsalShield: "DORSAL PLATING",
  acidStride: "ACID STRIDE",
};

/** Cell rows holding the articulated head and the aim-rotated weapon in a rig. */
export const HOST_RIG_ROWS: Record<HostKind, { head: number; weapon: number }> = {
  security: { head: 6, weapon: 7 },
  enforcer: { head: 6, weapon: 7 },
  mutant: { head: 7, weapon: 8 },
};

export interface WeaponSpec {
  name: string;
  kind: WeaponKind;
  damage: number;
  cooldown: number;
  pellets: number;
  spread: number;
  projectileSpeed: number;
  range: number;
}

export interface HostSpec {
  kind: HostKind;
  name: string;
  /** Arcade class line shown on the specimen card. */
  classTag: string;
  /** One short sentence. No stat sheets. */
  weaponBlurb: string;
  /** Single signature tag. */
  trait: string;
  /** One short line describing the graft this body donates. */
  graftBlurb: string;
  radius: number;
  speed: number;
  lifespan: number;
  hp: number;
  armor: number;
  body: string;
  accent: string;
  weapon: WeaponSpec;
}

export const HOST_SPECS: Record<HostKind, HostSpec> = {
  security: {
    kind: "security",
    name: "SECURITY GUARD",
    classTag: "RANGE / RAPID",
    weaponBlurb: "Assault rifle. Accurate mid-range kinetic fire.",
    trait: "Fragile Flesh | Fast Aim",
    graftBlurb: "No inherited graft.",
    radius: 17,
    speed: 190,
    lifespan: 20,
    hp: 4,
    armor: 0,
    body: "#315f96",
    accent: "#8fc4ff",
    weapon: {
      name: "SEMI-AUTO RIFLE",
      kind: "rifle",
      damage: 2,
      cooldown: 0.16,
      pellets: 1,
      spread: 0.025,
      projectileSpeed: 480,
      range: 900,
    },
  },
  enforcer: {
    kind: "enforcer",
    name: "HEAVY ENFORCER",
    classTag: "BRUISER / SHIELD",
    weaponBlurb: "Five-pellet shotgun. Frontal shield blocks shots and spore leaps.",
    trait: "Frontal Guard | Heavy Plate",
    graftBlurb: "Dorsal plating turns its back into a wall.",
    radius: 22,
    speed: 135,
    lifespan: 15,
    hp: 7,
    armor: 0.5,
    body: "#4b5159",
    accent: "#e6c455",
    weapon: {
      name: "PUMP SHOTGUN",
      kind: "shotgun",
      damage: 2,
      cooldown: 0.85,
      pellets: 5,
      spread: 0.26,
      projectileSpeed: 430,
      range: 380,
    },
  },
  mutant: {
    kind: "mutant",
    name: "MUTANT CHIMERA",
    classTag: "AMBUSH / LUNGE",
    weaponBlurb: "No walking: linear claw-lunges, then recovery.",
    trait: "Bestial Speed | Frenzy",
    graftBlurb: "Acid stride leaves caustic footprints.",
    radius: 18,
    /** It never walks: locomotion is the lunge alone. */
    speed: 0,
    lifespan: 16,
    hp: 5,
    armor: 0,
    body: "#b2313f",
    accent: "#ff8892",
    weapon: {
      name: "SLASHING CLAWS",
      kind: "claw",
      damage: 5,
      cooldown: 0.65,
      pellets: 1,
      spread: 0,
      projectileSpeed: 0,
      range: 64,
    },
  },
};

/** Scratch memory for the AI controller; harmless to inspect from debug tools. */
export interface AIState {
  decide: number;
  strafe: number;
  reaction: number;
  fireTimer: number;
  windup: number;
  windupKind: "shot" | "leap" | null;
  windupDir: Vec2;
  leapCooldown: number;
}

/**
 * A body the spore can wear. Never owns health-as-life for the player: while
 * possessed, incoming damage is converted into lost lifespan by CombatSystem.
 */
export class Host extends Entity {
  readonly kind: HostKind;
  readonly spec: HostSpec;

  facing = -Math.PI / 2;
  /** Smoothed presentation angle, separate from authoritative weapon aim. */
  renderAim = -Math.PI / 2;
  /** Smoothed heading of the lower body; drives the 4-way walk rows. */
  moveAngle = -Math.PI / 2;
  /** Quantized 4-way body track, read by the renderer. */
  walkDir: "down" | "up" | "side" = "up";
  private lastPosition: Vec2 = { x: 0, y: 0 };
  hp: number;
  armor: number;
  /** Seconds of lifespan remaining. Only meaningful while possessed. */
  decay: number;
  possessed = false;
  deathHandled = false;
  /** Seconds this body has been possessed; gates the switch lockout. */
  possessedTime = 0;
  /** True while Shift sprint is held in a possessed body. */
  sprinting = false;
  /** Sprint stamina: 10s of continuous sprint, 5s to refill while standing still. */
  maxStamina = 100;
  currentStamina = 100;
  staminaDrainRate = 10;
  staminaRegenIdle = 20;
  staminaRegenWalking = 8;
  /** Seconds after sprinting before stamina starts to refill. */
  staminaRegenDelay = 0.4;
  staminaDelayTimer = 0;
  /** Set at zero stamina; sprint stays locked until stamina reaches the recovery point. */
  isExhausted = false;
  /** Momentum carried into a slide after releasing a sprint. */
  slideSpeed = 0;
  slideDir: Vec2 = { x: 1, y: 0 };
  /** Ghost afterimages left behind by a sprint, fading over 0.25s. */
  afterimages: { x: number; y: number; facing: number; walkPhase: number; walkDir: "down" | "up" | "side"; life: number }[] = [];
  private afterimageClock = 0;
  /** I-frames: while > 0, hits inside the window cost no lifespan. */
  damageGrace = 0;
  /** Free first hit, granted on arrival in a fresh body. */
  bioShield = 0;
  /** Proving-ground dummies stand still until the player takes them. */
  aiEnabled = true;
  /** Dormant practice bodies are not part of a sector's hostile count. */
  isTrainingDummy = false;
  readonly grafts = new Set<GraftKind>();

  // Combat timers
  fireCooldown = 0;
  dashTime = 0;
  dashDir: Vec2 = { x: 1, y: 0 };
  /** Per-dash movement profile (AI lunge vs possessed burst). */
  dashSpeed = 0;
  dashDistanceLeft = 0;
  readonly dashHits = new Set<number>();

  // Chimera lunge state (unused by gun hosts).
  lungePhase: LungePhase = "stalk";
  lungeTimer = 0;

  // Telegraphed attack (readable wind-up before a shot / leap).
  windup = 0;
  windupKind: "shot" | "leap" | null = null;
  windupDir: Vec2 = { x: 1, y: 0 };

  // Presentation state (written by gameplay, read by the renderer).
  /** One-sprite-pixel breath dip applied to the head and weapon while idling. */
  idleDip = 0;
  walkPhase = Math.random() * Math.PI * 2;
  recoil = 0;
  muzzle = 0;
  flash = 0;
  shieldFlash = 0;
  /** Seconds left on the "NEURAL LINK CALIBRATING" warning after a too-early leap. */
  calibrateFlash = 0;
  corruption = 0;
  aimLaser = 0;
  moving = 0;
  animation = "idle";
  animationTime = 0;
  /** A silent body switch leaves a short-lived collapsing sprite. */
  dropTime = -1;

  readonly ai: AIState = {
    decide: 0,
    strafe: 1,
    reaction: 1.8,
    fireTimer: 1.2,
    windup: 0,
    windupKind: null,
    windupDir: { x: 1, y: 0 },
    leapCooldown: 0,
  };

  constructor(kind: HostKind, x: number, y: number) {
    const spec = HOST_SPECS[kind];
    super(x, y, spec.radius);
    this.kind = kind;
    this.spec = spec;
    this.hp = spec.hp;
    this.armor = spec.armor;
    this.decay = spec.lifespan;
    this.lastPosition = { x, y };
  }

  /** Walk row for the current body heading. */
  get walkAnimation(): "walk_down" | "walk_up" | "walk_side" {
    return this.walkDir === "down" ? "walk_down" : this.walkDir === "up" ? "walk_up" : "walk_side";
  }

  /** Side rows mirror on leftward travel; front/back rows never flip. */
  get bodyFlip(): boolean {
    return Math.cos(this.kind === "mutant" ? this.renderAim : this.moveAngle) < 0;
  }

  /** Four-way track for a heading; +y is screen-down. */
  private directionOf(angle: number): "down" | "up" | "side" {
    const sy = Math.sin(angle);
    if (sy > Math.SQRT1_2) return "down";
    if (sy < -Math.SQRT1_2) return "up";
    return "side";
  }

  get weapon(): WeaponSpec {
    return this.spec.weapon;
  }

  get isDashing(): boolean {
    return this.dashTime > 0;
  }

  /** 1 = fresh host, 0 = about to melt down. */
  get decayFraction(): number {
    return clamp(this.decay / this.spec.lifespan, 0, 1);
  }

  get isCritical(): boolean {
    return this.possessed && this.decay <= DECAY.warn;
  }

  get speed(): number {
    const sprint = this.sprinting ? POSSESSION.sprintMultiplier : 1;
    return this.spec.speed * (this.grafts.has("acidStride") ? 1.35 : 1) * sprint;
  }

  becomePossessed(): void {
    this.possessed = true;
    this.possessedTime = 0;
    this.sprinting = false;
    this.currentStamina = this.maxStamina;
    this.staminaDelayTimer = 0;
    this.isExhausted = false;
    this.slideSpeed = 0;
    this.afterimages.length = 0;
    this.decay = this.spec.lifespan;
    this.corruption = 0;
    // A fresh body arrives with one absorbed hit and no lingering i-frames.
    this.damageGrace = 0;
    this.bioShield = DECAY.bioShield;
    // Drop any lunge the AI had in flight; the player starts clean.
    this.lungePhase = "stalk";
    this.lungeTimer = 0;
    this.dashTime = 0;
    this.dashSpeed = 0;
    this.dashDistanceLeft = 0;
    // Silent arrival: no weapon may discharge during the hijack grace window.
    this.fireCooldown = Math.max(this.fireCooldown, POSSESSION.hijackGrace);
    this.windup = 0;
    this.aimLaser = 0;
  }

  /** Advances the invulnerability window on real time (bullet-time never extends it). */
  tickDefense(dt: number): void {
    this.damageGrace = Math.max(0, this.damageGrace - dt);
    this.calibrateFlash = Math.max(0, this.calibrateFlash - dt);
  }

  /** 1 = just hit, 0 = vulnerable again. Drives the white i-frame ring. */
  get graceFraction(): number {
    return clamp(this.damageGrace / DECAY.grace, 0, 1);
  }

  /** Returns true when the clock runs out (meltdown). */
  tickDecay(dt: number): boolean {
    if (!this.possessed) return false;
    this.possessedTime += dt;
    this.decay -= this.sprinting ? dt * POSSESSION.sprintDrain : dt;
    return this.decay <= 0;
  }

  /** Damage the shell, not the passenger: subtracts lifespan instead of HP. */
  penalizeDecay(seconds: number): boolean {
    this.decay -= seconds;
    this.flash = 1;
    return this.decay <= 0;
  }

  /** Blast damage strips plating before it lands. */
  takeDamage(amount: number): number {
    const applied = this.armor > 0 ? Math.max(1, amount * (1 - this.armor)) : amount;
    this.hp -= applied;
    this.flash = 1;
    if (this.hp <= 0) this.alive = false;
    return applied;
  }

  peelArmor(): void {
    this.armor = 0;
  }

  /** Move along a direction, normalized and clamped to the level bounds. */
  move(dir: Vec2, dt: number, speed: number, bounds?: Bounds): void {
    const len = Math.hypot(dir.x, dir.y);
    if (len > 1e-4) {
      this.position.x += (dir.x / len) * speed * dt;
      this.position.y += (dir.y / len) * speed * dt;
      clampToArena(this.position, this.radius, bounds);
      this.moving = 1;
    }
  }

  /** Possessed movement with slide: releasing a sprint carries momentum instead of stopping dead. */
  glide(dir: Vec2, dt: number, speed: number, bounds?: Bounds): void {
    const len = Math.hypot(dir.x, dir.y);
    if (len > 1e-4) {
      this.slideDir = { x: dir.x / len, y: dir.y / len };
      this.slideSpeed = this.sprinting ? speed : 0;
      this.move(dir, dt, speed, bounds);
      return;
    }
    if (this.slideSpeed < 1) {
      this.slideSpeed = 0;
      return;
    }
    // Velocity falls to 8% over the slide window, frame-rate independent.
    this.slideSpeed *= Math.pow(0.08, dt / POSSESSION.slideTime);
    this.position.x += this.slideDir.x * this.slideSpeed * dt;
    this.position.y += this.slideDir.y * this.slideSpeed * dt;
    this.moving = 1;
    clampToArena(this.position, this.radius, bounds);
  }

  /**
   * Drains stamina while sprinting and refills it otherwise. Returns whether the
   * sprint is actually active this frame (Shift held, moving, not exhausted).
   */
  updateStamina(dt: number, moving: boolean, wantsSprint: boolean): boolean {
    const sprinting = wantsSprint && moving && !this.isExhausted && this.currentStamina > 0;
    if (sprinting) {
      this.currentStamina -= this.staminaDrainRate * dt;
      this.staminaDelayTimer = this.staminaRegenDelay;
      if (this.currentStamina <= 0) {
        this.currentStamina = 0;
        this.isExhausted = true;
      }
    } else if (this.staminaDelayTimer > 0) {
      this.staminaDelayTimer = Math.max(0, this.staminaDelayTimer - dt);
    } else {
      const rate = moving ? this.staminaRegenWalking : this.staminaRegenIdle;
      this.currentStamina = Math.min(this.maxStamina, this.currentStamina + rate * dt);
    }
    if (this.isExhausted && this.currentStamina >= 25) this.isExhausted = false;
    return sprinting;
  }

  /** Spawns and ages ghost afterimages while sprinting. Called once per sim tick. */
  tickAfterimages(dt: number): void {
    for (const ghost of this.afterimages) ghost.life -= dt;
    this.afterimages = this.afterimages.filter((g) => g.life > 0);
    if (!this.sprinting) {
      this.afterimageClock = 0;
      return;
    }
    this.afterimageClock += dt;
    if (this.afterimageClock >= POSSESSION.afterimageInterval) {
      this.afterimageClock = 0;
      this.afterimages.push({
        x: this.position.x,
        y: this.position.y,
        facing: this.facing,
        walkPhase: this.walkPhase,
        walkDir: this.walkDir,
        life: 0.25,
      });
    }
  }

  turnToward(angle: number, rate: number, dt: number): void {
    this.facing = approachAngle(this.facing, angle, rate * dt);
  }

  /** Decay the visual timers; called once per frame for every living host. */
  updateVisual(dt: number): void {
    this.renderAim = approachAngle(this.renderAim, this.facing, dt * 14);
    // Travel heading comes from actual displacement, so the lower body always
    // steps in the direction it moves instead of moonwalking behind the aim.
    const dx = this.position.x - this.lastPosition.x;
    const dy = this.position.y - this.lastPosition.y;
    this.lastPosition.x = this.position.x;
    this.lastPosition.y = this.position.y;
    const travel = dx * dx + dy * dy;
    if (travel > 0.0025 && travel < 1600) {
      const target = Math.atan2(dy, dx);
      const diff = Math.atan2(Math.sin(target - this.moveAngle), Math.cos(target - this.moveAngle));
      this.moveAngle += diff * Math.min(1, dt * 14);
    }
    // The rooted chimera reads its body direction from its facing instead.
    this.walkDir = this.directionOf(this.kind === "mutant" ? this.renderAim : this.moveAngle);
    const next = this.kind === "mutant"
      ? this.lungePhase === "windup" ? "telegraph" : this.isDashing || this.lungePhase === "dash" ? "lunge" : this.lungePhase === "recover" ? "stun" : this.walkAnimation
      : this.muzzle > 0 ? "fire" : this.moving > 0.1 ? this.walkAnimation : "idle";
    if (next !== this.animation) { this.animation = next; this.animationTime = 0; }
    else this.animationTime += dt;
    // Exhale frames lower the torso art; the head and weapon follow by one pixel.
    const idleFrame = Math.floor(this.animationTime * 5) % 4;
    this.idleDip = this.kind !== "mutant" && this.animation === "idle" && (idleFrame === 1 || idleFrame === 2) ? 1 : 0;
    this.walkPhase += dt * (5 + this.moving * 9);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.muzzle = Math.max(0, this.muzzle - dt * 14);
    this.flash = Math.max(0, this.flash - dt * 5.5);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 4);
    this.moving = Math.max(0, this.moving - dt * 6);

    const drain = this.possessed ? clamp(1 - this.decay / (this.spec.lifespan * 0.55), 0, 1) : 0;
    this.corruption += (drain - this.corruption) * smoothing(3.5, dt);
  }
}
