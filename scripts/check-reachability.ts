/**
 * Dungeon map integrity check — `npm run check:map` (also run in CI).
 *
 * Generates floors across many seeds and proves, using the same pure collision
 * geometry `RoomManager` builds the game from, that:
 *   1. every room's deep-entry zone is reachable from the start room,
 *   2. every gate threshold can be stood on (no invisible caps),
 *   3. every corridor can be walked end to end,
 *   4. no wall had to be dropped by the threshold fail-safe,
 *   5. no solid prop sits on a gate or inside a corridor.
 *
 * A single walkable cell is enough for (1): the point is that the player can
 * physically reach the chamber, not that one specific pixel is clear.
 */
import type { Rect } from "../src/core/arena";
import { DEEP_ENTRY_INSET, generateDungeon, type DungeonLayout } from "../src/dungeon/DungeonGenerator";
import { buildFloorGeometry } from "../src/dungeon/FloorGeometry";

/** Grid resolution; every corridor lane is 64px wide, so 8px is ample. */
const CELL = 8;
/** The player's collision disc is radius 7. Pad a little so a grid pass is a real pass. */
const CLEARANCE = 9;
const SEEDS = 128;
const FLOORS = 5;
const MAX_REPORTED = 12;

interface Grid {
  cols: number;
  rows: number;
  data: Uint8Array;
}

function makeGrid(width: number, height: number): Grid {
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
  return { cols, rows, data: new Uint8Array(cols * rows) };
}

/** Mark every cell whose centre lies inside `rect` (optionally inflated by `pad`). */
function paint(grid: Grid, rect: Rect, pad = 0): void {
  const x0 = Math.max(0, Math.floor((rect.x - pad) / CELL));
  const y0 = Math.max(0, Math.floor((rect.y - pad) / CELL));
  const x1 = Math.min(grid.cols - 1, Math.floor((rect.x + rect.w + pad) / CELL));
  const y1 = Math.min(grid.rows - 1, Math.floor((rect.y + rect.h + pad) / CELL));
  for (let y = y0; y <= y1; y += 1) {
    const row = y * grid.cols;
    for (let x = x0; x <= x1; x += 1) grid.data[row + x] = 1;
  }
}

function indexOf(grid: Grid, x: number, y: number): number {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return -1;
  return cy * grid.cols + cx;
}

