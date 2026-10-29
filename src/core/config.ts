/**
 * Every tuning value in the game lives here so feel can be iterated in one place.
 * Units: positions in world pixels, times in seconds, speeds in px/s.
 */

export const ARENA = {
  width: 2000,
  height: 1300,
  /** Wall thickness used for movement clamping and the hazard border band. */
  wall: 34,
} as const;

export const SPORE = {
  radius: 7,
  /** Deliberate, readable movement: fast enough to matter, slow enough to plan. */
  speed: 330,
  /** Movement multiplier while bullet-time aiming; keeps aiming responsive. */
  aimMove: 0.6,
  flightSpeed: 1400,
  maxFlightTime: 1.1,
} as const;

/** Global simulation multiplier while the player holds RMB. */
export const BULLET_TIME = 0.18;

export const DECAY = {
  /** Below this many seconds the meltdown warnings kick in. */
  warn: 3,
  /** Hostile damage subtracts this much lifespan per hit. */
  hitPenalty: 1.2,
  /** Invulnerability after a hit: pellet bursts cannot stack penalties. */
  grace: 0.35,
  /** Free absorbed hit granted the moment the spore takes a new body. */
  bioShield: 1,
} as const;

/** Possession movement and detonation rules shared by input, world and HUD. */
export const POSSESSION = {
  /** Holding Shift multiplies host speed by this. */
  sprintMultiplier: 2.2,
  /** Seconds for momentum to bleed off (to 8%) after releasing a sprint. */
  slideTime: 0.18,
  /** Seconds between ghost afterimages while sprinting. */
  afterimageInterval: 0.045,
  /** Sprinting drains the decay clock this many times faster. */
  sprintDrain: 1.25,
  /** Minimum time in a body before a leap is allowed. */
  switchLockout: 3,
  /** Weapon lockout after a hijack: the new body cannot shoot on arrival. */
  hijackGrace: 0.3,
  /** Bullet-time factor while the detonation is being held. */
  detonateTimeScale: 0.18,
  maxCharges: 3,
  /** Seconds to regain one charge. */
  chargeRecharge: 15,
  detonateRadius: 200,
} as const;

export const BLAST = {
  radius: 140,
  damage: 8,
  knockback: 320,
} as const;

/**
 * Mutant Chimera lunge tuning.
 *
 * The chimera never walks: it stalks at 0 px/s, coils for a fixed wind-up,
 * bursts along a locked line, then sits in recovery long enough to punish.
 * Numbers are shared by the AI, the possession controller and the art pass.
 */
export const CHIMERA = {
  /** Beyond this it ignores you; inside it slowly turns to face you. */
  detectRange: 520,
  /** Inside this range a cooldown-ready chimera coils. */
  lungeRange: 280,
  windup: 0.45,
  dashSpeed: 680,
  dashTime: 0.22,
  /** Hard budget so a lunge can never cross a whole chamber. */
  dashDistance: 220,
  recovery: 0.8,
  /** Delay after recovery before the next coil. */
  cooldown: 1.5,
  /** Slow head-tracking rate while stalking. */
  turnRate: 1.6,
  playerDashSpeed: 900,
  playerDashDistance: 220,
  playerDashTime: 220 / 900,
  playerCooldown: 0.65,
} as const;

export const AIM = {
  /** Half-angle of the launch cone, in radians (~32 degrees). */
  cone: 0.56,
  range: 700,
} as const;

export const HITSTOP = {
  hijack: 0.045,
  blast: 0.035,
  meltdown: 0.12,
} as const;

export const CAMERA = {
  /** Exponential follow rate toward the focus point. */
  follow: 9,
  /** Trauma decays at this rate per second. */
  traumaDecay: 1.8,
  maxTrauma: 1,
} as const;

export const PLAYER_START = { x: ARENA.width / 2, y: ARENA.height - 150 } as const;

/** Enemies hold still this long at the start of a run, so the player can read the arena. */
export const SPAWN_GRACE = 3;

export const COLORS = {
  void: "#05070a",
  floorDark: "#202833",
  floorLight: "#27303b",
  grid: "#3a4856",
  rivet: "#526171",
  hazard: "#d8a91d",
  blood: "#7d1420",
  gore: "#a8252f",
  acid: "#b6ff3d",
  acidDeep: "#4f8c12",
  spore: "#00ff88",
  sporeDark: "#047a48",
  security: "#315f96",
  securityLight: "#6da4dd",
  enforcer: "#4b5159",
  enforcerLight: "#9aa4b0",
  shield: "#e6c455",
  mutant: "#b2313f",
  mutantLight: "#ff7079",
  warning: "#ff3d3d",
  ui: "#00ff88",
  uiDim: "#2a7a58",
  panel: "#0a0d12",
  text: "#d8f5e6",
} as const;

/** Mutable runtime settings, shared by the menu, audio and camera. */
export const SETTINGS = {
  volume: 0.75,
  screenShake: true,
};
