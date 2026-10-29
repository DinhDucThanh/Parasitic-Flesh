import type { Rect } from "../core/arena";
import { DOOR_WIDTH, WALL, type DungeonLayout } from "./DungeonGenerator";
import type { Room } from "./Room";

export type GateSide = "n" | "s" | "e" | "w";

/** A blast-door opening in a room's wall band, keyed by room and side. */
export interface FloorGate {
  id: string;
  room: number;
  side: GateSide;
  rect: Rect;
}

export interface FloorGeometry {
  walls: Rect[];
  gates: FloorGate[];
  /** Walls the threshold fail-safe had to remove. Must stay empty. */
  dropped: Rect[];
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Pure collision geometry for one floor: the room shells (with door openings
 * cut out), the corridor side walls, and the gate rectangles those openings
 * occupy. `RoomManager` builds its colliders and doors from this, and the
 * reachability check walks the exact same walls, so the two cannot drift.
 */
export function buildFloorGeometry(layout: DungeonLayout): FloorGeometry {
  const walls: Rect[] = [];
  const gates: FloorGate[] = [];
  const wall = (x: number, y: number, w: number, h: number): void => { walls.push({ x, y, w, h }); };
  const gate = (room: Room, side: GateSide, x: number, y: number, w: number, h: number): void => {
    gates.push({ id: `${room.id}-${side}`, room: room.id, side, rect: { x, y, w, h } });
  };

  for (const room of layout.rooms) {
    const { x, y, w, h } = room.rect;
    const neighbors = room.neighbors.map((id) => layout.rooms[id]!);
    const openings = (dx: number, dy: number): boolean =>
      neighbors.some((n) => n.gx === room.gx + dx && n.gy === room.gy + dy);
    const horizontal = (yy: number, open: boolean): void => {
      if (!open) wall(x, yy, w, WALL);
      else { wall(x, yy, (w - DOOR_WIDTH) / 2, WALL); wall(x + (w + DOOR_WIDTH) / 2, yy, (w - DOOR_WIDTH) / 2, WALL); }
    };
    const vertical = (xx: number, open: boolean): void => {
      if (!open) wall(xx, y, WALL, h);
      else { wall(xx, y, WALL, (h - DOOR_WIDTH) / 2); wall(xx, y + (h + DOOR_WIDTH) / 2, WALL, (h - DOOR_WIDTH) / 2); }
    };
    horizontal(y, openings(0, -1)); horizontal(y + h - WALL, openings(0, 1));
    vertical(x, openings(-1, 0)); vertical(x + w - WALL, openings(1, 0));

    if (openings(0, -1)) gate(room, "n", x + (w - DOOR_WIDTH) / 2, y, DOOR_WIDTH, WALL);
    if (openings(0, 1)) gate(room, "s", x + (w - DOOR_WIDTH) / 2, y + h - WALL, DOOR_WIDTH, WALL);
    if (openings(-1, 0)) gate(room, "w", x, y + (h - DOOR_WIDTH) / 2, WALL, DOOR_WIDTH);
    if (openings(1, 0)) gate(room, "e", x + w - WALL, y + (h - DOOR_WIDTH) / 2, WALL, DOOR_WIDTH);
  }

  // Corridor sides bridge the open room thresholds, preventing escape into
  // the void. Orientation is authored: every corridor is a 64x64 square, so
  // inferring it from width vs height seals every east-west passage.
  for (const c of layout.corridors) {
    if (c.axis === "h") {
      wall(c.x, c.y - WALL, c.w, WALL); wall(c.x, c.y + c.h, c.w, WALL);
    } else {
      wall(c.x - WALL, c.y, WALL, c.h); wall(c.x + c.w, c.y, WALL, c.h);
    }
  }

  // Fail-safe: no wall may intrude on a gate opening. Geometry sitting on a
  // threshold soft-locks the floor no matter what the door itself does.
  const dropped: Rect[] = [];
  const kept = walls.filter((w) => {
    if (!gates.some((g) => rectsOverlap(w, g.rect))) return true;
    dropped.push(w);
    return false;
  });

  return { walls: kept, gates, dropped };
}