/** Breadth-first flood over walkable cells; returns the visited mask. */
function flood(walkable: Grid, start: number): Uint8Array {
  const seen = new Uint8Array(walkable.cols * walkable.rows);
  const queue = new Int32Array(walkable.cols * walkable.rows);
  let head = 0, tail = 0;
  seen[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const cell = queue[head++]!;
    const x = cell % walkable.cols;
    if (x > 0) { const n = cell - 1; if (!seen[n] && walkable.data[n]) { seen[n] = 1; queue[tail++] = n; } }
    if (x < walkable.cols - 1) { const n = cell + 1; if (!seen[n] && walkable.data[n]) { seen[n] = 1; queue[tail++] = n; } }
    const up = cell - walkable.cols;
    if (up >= 0 && !seen[up] && walkable.data[up]) { seen[up] = 1; queue[tail++] = up; }
    const down = cell + walkable.cols;
    if (down < seen.length && !seen[down] && walkable.data[down]) { seen[down] = 1; queue[tail++] = down; }
  }
  return seen;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

interface Tally { rooms: number; gates: number; corridors: number }

function checkFloor(layout: DungeonLayout, floor: number, tally: Tally): string[] {
  const problems: string[] = [];
  const geometry = buildFloorGeometry(layout);

  if (geometry.dropped.length) {
    problems.push(`${geometry.dropped.length} wall(s) overlapped a gate threshold and had to be dropped`);
  }
  if (geometry.gates.length !== layout.corridors.length * 2) {
    problems.push(`${geometry.gates.length} gates for ${layout.corridors.length} corridors (expected twice as many)`);
  }

  const walkable = makeGrid(layout.bounds.width, layout.bounds.height);
  const blocked = makeGrid(layout.bounds.width, layout.bounds.height);
  for (const room of layout.rooms) paint(walkable, room.inner);
  for (const corridor of layout.corridors) paint(walkable, corridor);
  for (const gate of geometry.gates) paint(walkable, gate.rect);
  for (const wall of geometry.walls) paint(blocked, wall, CLEARANCE);
  for (const room of layout.rooms) {
    for (const prop of room.props) {
      if (prop.destroyed || prop.kind === "grate") continue;
      paint(blocked, prop.rect, CLEARANCE);
      for (const gate of geometry.gates) {
        if (overlaps(prop.rect, gate.rect)) problems.push(`room ${room.id} ${prop.kind} sits on gate ${gate.id}`);
      }
      for (const corridor of layout.corridors) {
        if (overlaps(prop.rect, corridor)) problems.push(`room ${room.id} ${prop.kind} sits in a corridor`);
      }
    }
  }
  for (let i = 0; i < walkable.data.length; i += 1) {
    if (blocked.data[i]) walkable.data[i] = 0;
  }

  const start = layout.rooms[0]!;
  const startCell = indexOf(walkable, start.inner.x + start.inner.w / 2, start.inner.y + start.inner.h / 2);
  if (startCell < 0 || !walkable.data[startCell]) {
    problems.push(`start room ${start.id} has no walkable centre`);
    return problems;
  }
  const seen = flood(walkable, startCell);
  const reachable = (x: number, y: number): boolean => {
    const cell = indexOf(walkable, x, y);
    return cell >= 0 && seen[cell] === 1;
  };

  for (const room of layout.rooms) {
    tally.rooms += 1;
    const inset = room.inner;
    const x0 = Math.max(0, Math.floor((inset.x + DEEP_ENTRY_INSET) / CELL));
    const y0 = Math.max(0, Math.floor((inset.y + DEEP_ENTRY_INSET) / CELL));
    const x1 = Math.min(walkable.cols - 1, Math.floor((inset.x + inset.w - DEEP_ENTRY_INSET) / CELL));
    const y1 = Math.min(walkable.rows - 1, Math.floor((inset.y + inset.h - DEEP_ENTRY_INSET) / CELL));
    let deepReached = false;
    for (let y = y0; y <= y1 && !deepReached; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (seen[y * walkable.cols + x]) { deepReached = true; break; }
      }
    }
    if (!deepReached) problems.push(`room ${room.id} (${room.kind}) deep-entry zone unreachable from the start`);
  }

  for (const gate of geometry.gates) {
    tally.gates += 1;
    if (!reachable(gate.rect.x + gate.rect.w / 2, gate.rect.y + gate.rect.h / 2)) {
      problems.push(`gate ${gate.id} threshold is unreachable`);
    }
  }

  for (const corridor of layout.corridors) {
    tally.corridors += 1;
    if (!reachable(corridor.x + corridor.w / 2, corridor.y + corridor.h / 2)) {
      problems.push(`corridor at (${corridor.x},${corridor.y}) is ${corridor.axis === "h" ? "horizontal" : "vertical"} but impassable`);
    }
  }

  return problems.map((problem) => `seed ${layout.seed} floor ${floor}: ${problem}`);
}

const tally: Tally = { rooms: 0, gates: 0, corridors: 0 };
const failures: string[] = [];
const started = Date.now();

for (let seed = 1; seed <= SEEDS; seed += 1) {
  for (let floor = 1; floor <= FLOORS; floor += 1) {
    const layout = generateDungeon(seed, floor);
    const problems = checkFloor(layout, floor, tally);
    if (problems.length) failures.push(...problems);
  }
}

const layouts = SEEDS * FLOORS;
const elapsed = ((Date.now() - started) / 1000).toFixed(2);
console.log(`Map integrity: ${layouts} floors (${SEEDS} seeds x ${FLOORS}), ${tally.rooms} rooms, ${tally.gates} gates, ${tally.corridors} corridors in ${elapsed}s`);

if (failures.length) {
  for (const failure of failures.slice(0, MAX_REPORTED)) console.error(`  FAIL ${failure}`);
  if (failures.length > MAX_REPORTED) console.error(`  ... ${failures.length - MAX_REPORTED} more`);
  console.error(`Map integrity FAILED: ${failures.length} unreachable or blocked element(s).`);
  process.exitCode = 1;
} else {
  console.log("Map integrity PASSED: every room, gate threshold and corridor is reachable from the start.");
}
