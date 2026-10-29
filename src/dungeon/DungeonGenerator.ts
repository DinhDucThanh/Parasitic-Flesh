import type { Rect } from "../core/arena";
import type { DungeonProp, Room, RoomKind } from "./Room";

/** Standard Soul-Knight combat chamber: 28 x 18 tiles of 16px. */
export const TILE = 16;
export const ROOM_W = 28 * TILE, ROOM_H = 18 * TILE, CORRIDOR = 4 * TILE, DOOR_WIDTH = 4 * TILE, WALL = TILE;
export const STEP_X = ROOM_W + CORRIDOR, STEP_Y = ROOM_H + CORRIDOR, MARGIN = 64;
/** Three full tiles inside the inner floor before a room may commit to combat. */
export const DEEP_ENTRY_INSET = 3 * TILE;
/**
 * Corridors are 64 x 64 squares in both directions, so their orientation has
 * to be authored rather than inferred from width vs height. Without it the
 * side walls land across both doorways and seal the room off entirely.
 */
export interface Corridor extends Rect { axis: "h" | "v" }
export interface DungeonLayout { rooms: Room[]; corridors: Corridor[]; bounds: { width: number; height: number }; seed: number }

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const directions = [[1,0],[-1,0],[0,1],[0,-1]] as const;

/** A randomized tree avoids accidental edges and reserves three terminal nodes. */
export function generateDungeon(seed: number, floor: number): DungeonLayout {
  let attempt = 0;
  for (;;) {
    const rng = random((seed ^ Math.imul(floor, 0x9e3779b1) ^ Math.imul(attempt++, 0x85ebca6b)) >>> 0);
    const cells: { gx: number; gy: number; parent: number; depth: number }[] = [{ gx: 2, gy: 2, parent: -1, depth: 0 }];
    const wanted = 10 + Math.floor(rng() * 3); // start + 5..7 combat + four special rooms
    while (cells.length < wanted) {
      const candidates: { parent: number; gx: number; gy: number }[] = [];
      for (let i = 0; i < cells.length; i++) for (const [dx, dy] of directions) {
        const gx = cells[i]!.gx + dx, gy = cells[i]!.gy + dy;
        if (gx < 0 || gx >= 5 || gy < 0 || gy >= 5 || cells.some(c => c.gx === gx && c.gy === gy)) continue;
        candidates.push({ parent: i, gx, gy });
      }
      if (!candidates.length) break;
      const choice = candidates[Math.floor(rng() * candidates.length)]!;
      cells.push({ ...choice, depth: cells[choice.parent]!.depth + 1 });
    }
    if (cells.length !== wanted) continue;
    const degrees = cells.map((_, i) => (i === 0 ? 0 : 1) + cells.filter(c => c.parent === i).length);
    const leaves = cells.map((c,i) => ({ ...c, i })).filter(c => c.i !== 0 && degrees[c.i] === 1).sort((a,b) => b.depth - a.depth);
    if (leaves.length < 3) continue;
    const portal = leaves[0]!.i, altar = leaves[1]!.i, chest = leaves[2]!.i;
    const eliteCandidates = cells.map((_,i) => i).filter(i => i !== 0 && i !== portal && i !== altar && i !== chest);
    const elite = eliteCandidates[Math.floor(rng() * eliteCandidates.length)]!;
    const rooms: Room[] = cells.map((c, id) => {
      const kind: RoomKind = id === 0 ? "start" : id === portal ? "portal" : id === altar ? "altar" : id === chest ? "chest" : id === elite ? "elite" : "combat";
      const rect = { x: MARGIN + c.gx * STEP_X, y: MARGIN + c.gy * STEP_Y, w: ROOM_W, h: ROOM_H };
      const props: DungeonProp[] = [];
      const prop = (kind: DungeonProp["kind"], x: number, y: number, size = 16): void => { props.push({ kind, rect: { x: rect.x + x, y: rect.y + y, w: size, h: size }, hp: kind === "crate" ? 30 : 1, destroyed: false }); };
      if (kind === "combat" || kind === "elite") {
        // 2-4 cover islands break sight lines while leaving the door lanes open.
        const template = id % 4;
        if (template === 0) {
          prop("pillar", 112, 72, 32); prop("pillar", 304, 72, 32);
          prop("pillar", 112, 184, 32); prop("pillar", 304, 184, 32);
          prop("crate", 144, 128); prop("crate", 288, 128);
        } else if (template === 1) {
          prop("pillar", 144, 64, 32); prop("pillar", 272, 192, 32);
          prop("crate", 208, 64); prop("crate", 208, 208); prop("barrel", 160, 144);
        } else if (template === 2) {
          prop("pillar", 208, 80, 32); prop("pillar", 96, 192, 32); prop("pillar", 320, 192, 32);
          prop("crate", 208, 208);
        } else {
          prop("pillar", 96, 96, 32); prop("pillar", 320, 96, 32);
          prop("pillar", 96, 192, 32); prop("pillar", 320, 192, 32);
          prop("barrel", 208, 144);
        }
        prop("grate", 80, 240, 32);
      }
      // The floor inside the wall band. Entry logic measures from this rect so
      // a doorway, its hazard stripes and the corridor never start combat.
      const inner = { x: rect.x + WALL, y: rect.y + WALL, w: rect.w - WALL * 2, h: rect.h - WALL * 2 };
      return { id, gx: c.gx, gy: c.gy, kind, rect, inner, neighbors: [], state: kind === "start" ? "cleared" : "unvisited", visited: id === 0, waves: kind === "portal" ? 1 : kind === "elite" ? 3 : 2, wave: 0, props, rewardOpened: false, altarUsed: false, telegraphs: [], timer: 0, phase: "none", waveHosts: [] };
    });
    const corridors: Corridor[] = [];
    for (let i = 1; i < cells.length; i++) {
      const parent = cells[i]!.parent, a = rooms[parent]!, b = rooms[i]!;
      a.neighbors.push(i); b.neighbors.push(parent);
      if (a.gx !== b.gx) corridors.push({ axis: "h", x: Math.min(a.rect.x, b.rect.x) + ROOM_W, y: a.rect.y + (ROOM_H - DOOR_WIDTH) / 2, w: CORRIDOR, h: DOOR_WIDTH });
      else corridors.push({ axis: "v", x: a.rect.x + (ROOM_W - DOOR_WIDTH) / 2, y: Math.min(a.rect.y, b.rect.y) + ROOM_H, w: DOOR_WIDTH, h: CORRIDOR });
    }
    return { rooms, corridors, seed, bounds: { width: MARGIN * 2 + 4 * STEP_X + ROOM_W, height: MARGIN * 2 + 4 * STEP_Y + ROOM_H } };
  }
}
