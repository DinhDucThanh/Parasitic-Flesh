import type { Vec2 } from "../core/math";
import type { World } from "../world/World";

/**
 * LEVEL CONTRACT
 *
 * A level is plain data. Anything a future sector needs (spawns, barriers,
 * objectives, the next mission) lives in a `LevelConfig` object registered
 * with `LevelManager`, so adding content never touches simulation code.
 */

export type LevelHostType = "SECURITY" | "ENFORCER" | "MUTANT";

/** A static piece of cover. Acid-destructible barriers become blast doors. */
export interface LevelBarrier {
  x: number;
  y: number;
  width: number;
  height: number;
  destructibleByAcid?: boolean;
}

/** The simulation surface an objective may inspect. */
export type WorldContext = World;

export interface LevelObjective {
  description: string;
  isCompleted: (world: WorldContext) => boolean;
}

export interface LevelHostSpawn {
  type: LevelHostType;
  x: number;
  y: number;
  /** False spawns a dormant body (training dummy / set dressing). */
  isPatrolling?: boolean;
}

/** Which builder the world should use for this level's architecture. */
export type LevelPreset = "tutorial" | "arena";

export interface LevelConfig {
  id: string;
  name: string;
  /** Banner line, e.g. "TUTORIAL // SECTOR 0", "CONTAINMENT // SECTOR 1". */
  sectorTag: string;
  arenaBounds: { width: number; height: number };
  sporeSpawn: Vec2;
  hosts: LevelHostSpawn[];
  barriers?: LevelBarrier[];
  objectives?: LevelObjective[];
  nextLevelId?: string | null;
  /** Optional extras understood by the world; no core code needs editing. */
  preset?: LevelPreset;
  cameraView?: { width: number; height: number };
}
