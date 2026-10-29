import { segmentIntersectsRect, type Rect } from "../core/arena";
import { POSSESSION } from "../core/config";
import { Host } from "../entities/Host";
import { Hazard, spawnBurst } from "../systems/Effects";
import { Door } from "../world/Tutorial";
import type { World } from "../world/World";
import { generateDungeon, DEEP_ENTRY_INSET, type DungeonLayout } from "./DungeonGenerator";
import { buildFloorGeometry } from "./FloorGeometry";
import type { DungeonProp, Room, SpawnMarker } from "./Room";
import { RunManager, MUTATIONS, type Mutation } from "../game/RunManager";

type Orb = { x: number; y: number; kind: "dna" | "decay"; value: number };

/** Toxic barrels hiss for a beat before the cloud blooms, then stay balanced. */
const BARREL_FUSE = 0.4;
const BARREL_BLAST_RADIUS = 85;
/** Spawn markers must keep 8 tiles of clear floor between themselves and a door. */
const SPAWN_DOOR_CLEARANCE = 128;

/** Circle/rect test for pinched-body recovery. */
function circleHitsRect(p: { x: number; y: number }, radius: number, r: Rect): boolean {
  const closestX = Math.max(r.x, Math.min(p.x, r.x + r.w));
  const closestY = Math.max(r.y, Math.min(p.y, r.y + r.h));
  const dx = p.x - closestX, dy = p.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

export class RoomManager {
  readonly run = new RunManager();
  layout: DungeonLayout;
  current = 0;
  active: Room | null = null;
  draft = false;
  notice = 0;
  fade = 0;
  transitioning = false;
  readonly orbs: Orb[] = [];
  private gateMap = new Map<number, Door[]>();
  private readonly seed: number;
  hazardClock = 0;

  constructor(private readonly world: World, seed = Math.floor(Math.random() * 0xffffffff)) {
    this.seed = seed;
    this.layout = generateDungeon(seed, 1);
    this.buildFloor();
  }

  private buildFloor(): void {
    const world = this.world;
    world.walls.length = 0; world.doors.length = 0; world.hosts.length = 0;
    world.projectiles.length = 0; world.hazards.length = 0; world.effects.length = 0; world.particles.length = 0;
    this.gateMap.clear(); this.active = null; this.current = 0; this.orbs.length = 0;
    world.bounds = this.layout.bounds;
    // One source of truth for collision: the same pure geometry the map
    // integrity check walks is what the floor is actually built from.
    const geometry = buildFloorGeometry(this.layout);
    world.walls.push(...geometry.walls);
    const gateMap = new Map<number, Door[]>();
    for (const g of geometry.gates) {
      const door = new Door(g.id, g.rect.x, g.rect.y, g.rect.w, g.rect.h);
      door.open = 1; door.target = 1;
      world.doors.push(door);
      const doors = gateMap.get(g.room) ?? [];
      doors.push(door); gateMap.set(g.room, doors);
    }
    this.gateMap = gateMap;
    const start = this.layout.rooms[0]!;
    const center = this.center(start);
    world.spore.reset(center);
    const guard = world.spawnTrainingDummy(center.x + 75, center.y, "security");
    guard.isTrainingDummy = true;
    world.decals.reset("standard", world.bounds.width, world.bounds.height, true);
    world.camera.setBounds({ x:0,y:0,w:world.bounds.width,h:world.bounds.height });
    world.camera.setViewSize(650, 420);
    world.camera.snapTo(center);
    world.grace = 0;
  }

  center(room: Room): { x: number; y: number } { return { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 }; }
  roomAt(x: number, y: number): Room | undefined {
    return this.layout.rooms.find(r => x >= r.rect.x && x < r.rect.x+r.rect.w && y >= r.rect.y && y < r.rect.y+r.rect.h);
  }
  get solids(): Rect[] { return this.layout.rooms.flatMap(r => r.props.filter(p => !p.destroyed && p.kind !== "grate").map(p => p.rect)); }

  update(dt: number): void {
    const w = this.world;
    this.notice = Math.max(0, this.notice - dt);
    if (this.transitioning) {
      this.fade += dt;
      if (this.fade >= 0.4) this.nextFloor();
      return;
    }
    this.fade = Math.max(0, this.fade - dt);
    if (this.draft) return;
    this.tickFuses(dt);
    // Development escape hatch: F8 retracts every gate around the player.
    if (import.meta.env.DEV && w.input.wasPressed("F8")) this.forceUnlock();
    this.evacuateGates();
    const p = w.playerPoint;
    const room = this.roomAt(p.x, p.y);
    if (room) {
      this.current = room.id; room.visited = true;
      // Soul Knight rule: combat only commits once the player is three tiles
      // inside the floor. Thresholds, hazard stripes and corridors never lock.
      if (room.state === "unvisited" && this.isDeepInside(room, p)) {
        if (room.kind === "combat" || room.kind === "elite" || room.kind === "portal") this.lock(room);
        else room.state = "cleared";
      }
      this.interact(room, dt);
    }
    this.updateOrbs(dt);
    this.hazardClock += dt;
    if (this.active) {
      const a = this.active;
      if (a.phase === "telegraph") {
        a.timer -= dt;
        if (a.timer <= 0) this.spawnWave(a);
      } else if (a.phase === "fighting" && a.waveHosts.every(id => { const host = w.hostById(id); return !host || !host.alive || host.possessed; })) {
        if (a.wave < a.waves) { a.phase = "between"; a.timer = 0.6; }
        else this.clear(a);
      } else if (a.phase === "between") {
        a.timer -= dt;
        if (a.timer <= 0) this.telegraph(a);
      }
      for (const prop of a.props) {
        if (prop.kind !== "grate" || prop.destroyed || this.hazardClock % 3 < 2) continue;
        const r = prop.rect, player = w.playerPoint;
        if (player.x >= r.x && player.x <= r.x+r.w && player.y >= r.y && player.y <= r.y+r.h) {
          if (w.possessed) w.damagePlayerHost(w.possessed, 2);
          else w.killSpore("CRYO GRATE");
        }
      }
    }
  }

  /** True once the player's centre is three tiles past the inner perimeter. */
  private isDeepInside(room: Room, p: { x: number; y: number }): boolean {
    const inner = room.inner;
    return p.x > inner.x + DEEP_ENTRY_INSET && p.x < inner.x + inner.w - DEEP_ENTRY_INSET &&
      p.y > inner.y + DEEP_ENTRY_INSET && p.y < inner.y + inner.h - DEEP_ENTRY_INSET;
  }

  private lock(room: Room): void {
    room.state = "active"; this.active = room;
    // Doors slam shut instantly so collision and art agree on the same frame.
    for (const door of this.gateMap.get(room.id) ?? []) { door.open = 0; door.target = 0; }
    this.evacuateGates();
    this.world.camera.setBounds(room.rect);
    this.world.sfx.play("door");
    this.telegraph(room);
  }

  /**
   * Fail-safe recovery: a body caught inside a shut gate is pushed onto the
   * room floor along the gate normal, so no one can be pinched on a threshold.
   */
  private evacuateGates(): void {
    const w = this.world;
    const bodies: Array<{ p: { x: number; y: number }; r: number }> = [];
    if (w.spore.state !== "flying") bodies.push({ p: w.spore.position, r: w.spore.radius });
    for (const host of w.hosts) if (host.alive) bodies.push({ p: host.position, r: host.radius });
    for (const doors of this.gateMap.values()) {
      for (const door of doors) {
        if (!door.solid) continue;
        for (const body of bodies) {
          if (!circleHitsRect(body.p, body.r, door.rect)) continue;
          const side = door.id.slice(-1);
          if (side === "n") body.p.y = door.y + door.h + body.r + 0.5;
          else if (side === "s") body.p.y = door.y - body.r - 0.5;
          else if (side === "w") body.p.x = door.x + door.w + body.r + 0.5;
          else body.p.x = door.x - body.r - 0.5;
        }
      }
    }
  }

  /** Debug-only: retract every gate of the room the player is standing in. */
  private forceUnlock(): void {
    const w = this.world;
    const room = this.roomAt(w.playerPoint.x, w.playerPoint.y) ?? this.active ?? this.layout.rooms[this.current];
    if (!room) return;
    for (const door of this.gateMap.get(room.id) ?? []) { door.open = 1; door.target = 1; }
    w.sfx.play("door");
  }
  private telegraph(room: Room): void {
    room.wave++; room.phase = "telegraph"; room.timer = 0.85;
    const p = this.world.playerPoint, r = room.rect;
    // Every doorway is a wall-midpoint opening; markers stay 128px clear of all of them.
    const doors = room.neighbors.map(id => this.layout.rooms[id]!).map(n => n.gx === room.gx
      ? { x: r.x + r.w / 2, y: n.gy < room.gy ? r.y : r.y + r.h }
      : { x: n.gx < room.gx ? r.x : r.x + r.w, y: r.y + r.h / 2 });
    const candidates: { x: number; y: number }[] = [];
    for (const fx of [0.3, 0.42, 0.5, 0.58, 0.7]) {
      for (const fy of [0.3, 0.5, 0.7]) candidates.push({ x: r.x + r.w * fx, y: r.y + r.h * fy });
    }
    const clearOfDoorsAndCover = candidates
      .filter(pos => doors.every(d => Math.hypot(pos.x-d.x, pos.y-d.y) >= SPAWN_DOOR_CLEARANCE))
      .filter(pos => !room.props.some(prop => !prop.destroyed && pos.x >= prop.rect.x-20 && pos.x <= prop.rect.x+prop.rect.w+20 && pos.y >= prop.rect.y-20 && pos.y <= prop.rect.y+prop.rect.h+20));
    const awayFromPlayer = clearOfDoorsAndCover.filter(pos => Math.hypot(pos.x-p.x,pos.y-p.y) >= 110);
    // Farthest-first, and if every anchor is near the player keep the safest
    // ones anyway: a locked room must always be able to produce a wave.
    const pool = (awayFromPlayer.length ? awayFromPlayer : clearOfDoorsAndCover)
      .sort((a,b) => Math.hypot(b.x-p.x,b.y-p.y) - Math.hypot(a.x-p.x,a.y-p.y));
    room.telegraphs = pool
      .slice(0, room.kind === "elite" || room.kind === "portal" ? 3 : 2)
      .map((pos,i): SpawnMarker => ({ ...pos, kind: room.kind === "elite" && i === 0 ? "enforcer" : (room.wave+i+this.run.floor)%3 === 0 ? "mutant" : "security", elite: room.kind === "elite" }));
    this.world.sfx.play("warning");
  }
  private spawnWave(room: Room): void {
    room.waveHosts = [];
    for (const marker of room.telegraphs) {
      // If the player approaches a marker, postpone the whole wave until it is safe.
      if (Math.hypot(marker.x-this.world.playerPoint.x, marker.y-this.world.playerPoint.y) < 90) { room.timer = 0.15; return; }
    }
    for (const marker of room.telegraphs) {
      const host = new Host(marker.kind, marker.x, marker.y);
      if (marker.elite) { host.hp *= 1.75; host.armor = Math.max(host.armor, 0.2); }
      host.ai.reaction = 0.65;
      this.world.hosts.push(host); room.waveHosts.push(host.id);
    }
    room.telegraphs = []; room.phase = "fighting";
  }
  private clear(room: Room): void {
    room.state = "cleared"; room.phase = "none"; this.active = null;
    // The clear is authoritative: open the leaves and drop their colliders now.
    for (const door of this.gateMap.get(room.id) ?? []) { door.open = 1; door.target = 1; }
    this.world.camera.setBounds({x:0,y:0,w:this.world.bounds.width,h:this.world.bounds.height});
    this.notice = 2.2; this.world.sfx.play("win");
    if (room.kind !== "portal") room.rewardOpened = false;
  }
  private interact(room: Room, dt: number): void {
    const w = this.world, center = this.center(room), p = w.playerPoint, d = Math.hypot(p.x-center.x,p.y-center.y);
    if (room.state !== "cleared") return;
    if ((room.kind === "combat" || room.kind === "elite" || room.kind === "chest") && !room.rewardOpened && d < 32) {
      room.rewardOpened = true;
      w.sfx.play("graft");
      for (let i=0;i<(room.kind === "elite" ? 8 : 5);i++) this.orbs.push({x:center.x+Math.cos(i*2.4)*25,y:center.y+Math.sin(i*2.4)*25,kind:"dna",value:1});
      if (room.kind === "chest") w.hijack.charges = Math.min(POSSESSION.maxCharges, w.hijack.charges+1);
      else this.draft = true;
    }
    if (room.kind === "altar" && !room.altarUsed && d < 36 && w.input.wasPressed("KeyE")) {
      if (w.hijack.charges > 0) w.hijack.charges--;
      else this.run.maxDecayPenalty += 3;
      this.run.decayBonus += 5; room.altarUsed = true; w.sfx.play("graft");
    }
    if (room.kind === "portal" && d < 24) { this.transitioning = true; this.fade = dt; }
  }
  chooseMutation(index: number): void {
    if (!this.draft) return;
    this.grantMutation(index);
    this.draft = false; this.world.sfx.play("graft");
  }
  /** Carry the tutorial's selected mutation into the first floor. */
  grantMutation(index: number): void {
    const option = MUTATIONS[index]; if (!option) return;
    this.run.choose(option.id as Mutation);
    if (option.id === "quick-recharge" && this.world.possessed) this.world.possessed.staminaRegenIdle += 5;
    if (option.id === "long-life" && this.world.possessed) this.world.possessed.decay += 3;
  }
  applyHostBonuses(host: Host): void {
    host.decay = Math.max(3, host.decay + this.run.decayBonus - this.run.maxDecayPenalty);
    host.staminaRegenIdle += this.run.mutations.filter(m => m === "quick-recharge").length * 5;
  }
  private updateOrbs(dt: number): void {
    const p = this.world.playerPoint;
    for (let i=this.orbs.length-1;i>=0;i--) {
      const o = this.orbs[i]!, dx=p.x-o.x, dy=p.y-o.y, d=Math.hypot(dx,dy);
      if (d < 16) { if (o.kind === "dna") this.run.biomass += o.value; else if (this.world.possessed) this.world.possessed.decay += 2; this.orbs.splice(i,1); }
      else if (d < 120) { o.x += dx / d * 180 * dt; o.y += dy / d * 180 * dt; }
    }
  }
  hitProps(from: {x:number;y:number}, to: {x:number;y:number}, damage: number): boolean {
    for (const room of this.layout.rooms) for (const prop of room.props) {
      if (prop.destroyed || prop.kind === "grate" || !segmentIntersectsRect(from,to,prop.rect)) continue;
      if (prop.kind !== "pillar") this.damageProp(prop, damage);
      return true;
    }
    return false;
  }
  private damageProp(prop: DungeonProp, damage: number): void {
    if (prop.destroyed) return;
    // Barrels never burst on the hit itself: they hiss, flash and swell first.
    if (prop.kind === "barrel") {
      if (prop.fuse === undefined) {
        prop.fuse = BARREL_FUSE;
        this.world.sfx.play("warning");
        spawnBurst(this.world.particles, prop.rect.x + prop.rect.w/2, prop.rect.y + prop.rect.h/2, 6, 90, "#ff2244", 2, 0.3);
      }
      return;
    }
    prop.hp -= damage * 6;
    if (prop.hp > 0) return;
    prop.destroyed = true;
    const x=prop.rect.x+prop.rect.w/2,y=prop.rect.y+prop.rect.h/2;
    spawnBurst(this.world.particles,x,y,10,150,"#8ca0ba",2,0.4);
    if (Math.random()<0.2) this.orbs.push({x,y,kind:"decay",value:2});
  }

  /** Advance armed barrel fuses, detonating them once the warning window ends. */
  private tickFuses(dt: number): void {
    for (const room of this.layout.rooms) {
      for (const prop of room.props) {
        if (prop.fuse === undefined) continue;
        prop.fuse -= dt;
        if (prop.fuse > 0) continue;
        prop.fuse = undefined;
        prop.destroyed = true;
        const x = prop.rect.x + prop.rect.w/2, y = prop.rect.y + prop.rect.h/2;
        spawnBurst(this.world.particles,x,y,12,170,"#8ca0ba",2,0.4);
        this.world.combat.explode(x,y,BARREL_BLAST_RADIUS,6,this.world,"acid");
        const hazard = new Hazard(x,y,BARREL_BLAST_RADIUS,4,7); hazard.hurtsPlayer = true;
        this.world.hazards.push(hazard);
        if (Math.random()<0.2) this.orbs.push({x,y,kind:"decay",value:2});
      }
    }
  }
  private nextFloor(): void {
    const w = this.world, host = w.possessed;
    if (this.run.floor >= 5) { this.transitioning=false; w.result="won"; w.sfx.play("win"); return; }
    const charges = w.hijack.charges;
    const saved = host ? { kind: host.kind, decay: host.decay, stamina: host.currentStamina, grafts: [...host.grafts] } : null;
    this.run.floor++; this.layout = generateDungeon(this.seed,this.run.floor); this.buildFloor();
    w.hijack.charges = charges;
    if (saved) {
      const p=this.center(this.layout.rooms[0]!); const next=new Host(saved.kind,p.x,p.y); next.becomePossessed();
      next.decay=saved.decay; next.currentStamina=saved.stamina; saved.grafts.forEach(g=>next.grafts.add(g));
      next.staminaRegenIdle += this.run.mutations.filter(m=>m==="quick-recharge").length*5;
      w.hosts.push(next); w.spore.state="hosted";
    }
    this.transitioning=false; this.fade=0.4;
  }
}
