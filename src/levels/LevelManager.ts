import { ARENA } from "../core/config";
import { TUTORIAL } from "../world/Tutorial";
import type { LevelConfig } from "./Level";

/**
 * LEVEL MANAGER
 *
 * Owns the registry of playable levels and the "where am I" cursor. The world
 * asks for a config; the manager never touches simulation state itself, so
 * levels stay declarative and hot-swappable.
 *
 * Adding a sector: append one plain object to `LEVELS` and point a previous
 * level's `nextLevelId` at it. No engine or physics changes required.
 */
export class LevelManager {
  private currentId: string | null = null;

  private readonly levels: Record<string, LevelConfig> = {
    tutorial: {
      id: "tutorial",
      name: "THE PROVING GROUND",
      sectorTag: "TUTORIAL // SECTOR 0",
      preset: "tutorial",
      arenaBounds: { width: TUTORIAL.roomWidth * TUTORIAL.rooms, height: TUTORIAL.roomHeight },
      sporeSpawn: TUTORIAL.spawn,
      cameraView: { width: TUTORIAL.roomWidth, height: TUTORIAL.roomHeight },
      // The tutorial director seeds every body per chamber; no static spawns.
      hosts: [],
      nextLevelId: "sector_1",
      objectives: [
        {
          description: "Reach the sensor pad",
          isCompleted: (world) => (world.tutorial?.phase ?? 0) >= 1,
        },
        {
          description: "Hijack a body and destroy both drones",
          isCompleted: (world) => (world.tutorial?.phase ?? 0) >= 2,
        },
        {
          description: "Glide the corridor on stamina",
          isCompleted: (world) => (world.tutorial?.phase ?? 0) >= 3,
        },
        {
          description: "Switch bodies and detonate the barricade",
          isCompleted: (world) => (world.tutorial?.phase ?? 0) >= 4,
        },
        {
          description: "Clear the breach team and board the elevator",
          isCompleted: (world) => world.result === "tutorialComplete",
        },
      ],
    },

    sector_1: {
      id: "sector_1",
      name: "CONTAINMENT // SECTOR 1",
      sectorTag: "CONTAINMENT // SECTOR 1",
      preset: "arena",
      arenaBounds: { width: ARENA.width, height: ARENA.height },
      sporeSpawn: { x: ARENA.width / 2, y: ARENA.height - 150 },
      cameraView: { width: 1560, height: 880 },
      hosts: [],
      barriers: [],
      nextLevelId: null,
      objectives: [
        {
          description: "Eliminate every hostile in the sector",
          isCompleted: (world) => world.enemiesRemaining === 0,
        },
      ],
    },
  };

  get currentLevelId(): string | null {
    return this.currentId;
  }

  get current(): LevelConfig | null {
    return this.currentId ? (this.levels[this.currentId] ?? null) : null;
  }

  list(): LevelConfig[] {
    return Object.values(this.levels);
  }

  has(id: string): boolean {
    return Boolean(this.levels[id]);
  }

  /** Select a level by id and hand back its config. */
  loadLevel(id: string): LevelConfig {
    const level = this.levels[id];
    if (!level) throw new Error(`Unknown level: ${id}`);
    this.currentId = id;
    return level;
  }

  restartCurrentLevel(): LevelConfig {
    return this.loadLevel(this.currentId ?? "tutorial");
  }

  /** Returns null at the end of the campaign. */
  loadNextLevel(): LevelConfig | null {
    const next = this.current?.nextLevelId;
    if (!next || !this.has(next)) return null;
    return this.loadLevel(next);
  }
}
