import type { Rect } from "../core/arena";
import type { HostKind } from "../entities/Host";

export type RoomKind = "start" | "combat" | "elite" | "altar" | "chest" | "portal";
export type RoomState = "unvisited" | "active" | "cleared";
export type PropKind = "pillar" | "crate" | "barrel" | "grate";
export interface DungeonProp {
  kind: PropKind;
  rect: Rect;
  hp: number;
  destroyed: boolean;
  /** Seconds left on a toxic barrel's warning fuse before it detonates. */
  fuse?: number;
}
export interface SpawnMarker { x: number; y: number; kind: HostKind; elite: boolean }
export interface Room {
  id: number;
  gx: number;
  gy: number;
  kind: RoomKind;
  rect: Rect;
  /** Walkable floor inside the wall band. Deep-entry checks measure from here. */
  inner: Rect;
  neighbors: number[];
  state: RoomState;
  visited: boolean;
  waves: number;
  wave: number;
  props: DungeonProp[];
  rewardOpened: boolean;
  altarUsed: boolean;
  telegraphs: SpawnMarker[];
  timer: number;
  phase: "none" | "telegraph" | "fighting" | "between";
  waveHosts: number[];
}
