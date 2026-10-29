import type { AssetManager } from "../assets/AssetManager";
import { AIM, CHIMERA, COLORS, DECAY, POSSESSION, SPAWN_GRACE } from "../core/config";
import { FONT, fillTextShadow } from "../core/fonts";
import type { Camera } from "../core/Camera";
import type { Input } from "../core/Input";
import { TAU, clamp } from "../core/math";
import { HOST_RIG_ROWS, type Host } from "../entities/Host";
import type { World } from "../world/World";
import { TUTORIAL, TUTORIAL_ROOMS, type TutorialObjective } from "../world/Tutorial";
import { SpriteSheet } from "./SpriteSheet";
import { Tilemap } from "./Tilemap";
import { drawMinimap } from "./MinimapUI";
import { MUTATIONS } from "../game/RunManager";
import {
  drawAimCone,
  drawExplosion,
  drawHazard,
  drawParticle,
  drawWhisper,
  rgba,
  roundedRect,
} from "./ProceduralArt";

/**
 * Composite renderer. Layer order is deliberate:
 *   floor + decals → level architecture → targets → entities → darkness &
 *   dynamic lights → world UI → screen post-FX → HUD → scanlines → cursor.
 *
 * Performance rules: no ctx.shadowBlur anywhere, gradients for glows and
 * light punches are pre-rendered once into offscreen sprites, and the canvas
 * backing store never exceeds 1.25x CSS resolution.
 */
interface SlimeDrop { x: number; y: number; radius: number; maxLife: number; life: number; color: string; stretch: number; angle: number }

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  width = 1;
  height = 1;

  dpr = 1;
  private readonly lightCanvas: HTMLCanvasElement;
  private readonly lightCtx: CanvasRenderingContext2D;
  private readonly scanPattern: CanvasPattern | null;
  private readonly punchSprite: HTMLCanvasElement;
  private readonly glowSprites = new Map<string, HTMLCanvasElement>();
  /** Eased visibility of the under-feet stamina bar. */
  private staminaBarAlpha = 0;
  private staminaBarTime = 0;
  private sheets: { spore: SpriteSheet; guard: SpriteSheet; enforcer: SpriteSheet; chimera: SpriteSheet } | null = null;
  private tilemap: Tilemap | null = null;
  private slime: SlimeDrop[] = [];
  private slimeClock = 0;
  private slimeTime = 0;
  private slimeWasMoving = false;
  private slimeDir = { x: 1, y: 0 };
  private slimeLevel: World["level"] = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: AssetManager,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.lightCanvas = document.createElement("canvas");
    const lightCtx = this.lightCanvas.getContext("2d");
    if (!lightCtx) throw new Error("2D lighting context unavailable");
    this.lightCtx = lightCtx;

    this.scanPattern = this.buildScanPattern();
    this.punchSprite = this.buildPunchSprite();
  }

  private buildScanPattern(): CanvasPattern | null {
    const tile = document.createElement("canvas");
    tile.width = 1;
    tile.height = 4;
    const tctx = tile.getContext("2d");
    if (!tctx) return null;
    tctx.fillStyle = "rgba(0, 0, 0, 0.26)";
    tctx.fillRect(0, 0, 1, 1);
    return this.ctx.createPattern(tile, "repeat");
  }

  /** One 256px alpha falloff reused by every light punch (destination-out). */
  private buildPunchSprite(): HTMLCanvasElement {
    const sprite = document.createElement("canvas");
    sprite.width = 256;
    sprite.height = 256;
    const ctx = sprite.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
      gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.45)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
    }
    return sprite;
  }

  private glowSprite(color: string): HTMLCanvasElement {
    const cached = this.glowSprites.get(color);
    if (cached) return cached;

    const sprite = document.createElement("canvas");
    sprite.width = 128;
    sprite.height = 128;
    const ctx = sprite.getContext("2d");
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, rgba(color, 1));
      gradient.addColorStop(0.5, rgba(color, 0.32));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    this.glowSprites.set(color, sprite);
    return sprite;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(cssWidth));
    this.height = Math.max(1, Math.floor(cssHeight));
    this.dpr = Math.min(dpr, 1.25);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.lightCanvas.width = this.width;
    this.lightCanvas.height = this.height;
  }

  begin(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** World transform helper (CSS-pixel space). */
  applyCamera(camera: Camera): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    camera.applyTransform(ctx);
  }

  drawWorld(world: World, time: number): void {
    const ctx = this.ctx;
    const camera = world.camera;
    const view = camera.view;
    this.applyCamera(camera);

    this.ensureSprites();
    ctx.imageSmoothingEnabled = false;
    if (world.dungeon) {
      ctx.save(); ctx.beginPath();
      for (const room of world.dungeon.layout.rooms) ctx.rect(room.rect.x, room.rect.y, room.rect.w, room.rect.h);
      for (const corridor of world.dungeon.layout.corridors) ctx.rect(corridor.x, corridor.y, corridor.w, corridor.h);
      ctx.clip();
      this.tilemap?.ground(ctx, view, world.bounds.width, world.bounds.height);
      world.decals.draw(ctx);
      ctx.restore();
    } else {
      this.tilemap?.ground(ctx, view, world.bounds.width, world.bounds.height);
      world.decals.draw(ctx);
    }
    this.drawTutorialFloor(world, time);
    this.tilemap?.architecture(ctx, view, world.walls, world.doors);
    this.drawTutorialProps(world, time);
    this.drawLabDecor(world, time);
    this.drawDungeon(world, time);
    this.drawSlime(ctx, world, time);

    for (const hazard of world.hazards) drawHazard(ctx, hazard);

    for (const particle of world.particles) {
      if (inView(view, particle.position.x, particle.position.y, particle.size + 4)) {
        drawParticle(ctx, particle);
      }
    }

    for (const target of world.targets) {
      if (inView(view, target.position.x, target.position.y, 60)) {
        const props = this.assets.image("props");
        if (props) ctx.drawImage(props, (target.alive ? 5 : 6) * 16, 0, 16, 16, target.position.x - 22, target.position.y - 22, 44, 44);
      }
    }

    const hosts = world.hosts.filter((host) => host.alive || (host.dropTime >= 0 && host.dropTime < 1.2)).sort((a, b) => a.position.y - b.position.y);
    for (const host of hosts) {
      if (!inView(view, host.position.x, host.position.y, host.radius * 3)) continue;
      this.drawHostSprite(ctx, host, time);
    }

    if (world.spore.isExposed && inView(view, world.spore.position.x, world.spore.position.y, 80)) {
      this.drawSporeTrail(ctx, world);
      this.drawSporeSprite(ctx, world, time);
    }

    for (const projectile of world.projectiles) {
      if (inView(view, projectile.position.x, projectile.position.y, 30)) {
        const image = this.assets.image("projectiles");
        if (image) {
          ctx.save(); ctx.translate(projectile.position.x, projectile.position.y); ctx.rotate(projectile.angle);
          ctx.drawImage(image, projectile.team === "player" ? 0 : 16, 0, 16, 8, -16, -4, 20, 8);
          ctx.restore();
        }
      }
    }

    for (const effect of world.effects) {
      const image = this.assets.image("vfx_explosion");
      if (image && effect.kind !== "spark") {
        const t = effect.t;
        const size = effect.radius * (1.2 + t * 1.6);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.95;
        ctx.translate(effect.position.x, effect.position.y);
        ctx.rotate(effect.kind === "meltdown" ? -time * 0.6 : time * 0.6);
        ctx.drawImage(image, -size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        drawExplosion(ctx, effect, time);
      }
    }

    this.drawLighting(world);
    this.drawGlows(world, time);
    this.drawWorldUi(world, time);
    this.drawChamberMask(world);
  }

  /**
   * Sealed chambers: everything outside the active room (or the pair being
   * panned between) is void. This keeps a 16:9 viewport from peeking into the
   * next chamber when the room is 1.6:1.
   */
  private drawChamberMask(world: World): void {
    const mask = world.cameraMask;
    if (!mask) return;
    const ctx = this.ctx;
    const x0 = -2000;
    const y0 = -2000;
    const x1 = 8000;
    const y1 = 3000;
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(x0, y0, x1 - x0, mask.y - y0);
    ctx.fillRect(x0, mask.y + mask.h, x1 - x0, y1 - (mask.y + mask.h));
    ctx.fillRect(x0, mask.y, mask.x - x0, mask.h);
    ctx.fillRect(mask.x + mask.w, mask.y, x1 - (mask.x + mask.w), mask.h);
  }

  // --- Level architecture -------------------------------------------------

  private drawTutorialFloor(world: World, time: number): void {
    const tutorial = world.tutorial;
    if (!tutorial) return;
    const ctx = this.ctx;

    // Stencilled chamber number on each room floor.
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = FONT(104, 700);
    ctx.fillStyle = "rgba(205, 225, 235, 0.045)";
    TUTORIAL_ROOMS.forEach((x, index) => {
      ctx.fillText(String(index + 1).padStart(2, "0"), x, TUTORIAL.roomHeight - 80);
    });
    ctx.restore();

    // Live wall conduits: lethal to the naked spore in chamber one.
    for (const conduit of tutorial.conduits) {
      const charge = tutorial.phase === 0 ? 0.7 + Math.sin(time * 9) * 0.2 : 0.2;
      ctx.save(); ctx.globalAlpha = charge;
      ctx.fillStyle = "rgba(255,0,85,0.24)"; ctx.fillRect(conduit.x, conduit.y, conduit.w, conduit.h);
      ctx.fillStyle = "#ff0055"; ctx.fillRect(conduit.x + conduit.w * 0.3, conduit.y, conduit.w * 0.4, conduit.h);
      ctx.fillStyle = "#ff88aa"; ctx.fillRect(conduit.x + conduit.w * 0.47, conduit.y, 2, conduit.h);
      const lab = this.assets.image("lab_props");
      if (lab) {
        ctx.drawImage(lab, 48, 0, 24, 36, conduit.x - 5, conduit.y - 12, conduit.w + 10, 28);
        ctx.drawImage(lab, 48, 0, 24, 36, conduit.x - 5, conduit.y + conduit.h - 16, conduit.w + 10, 28);
      }
      ctx.fillStyle = "#ffe3ed";
      for (let i = 0; i < 4; i++) {
        const y = conduit.y + ((time * 120 + i * 83) % conduit.h);
        ctx.fillRect(conduit.x + ((i % 2) ? 2 : conduit.w - 4), y, 2, 3);
      }
      ctx.restore();
    }

    // Door scanner pad in chamber one.
    const scanner = tutorial.scanner;
    const active = tutorial.phase === 0;
    const pulse = active ? 0.55 + Math.sin(time * 4) * 0.35 : 0.18;
    ctx.save();
    ctx.translate(scanner.x, scanner.y);
    ctx.strokeStyle = `rgba(0, 255, 136, ${pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, scanner.radius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(0, 255, 136, ${pulse * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, scanner.radius * 0.58, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -time * 24;
    ctx.beginPath();
    ctx.arc(0, 0, scanner.radius * 0.82, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(0, 255, 136, ${pulse * 0.18})`;
    ctx.beginPath();
    ctx.arc(0, 0, scanner.radius * 0.42, 0, TAU);
    ctx.fill();
    // Chevrons point into the first door.
    ctx.fillStyle = `rgba(0, 255, 136, ${pulse * 0.8})`;
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(16 + i * 10, -7);
      ctx.lineTo(24 + i * 10, 0);
      ctx.lineTo(16 + i * 10, 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

  }

  private drawTutorialProps(world: World, time: number): void {
    const tutorial = world.tutorial;
    if (!tutorial) return;
    const ctx = this.ctx;
    // Shared pixel assets teach the same telegraph, capsule and portal as the dungeon.
    const props = this.assets.image("props");
    if (props) {
      for (const marker of tutorial.breachMarkers) {
        ctx.save(); ctx.globalAlpha = 0.65 + Math.sin(time * 20) * 0.35;
        ctx.drawImage(props, 8 * 16, 0, 16, 16, marker.x - 16, marker.y - 16, 32, 32); ctx.restore();
      }
      if (tutorial.portal.active) {
        ctx.drawImage(props, 4 * 16, 0, 16, 16, tutorial.portal.x - 36, tutorial.portal.y - 36, 72, 72);
        if (!tutorial.capsuleOpened) ctx.drawImage(props, 2 * 16, 0, 16, 16, tutorial.capsule.x - 24, tutorial.capsule.y - 24, 48, 48);
      }
      const barricade = world.doorById("barricade");
      if (barricade && !barricade.destroyed) {
        for (let y = barricade.y; y < barricade.y + barricade.h; y += 26) ctx.drawImage(props, 0, 0, 16, 16, barricade.x, y, barricade.w, Math.min(26, barricade.y + barricade.h - y));
      }
    }
  }

  private drawLabDecor(world: World, time: number): void {
    const lab = this.assets.image("lab_props");
    if (!lab) return;
    const ctx = this.ctx, view = world.camera.view;
    const rooms = world.dungeon ? world.dungeon.layout.rooms.map(room => room.rect) : TUTORIAL_ROOMS.map(x => ({ x: x - TUTORIAL.roomWidth / 2, y: 0, w: TUTORIAL.roomWidth, h: TUTORIAL.roomHeight }));
    ctx.save(); ctx.imageSmoothingEnabled = false;
    for (const room of rooms) {
      if (room.x > view.maxX || room.x + room.w < view.minX || room.y > view.maxY || room.y + room.h < view.minY) continue;
      // Decoration sits just inside walls and never changes collision or spawn locations.
      const fixtures = world.dungeon
        ? [{ x: room.x + 58, y: room.y + 42, kind: 0 }, { x: room.x + room.w - 58, y: room.y + 42, kind: 1 }]
        : [
            { x: room.x + 58, y: room.y + 42, kind: 0 },
            { x: room.x + room.w * 0.35, y: room.y + 55, kind: 1 },
            { x: room.x + room.w * 0.65, y: room.y + room.h - 55, kind: 0 },
            { x: room.x + room.w - 82, y: room.y + 42, kind: 1 },
          ];
      for (const f of fixtures) {
        if (!inView(view, f.x, f.y, 90)) continue;
        if (f.kind === 0) {
          ctx.save(); ctx.globalAlpha = 0.25; ctx.globalCompositeOperation = "lighter";
          ctx.drawImage(this.glowSprite("#00ff88"), f.x - 48, f.y - 48, 96, 96); ctx.restore();
        }
        ctx.drawImage(lab, f.kind * 24, 0, 24, 36, f.x - 12, f.y - 18, 24, 36);
        if (f.kind === 0) {
          ctx.fillStyle = "#b3ffec";
          for (let i = 0; i < 3; i++) ctx.fillRect(f.x - 4 + i * 4, f.y + 8 - ((time * 6 + i * 7) % 16), 1, 1);
        } else {
          ctx.globalAlpha = 0.4 + (Math.sin(time * 7) + 1) * 0.3;
          ctx.fillStyle = "#00ff88"; ctx.fillRect(f.x + 1, f.y + 6, 2, 2); ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }

  private drawDungeon(world: World, time: number): void {
    const dungeon = world.dungeon, image = this.assets.image("props"), tiles = this.assets.image("tileset");
    if (!dungeon || !image || !tiles) return;
    const ctx = this.ctx, view = world.camera.view;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    const sprite = (index: number, x: number, y: number, size: number): void => {
      ctx.drawImage(image, index * 16, 0, 16, 16, x - size / 2, y - size / 2, size, size);
    };
    for (const room of dungeon.layout.rooms) {
      if (!inView(view, room.rect.x + room.rect.w / 2, room.rect.y + room.rect.h / 2, 300)) continue;
      for (const prop of room.props) {
        if (prop.destroyed) continue;
        const r = prop.rect, col = prop.kind === "pillar" ? 2 : prop.kind === "barrel" ? 1 : prop.kind === "crate" ? 0 : 2;
        const row = prop.kind === "grate" ? 0 : 2;
        if (prop.kind === "crate" || prop.kind === "barrel") ctx.drawImage(image, col * 16, 0, 16, 16, r.x, r.y, r.w, r.h);
        else ctx.drawImage(tiles, col * 16, row * 16, 16, 16, r.x, r.y, r.w, r.h);
        if (prop.kind === "grate") {
          ctx.fillStyle = "rgba(0,255,136,0.65)";
          for (let i = 0; i < 3; i++) ctx.fillRect(r.x + 5 + i * 9, r.y + r.h - 4 - ((time * 5 + i * 6) % (r.h - 6)), 1, 2);
        }
        if (prop.kind === "grate" && room.state === "active" && dungeon.hazardClock % 3 >= 1.5) {
          ctx.globalAlpha = dungeon.hazardClock % 3 >= 2 ? 0.8 : 0.3 + Math.sin(time * 20) * 0.2;
          ctx.fillStyle = "#ff0055"; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1;
        }
        if (prop.kind === "barrel" && prop.fuse !== undefined) {
          // Warning swell: the casing flashes red/green while the blast ring opens.
          const swell = 1 - prop.fuse / 0.4;
          const flash = Math.sin(time * 55) > 0;
          const pad = 2 + swell * 4;
          ctx.globalAlpha = 0.5 + Math.sin(time * 55) * 0.25;
          ctx.fillStyle = flash ? "#ff2244" : "#00ff88";
          ctx.fillRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = flash ? "rgba(255,34,68,0.9)" : "rgba(0,255,136,0.8)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + r.h / 2, 12 + swell * 73, 0, TAU);
          ctx.stroke();
        }
      }
      const c = dungeon.center(room);
      if (room.kind === "start") sprite(7, c.x + 75, c.y, 32);
      if (room.kind === "altar" && !room.altarUsed) { sprite(3,c.x,c.y,32); ctx.font=FONT(11,700); ctx.textAlign="center"; fillTextShadow(ctx,"[E] SACRIFICE FOR BLESSING",c.x,c.y-25,"#00ff88"); }
      if (room.kind === "portal") { ctx.globalAlpha=room.state === "cleared" ? 1 : 0.4; sprite(4,c.x,c.y,40); ctx.globalAlpha=1; }
      if ((room.kind === "chest" || room.kind === "combat" || room.kind === "elite") && room.state === "cleared" && !room.rewardOpened) sprite(2,c.x,c.y,32);
      for (const marker of room.telegraphs) { ctx.globalAlpha=0.65+Math.sin(time*20)*0.35; sprite(8,marker.x,marker.y,24); ctx.globalAlpha=1; }
    }
    for (const orb of dungeon.orbs) { ctx.fillStyle=orb.kind === "dna" ? "#00ff88" : "#8effc0"; ctx.fillRect(orb.x-3,orb.y-3,6,6); }
    ctx.restore();
  }

  private drawMutationDraft(width: number, height: number): void {
    const ctx=this.ctx;
    ctx.save(); ctx.fillStyle="rgba(0,0,0,0.82)"; ctx.fillRect(0,0,width,height);
    ctx.textAlign="center"; ctx.font=FONT(24,700); fillTextShadow(ctx,"CHOOSE A MUTATION",width/2,height/2-75,"#00ff88");
    MUTATIONS.forEach((option,i)=>{
      const y=height/2-40+i*48; ctx.fillStyle="#101e25"; ctx.fillRect(width/2-200,y,400,40);
      ctx.strokeStyle="#00aa55"; ctx.strokeRect(width/2-200,y,400,40);
      ctx.font=FONT(14,700); fillTextShadow(ctx,`[${i+1}] ${option.title}`,width/2,y+16,"#d8f5e6");
      ctx.font=FONT(11,600); fillTextShadow(ctx,option.description,width/2,y+31,"#8ca0ba");
    });
    ctx.restore();
  }

  private ensureSprites(): void {
    if (!this.tilemap) {
      const tiles = this.assets.image("tileset");
      if (tiles) this.tilemap = new Tilemap(tiles);
    }
    if (this.sheets) return;
    const spore = this.assets.image("spore");
    const guard = this.assets.image("host_security");
    const chimera = this.assets.image("host_mutant");
    const enforcer = this.assets.image("host_enforcer");
    if (!spore || !guard || !chimera || !enforcer) return;
    this.sheets = {
      spore: new SpriteSheet(spore, 16, 16, {
        idle: { row: 0, frameCount: 4, frameRate: 6, loop: true },
        down: { row: 1, frameCount: 6, frameRate: 12, loop: true },
        up: { row: 2, frameCount: 6, frameRate: 12, loop: true },
        side: { row: 3, frameCount: 6, frameRate: 12, loop: true },
        charge: { row: 4, frameCount: 4, frameRate: 10, loop: true },
        death: { row: 5, frameCount: 4, frameRate: 12, loop: false },
      }),
      guard: new SpriteSheet(guard, 20, 20, {
        idle: { row: 0, frameCount: 4, frameRate: 5, loop: true },
        walk_down: { row: 1, frameCount: 4, frameRate: 10, loop: true },
        walk_up: { row: 2, frameCount: 4, frameRate: 10, loop: true },
        walk_side: { row: 3, frameCount: 4, frameRate: 10, loop: true },
        fire: { row: 4, frameCount: 2, frameRate: 16, loop: false },
        drop: { row: 5, frameCount: 3, frameRate: 8, loop: false },
      }),
      enforcer: new SpriteSheet(enforcer, 32, 32, {
        idle: { row: 0, frameCount: 4, frameRate: 5, loop: true },
        walk_down: { row: 1, frameCount: 4, frameRate: 10, loop: true },
        walk_up: { row: 2, frameCount: 4, frameRate: 10, loop: true },
        walk_side: { row: 3, frameCount: 4, frameRate: 10, loop: true },
        fire: { row: 4, frameCount: 2, frameRate: 16, loop: false },
        drop: { row: 5, frameCount: 3, frameRate: 8, loop: false },
      }),
      chimera: new SpriteSheet(chimera, 28, 28, {
        idle: { row: 0, frameCount: 4, frameRate: 5, loop: true },
        walk_down: { row: 1, frameCount: 4, frameRate: 8, loop: true },
        walk_up: { row: 2, frameCount: 4, frameRate: 8, loop: true },
        walk_side: { row: 3, frameCount: 4, frameRate: 8, loop: true },
        telegraph: { row: 4, frameCount: 3, frameRate: 12, loop: true },
        lunge: { row: 5, frameCount: 2, frameRate: 16, loop: true },
        stun: { row: 6, frameCount: 2, frameRate: 5, loop: true },
      }),
    };
  }

  private drawSporeSprite(ctx: CanvasRenderingContext2D, world: World, _time: number): void {
    const spore = world.spore;
    const sheet = this.sheets?.spore;
    if (!sheet) return;
    // Only the side slither and the charge drill have a meaningful facing.
    const flip = spore.animation === "side"
      ? Math.cos(spore.visualAngle) < 0
      : spore.animation === "charge" && Math.cos(spore.aimAngle) < 0;
    const base = 2.1;
    // Squash and stretch pivot around the belly so the blob never floats.
    const anchor = 4 * base;
    ctx.save();
    ctx.translate(spore.position.x, spore.position.y);
    ctx.translate(0, anchor);
    ctx.rotate(spore.wobbleDisplacement * 0.08);
    ctx.scale(spore.deformX, spore.deformY);
    ctx.translate(0, -anchor);
    ctx.scale(base, base);
    sheet.draw(ctx, spore.animation, spore.animationTime, 0, 0, flip);
    ctx.restore();
  }

  private drawHostSprite(ctx: CanvasRenderingContext2D, host: Host, time: number): void {
    const sheet = host.kind === "mutant" ? this.sheets?.chimera : host.kind === "enforcer" ? this.sheets?.enforcer : this.sheets?.guard;
    if (!sheet) return;
    if (host.possessed) this.drawSprintTrail(ctx, host, sheet, time);
    const size = sheet.frameWidth;
    const scale = 2;
    const angle = host.renderAim;
    const left = Math.cos(angle) < 0;
    const bob = host.moving > 0.1 ? Math.sin(host.walkPhase * 2) * 1.5 : 0;
    const pitch = clamp(Math.atan2(Math.sin(angle), Math.abs(Math.cos(angle))), -0.55, 0.55) * (left ? -1 : 1);
    const rows = HOST_RIG_ROWS[host.kind];
    const anim = host.dropTime >= 0 && !host.alive ? (host.kind === "mutant" ? "stun" : "drop") : host.animation;
    // The lower body walks along its travel vector; only side rows mirror.
    const bodyFlip = anim === "walk_side" && host.bodyFlip;
    ctx.save();
    ctx.translate(host.position.x, host.position.y + bob);
    ctx.scale(scale, scale);
    sheet.draw(ctx, anim, host.dropTime >= 0 && !host.alive ? host.dropTime : host.animationTime, 0, 0, bodyFlip, host.flash > 0.45);
    ctx.restore();
    if (!host.alive) return;

    // The head, face and parasite share the neck pivot and pitch transform.
    const neckY = host.position.y - size * scale * 0.38 + bob + host.idleDip * scale;
    ctx.save(); ctx.translate(host.position.x, neckY); ctx.rotate(pitch);
    if (left) ctx.scale(-1, 1);
    ctx.drawImage(sheet.image, 0, size * rows.head, size, size, -size, -size, size * 2, size * 2);
    const eye = host.possessed ? "#00ff88" : host.kind === "security" ? "#00f5ff" : host.kind === "enforcer" ? "#ff4d00" : "#ffee00";
    ctx.fillStyle = eye;
    // Convert the desired world-space gaze offset into the pitched, flipped head's local space.
    const dx = Math.cos(angle) * 1.5, dy = Math.sin(angle) * 1.5;
    const gazeX = (dx * Math.cos(pitch) + dy * Math.sin(pitch)) * (left ? -1 : 1);
    const gazeY = -dx * Math.sin(pitch) + dy * Math.cos(pitch);
    if (host.kind === "mutant") {
      // Three ocular pits across the brow. Crop-and-shift gaze keeps them on the cursor.
      for (let i = 0; i < 3; i++) ctx.fillRect(size * (-0.1 + i * 0.2) + gazeX, -size * 0.3 + gazeY, Math.max(1, size * 0.08), Math.max(1, size * 0.08));
    } else {
      ctx.fillRect(-size * 0.2 + gazeX, -size * 0.2 + gazeY, size * 0.4, size * 0.1);
    }
    if (host.possessed && host.alive) {
      const spore = this.sheets?.spore;
      if (spore) {
        ctx.strokeStyle = "#00ff88"; ctx.lineWidth = 1.5 + Math.sin(time * 10) * 0.5;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(i * 3, -size * 0.55); ctx.quadraticCurveTo(i * 5 + Math.sin(time * 8 + i) * 2, -size * 0.25, i * 7, 3); ctx.stroke();
        }
        ctx.save(); ctx.translate(-4 + (host.decay < 3 ? Math.sin(time * 30) * 1.5 : 0), -size * 0.65);
        const sporeScale = host.decay < 3 ? 1.4 : 1;
        ctx.scale(sporeScale, sporeScale); spore.draw(ctx, "idle", time, 0, 0, false, host.decay < 3 && Math.sin(time * 15) > 0.4); ctx.restore();
      }
    }
    ctx.restore();

    // Weapon and bulwark follow the same angle used for shield and firing logic.
    ctx.save(); ctx.translate(host.position.x, host.position.y - 2 + bob + host.idleDip * scale); ctx.rotate(angle);
    ctx.translate(-host.recoil * 2, 0);
    ctx.drawImage(sheet.image, 0, size * rows.weapon, size, size, -size * 0.7, -size, size * 2, size * 2);
    if (host.kind !== "mutant" && host.muzzle > 0.05) {
      ctx.globalAlpha = Math.min(1, host.muzzle);
      ctx.fillStyle = "#ffb703"; ctx.fillRect(size * 1.1, -4, size * 0.35, 8);
      ctx.fillStyle = "#fff4c2"; ctx.fillRect(size * 1.1, -2, size * 0.2, 4);
      ctx.globalAlpha = 1;
    }
    if (host.kind === "enforcer") {
      const lab = this.assets.image("lab_props");
      if (lab) ctx.drawImage(lab, 72, 0, 24, 36, host.radius * 0.48, -host.radius * 1.15, 16, host.radius * 2.3);
    }
    ctx.restore();
    if (host.possessed && host.alive) this.drawStaminaBar(ctx, host, time);
    if (host.isTrainingDummy && host.alive) {
      ctx.save(); ctx.setLineDash([4, 6]); ctx.lineDashOffset = time * 12;
      ctx.strokeStyle = "rgba(230, 196, 85, 0.5)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(host.position.x, host.position.y, host.radius + 9, 0, TAU); ctx.stroke(); ctx.restore();
    }
  }

  private drawSlime(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    if (this.slimeLevel !== world.level || time < this.slimeTime) {
      this.slime = []; this.slimeClock = 0; this.slimeWasMoving = false; this.slimeLevel = world.level;
    }
    const dt = Math.min(0.1, Math.max(0, time - this.slimeTime));
    this.slimeTime = time;
    for (const drop of this.slime) drop.life -= dt;
    this.slime = this.slime.filter((drop) => drop.life > 0);
    const spore = world.spore;
    const moving = world.result === "alive" && spore.state === "free" && Math.hypot(spore.velocity.x, spore.velocity.y) > 1;
    const add = (x: number, y: number, radius: number, stretch: number, angle: number): void => {
      this.slime.push({ x, y, radius, maxLife: 0.7, life: 0.7, color: Math.random() < 0.5 ? "#00aa55" : "#00ff88", stretch, angle });
    };
    if (moving) {
      const len = Math.hypot(spore.velocity.x, spore.velocity.y);
      this.slimeDir = { x: spore.velocity.x / len, y: spore.velocity.y / len };
      this.slimeClock += dt;
      if (this.slimeClock >= 0.05) {
        this.slimeClock %= 0.05;
        add(spore.position.x, spore.position.y, 1.5 + Math.random() * 1.5, 1, 0);
      }
    } else {
      this.slimeClock = 0;
      if (this.slimeWasMoving && spore.state === "free") {
        const angle = Math.atan2(this.slimeDir.y, this.slimeDir.x);
        for (const offset of [4, 9]) add(spore.position.x - this.slimeDir.x * offset, spore.position.y - this.slimeDir.y * offset, 1.5, 2, angle);
      }
    }
    this.slimeWasMoving = moving;
    ctx.save();
    for (const drop of this.slime) {
      const fade = drop.life / drop.maxLife;
      ctx.globalAlpha = fade * 0.75; ctx.fillStyle = drop.color;
      ctx.beginPath(); ctx.ellipse(drop.x, drop.y, drop.radius * fade * drop.stretch, drop.radius * fade, drop.angle, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /** Cyan afterimages and white wind streaks behind a sprinting host. */
  private drawSprintTrail(
    ctx: CanvasRenderingContext2D,
    host: Host,
    sheet: SpriteSheet,
    time: number,
  ): void {
    const scale = 2;
    for (const ghost of host.afterimages) {
      const fade = clamp(ghost.life / 0.25, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.45 * fade;
      ctx.translate(ghost.x, ghost.y);
      ctx.save();
      ctx.scale(scale, scale);
      const track = ghost.walkDir === "down" ? "walk_down" : ghost.walkDir === "up" ? "walk_up" : "walk_side";
      sheet.draw(ctx, track, ghost.walkPhase, 0, 0, ghost.walkDir === "side" && Math.cos(ghost.facing) < 0);
      ctx.restore();
      // Bioluminescent tint over the ghost body.
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = rgba("#00E5FF", 0.35 * fade);
      ctx.beginPath();
      ctx.arc(0, 0, host.radius, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    if (!host.sprinting) return;
    // Thin white streaks trailing parallel to the movement vector.
    const dx = -host.slideDir.x;
    const dy = -host.slideDir.y;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      const offset = i * host.radius * 0.55;
      const px = -dy * offset;
      const py = dx * offset;
      const start = host.radius * 0.9 + ((time * 180 + i * 17) % 22);
      ctx.beginPath();
      ctx.moveTo(host.position.x + px + dx * start, host.position.y + py + dy * start);
      ctx.lineTo(host.position.x + px + dx * (start + host.radius * 1.6), host.position.y + py + dy * (start + host.radius * 1.6));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Flat stamina bar under the possessed host; hidden at 100%, shown below 99%. */
  private drawStaminaBar(ctx: CanvasRenderingContext2D, host: Host, time: number): void {
    const shown = host.currentStamina < 99 || host.isExhausted;
    const dt = Math.min(0.1, Math.max(0, time - this.staminaBarTime));
    this.staminaBarTime = time;
    // Instant on spend, eased away once the bar refills to full.
    this.staminaBarAlpha = shown
      ? 1
      : this.staminaBarAlpha - this.staminaBarAlpha * Math.min(1, dt * 8);
    if (this.staminaBarAlpha < 0.01) return;

    const ratio = clamp(host.currentStamina / host.maxStamina, 0, 1);
    const w = 50;
    const h = 6;
    const x = host.position.x - w / 2;
    const y = host.position.y + host.radius + 16;
    const flash = Math.sin(time * 18) > 0;
    const fill = host.isExhausted ? (flash ? "#FF0055" : "#8A8F98") : "#00E5FF";

    ctx.save();
    ctx.globalAlpha = this.staminaBarAlpha;
    // Dark container with a hairline border.
    ctx.fillStyle = "rgba(10, 15, 24, 0.85)";
    roundedRect(ctx, x, y, w, h, 2);
    ctx.fill();
    ctx.strokeStyle = "#1E293B";
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, w, h, 2);
    ctx.stroke();
    // Active fill sits inside the border so the frame reads at all fills.
    if (ratio > 0.001) {
      ctx.fillStyle = fill;
      roundedRect(ctx, x + 1, y + 1, (w - 2) * ratio, h - 2, 1);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSporeTrail(ctx: CanvasRenderingContext2D, world: World): void {
    const trail = world.spore.trail;
    if (trail.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const node of trail) {
      const alpha = clamp(node.life / 0.3, 0, 1);
      ctx.fillStyle = rgba(COLORS.spore, alpha * 0.35);
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Lighting and additive glows ---------------------------------------

  /** Darkness pass with cut-out lights, then composited over the world. */
  private drawLighting(world: World): void {
    const lc = this.lightCtx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "source-over";
    lc.globalAlpha = 1;
    lc.clearRect(0, 0, this.width, this.height);
    lc.fillStyle = "rgba(3, 6, 10, 0.32)";
    lc.fillRect(0, 0, this.width, this.height);

    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    world.camera.applyTransform(lc);
    lc.globalCompositeOperation = "destination-out";

    const punch = (x: number, y: number, radius: number, strength: number): void => {
      if (radius <= 1) return;
      lc.globalAlpha = strength;
      lc.drawImage(this.punchSprite, x - radius, y - radius, radius * 2, radius * 2);
    };

    if (world.spore.isExposed) {
      punch(world.spore.position.x, world.spore.position.y, 340, 0.95);
    }
    for (const host of world.hosts) {
      if (!host.alive) continue;
      punch(host.position.x, host.position.y, host.possessed ? 330 : 165, host.possessed ? 0.98 : 0.78);
      if (host.muzzle > 0.05) {
        punch(
          host.position.x + Math.cos(host.facing) * (host.radius + 22),
          host.position.y + Math.sin(host.facing) * (host.radius + 22),
          130 * host.muzzle,
          0.8,
        );
      }
    }
    for (const effect of world.effects) {
      punch(effect.position.x, effect.position.y, effect.radius * 1.7, 0.95 * (1 - effect.t));
    }
    for (const projectile of world.projectiles) {
      punch(projectile.position.x, projectile.position.y, 30, 0.35);
    }
    for (const target of world.targets) {
      if (target.alive) punch(target.position.x, target.position.y, 95, 0.3);
    }
    if (world.tutorial) {
      punch(world.tutorial.scanner.x, world.tutorial.scanner.y, 175, world.tutorial.phase === 0 ? 0.7 : 0.25);
      if (world.tutorial.portal.active) {
        punch(world.tutorial.portal.x, world.tutorial.portal.y, 250, 0.9);
      }
    }
    const locked = world.hijack.locked;
    if (locked) punch(locked.position.x, locked.position.y, 100, 0.55);

    lc.globalAlpha = 1;
    lc.restore();
    lc.globalCompositeOperation = "source-over";

    // The light map is screen-space; drop the world transform before compositing.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.drawImage(this.lightCanvas, 0, 0, this.width, this.height);
  }

  /** Additive neon: spore glow, muzzle sparks, acid pools and explosions. */
  private drawGlows(world: World, time: number): void {
    const ctx = this.ctx;
    this.applyCamera(world.camera);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    const glow = (x: number, y: number, radius: number, color: string, alpha: number): void => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    };

    if (world.spore.isExposed) {
      const spore = world.spore;
      const pulse = 1 + Math.sin(time * 4) * 0.1;
      glow(spore.position.x, spore.position.y, 110 * pulse, COLORS.spore, 0.24);
    }
    // Detonation charge: the held body swells and pulses red.
    if (world.hijack.detonating && world.possessed) {
      const body = world.possessed;
      const pulse = 0.6 + Math.sin(time * 18) * 0.4;
      glow(body.position.x, body.position.y, (body.radius + 36) * (1 + 0.12 * pulse), "#ff0055", 0.6 * pulse);
    }
    for (const host of world.hosts) {
      if (!host.alive) continue;
      if (host.possessed) {
        glow(host.position.x, host.position.y, host.radius * 3.4, COLORS.spore, 0.16);
      }
      if (host.muzzle > 0.05) {
        glow(
          host.position.x + Math.cos(host.facing) * (host.radius + 18),
          host.position.y + Math.sin(host.facing) * (host.radius + 18),
          90 * host.muzzle,
          "#ffd9a0",
          0.5 * host.muzzle,
        );
      }
      if (host.windup > 0 && host.aimLaser > 0) {
        const laser = host.kind === "mutant" ? COLORS.mutantLight : COLORS.warning;
        glow(host.position.x, host.position.y, host.radius * 2.4, laser, 0.16);
        ctx.globalAlpha = 1;
        if (host.kind === "mutant") {
          // Faint dashed lunge line: lock direction plus the full burst length,
          // capped with a landing bracket so the safe space is obvious.
          const reach = CHIMERA.dashDistance;
          const ex = host.position.x + Math.cos(host.facing) * reach;
          const ey = host.position.y + Math.sin(host.facing) * reach;
          ctx.save();
          ctx.setLineDash([9, 10]);
          ctx.strokeStyle = rgba(COLORS.mutantLight, 0.3 + Math.sin(time * 18) * 0.1);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(
            host.position.x + Math.cos(host.facing) * host.radius,
            host.position.y + Math.sin(host.facing) * host.radius,
          );
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = rgba(COLORS.mutantLight, 0.42);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ex, ey, 8, host.facing - 1.1, host.facing + 1.1);
          ctx.stroke();
          ctx.restore();
        } else {
          // Gun hosts keep the thin solid laser sight.
          ctx.strokeStyle = rgba(laser, 0.35 + Math.sin(time * 24) * 0.12);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(
            host.position.x + Math.cos(host.facing) * host.radius,
            host.position.y + Math.sin(host.facing) * host.radius,
          );
          ctx.lineTo(
            host.position.x + Math.cos(host.facing) * 460,
            host.position.y + Math.sin(host.facing) * 460,
          );
          ctx.stroke();
        }
      }
    }
    for (const effect of world.effects) {
      glow(
        effect.position.x,
        effect.position.y,
        effect.radius * (1 + effect.t * 0.5),
        effect.kind === "meltdown" ? "#ff5a3c" : COLORS.acid,
        0.32 * (1 - effect.t),
      );
    }
    for (const hazard of world.hazards) {
      glow(hazard.position.x, hazard.position.y, hazard.radius * 1.6, COLORS.acid, 0.08 * hazard.alpha);
    }
    for (const projectile of world.projectiles) {
      glow(projectile.position.x, projectile.position.y, 26, projectile.color, 0.28);
    }
    for (const target of world.targets) {
      if (target.alive) glow(target.position.x, target.position.y, 82, "#ffc94a", 0.12);
    }
    if (world.tutorial) {
      const tutorial = world.tutorial;
      glow(
        tutorial.scanner.x,
        tutorial.scanner.y,
        120,
        COLORS.spore,
        tutorial.phase === 0 ? 0.17 + Math.sin(time * 4) * 0.05 : 0.05,
      );
      if (tutorial.portal.active) {
        glow(tutorial.portal.x, tutorial.portal.y, 190, "#8dffca", 0.22 + Math.sin(time * 5) * 0.05);
      }
    }
    const locked = world.hijack.locked;
    if (locked) glow(locked.position.x, locked.position.y, 70, COLORS.spore, 0.2);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawWorldUi(world: World, time: number): void {
    const ctx = this.ctx;
    this.applyCamera(world.camera);
    const state = world.spore.state;

    if (state === "aiming" || state === "ejectAim" || world.hijack.detonating) {
      const from = state === "ejectAim" ? world.possessed?.position ?? world.spore.position : world.spore.position;
      const target = world.hijack.locked;
      drawAimCone(
        ctx,
        from,
        world.hijack.aimAngle,
        target ? target.position : null,
        time,
        AIM.cone,
        AIM.range,
        state === "ejectAim" ? "eject" : "leap",
      );
    }

    for (const whisper of world.whispers) {
      drawWhisper(ctx, whisper.text, whisper.x, whisper.y, whisper.life, whisper.maxLife);
    }
  }

  // --- Post and HUD -------------------------------------------------------

  /** Vignette, damage flash, bullet-time tint. Drawn beneath the HUD. */
  drawPost(world: World, time: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Bullet-time grade.
    if (world.timeScale < 1) {
      ctx.fillStyle = "rgba(18, 80, 96, 0.075)";
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Fixed edge vignette.
    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.28,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.7, "rgba(0,0,0,0.22)");
    vignette.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);

    // Meltdown warning vignette.
    const possessed = world.possessed;
    if (possessed && possessed.decay <= DECAY.warn) {
      const pressure = 1 - clamp(possessed.decay / DECAY.warn, 0, 1);
      const pulse = 0.55 + Math.sin(time * (10 + pressure * 14)) * 0.45;
      const radius = Math.max(this.width, this.height) * 0.72;
      const warning = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        radius * 0.32,
        this.width / 2,
        this.height / 2,
        radius,
      );
      warning.addColorStop(0, "rgba(255, 30, 40, 0)");
      warning.addColorStop(0.7, `rgba(255, 20, 30, ${0.14 + pressure * 0.2 * pulse})`);
      warning.addColorStop(1, `rgba(255, 10, 20, ${0.32 + pressure * 0.3 * pulse})`);
      ctx.fillStyle = warning;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Damage flash.
    if (world.damageFlash > 0.01) {
      ctx.fillStyle = `rgba(255, 30, 40, ${world.damageFlash * 0.16})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  drawHud(world: World, time: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.width;
    const h = this.height;
    const possessed = world.possessed;
    const tutorial = world.tutorial;
    const objective = world.tutorialPrompt;

    // --- Identity ---------------------------------------------------------
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // The radial lifespan dial owns the corner; identity sits beside it only
    // when the tutorial banner is not using that band.
    this.drawDecayDial(world, time);
    if (!objective) {
      ctx.font = FONT(16, 700);
      fillTextShadow(ctx, "PARASITIC FLESH", 184, 86, "#eafff3");
      ctx.font = FONT(11, 600);
      const subtitle = world.mode === "tutorial" ? "PROVING GROUND // INDUCTION" : `FLOOR ${world.dungeon?.run.label ?? "1-1"} // DNA ${world.dungeon?.run.biomass ?? 0}`;
      fillTextShadow(ctx, subtitle, 184, 104, "rgba(0, 255, 136, 0.62)");
    }

    // --- Objective count --------------------------------------------------
    let countLabel = "HOSTILES";
    let countValue = String(world.enemiesRemaining).padStart(2, "0");
    let countColor = "#ff5a5a";
    if (tutorial) {
      // The room counter is fixed top-right for the whole Proving Ground.
      countLabel = "CHAMBER";
      countValue = `${String(tutorial.phase + 1).padStart(2, "0")} / ${String(TUTORIAL_ROOMS.length).padStart(2, "0")}`;
      countColor = "#8dffca";
    }
    if (world.dungeon) drawMinimap(ctx, world.dungeon, w, time);
    else {
      ctx.textAlign = "right";
      ctx.font = FONT(27, 700);
      fillTextShadow(ctx, countValue, w - 24, 38, countColor);
      ctx.font = FONT(11, 700);
      fillTextShadow(ctx, countLabel, w - 24, 55, "rgba(200, 230, 220, 0.58)");
    }

    // --- Center status: grace, bullet-time --------------------------------
    // The tutorial banner sits top-centre, so status lines drop below it.
    let centerY = objective ? 140 : 31;
    if (world.grace > 0.05) {
      ctx.textAlign = "center";
      ctx.font = FONT(14, 700);
      fillTextShadow(ctx, `HOSTILES DORMANT // ${world.grace.toFixed(1)}s`, w / 2, centerY, "rgba(127, 233, 255, 0.9)");
      ctx.fillStyle = "rgba(127, 233, 255, 0.22)";
      ctx.fillRect(w / 2 - 82, centerY + 8, 164, 2);
      ctx.fillStyle = "rgba(127, 233, 255, 0.75)";
      ctx.fillRect(w / 2 - 82, centerY + 8, 164 * clamp(world.grace / SPAWN_GRACE, 0, 1), 2);
      centerY += 30;
    }
    if (world.timeScale < 1) {
      ctx.textAlign = "center";
      ctx.font = FONT(15, 700);
      fillTextShadow(ctx, "TIME DILATION  0.18x", w / 2, centerY, "rgba(127, 233, 255, 0.92)");
      ctx.fillStyle = "rgba(127, 233, 255, 0.24)";
      ctx.fillRect(w / 2 - 90, centerY + 8, 180, 2);
      ctx.fillStyle = "rgba(127, 233, 255, 0.9)";
      ctx.fillRect(w / 2 - 90, centerY + 8, 180 * clamp(world.timeScale, 0, 1), 2);
    }

    if (world.dungeon?.notice) {
      ctx.textAlign = "center"; ctx.font = FONT(20, 700);
      fillTextShadow(ctx, "CHAMBER SECURED", w / 2, 65, "#00ff88");
    }
    // --- Neural link calibration warning above the host
    if (possessed && possessed.calibrateFlash > 0) {
      const p = world.camera.worldToScreen(possessed.position);
      const remaining = Math.max(0, POSSESSION.switchLockout - possessed.possessedTime);
      ctx.save();
      ctx.globalAlpha = clamp(possessed.calibrateFlash / 1.2, 0, 1);
      ctx.textAlign = "center";
      ctx.font = FONT(13, 700);
      fillTextShadow(
        ctx,
        `NEURAL LINK CALIBRATING... [${remaining.toFixed(1)}s]`,
        p.x,
        p.y - possessed.radius - 30,
        "#ff9ab5",
      );
      ctx.restore();
    }

    // --- Tutorial chamber prompt -----------------------------------------
    if (objective) {
      // Pinned to the top centre, clear of the corner dial and room counter.
      this.drawTutorialPrompt(objective, w, 28);
    }

    // --- Body plate -------------------------------------------------------
    // The status blocks above intentionally change alignment; the plate is
    // always left-anchored so its labels cannot slide off the canvas.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const panelW = 300;
    const panelH = 84;
    const panelX = 22;
    const panelY = h - panelH - 22;
    const critical = Boolean(possessed && possessed.decay <= DECAY.warn);
    const pulse = 0.65 + Math.sin(time * 16) * 0.35;

    ctx.fillStyle = "rgba(4, 9, 11, 0.84)";
    roundedRect(ctx, panelX, panelY, panelW, panelH, 4);
    ctx.fill();
    ctx.strokeStyle = critical ? rgba(COLORS.warning, pulse) : "rgba(0, 255, 136, 0.24)";
    ctx.lineWidth = 1;
    roundedRect(ctx, panelX, panelY, panelW, panelH, 4);
    ctx.stroke();
    ctx.fillStyle = critical ? rgba(COLORS.warning, pulse) : "rgba(0, 255, 136, 0.55)";
    ctx.fillRect(panelX, panelY, 3, panelH);

    if (possessed) {
      // The radial timer lives top-left; this plate carries identity and loadout.
      ctx.font = FONT(16, 700);
      fillTextShadow(ctx, possessed.spec.name, panelX + 18, panelY + 30, "#eafff3");
      ctx.font = FONT(12, 600);
      const weapon =
        possessed.weapon.kind === "rifle" ? "ASSAULT RIFLE" : possessed.weapon.kind === "shotgun" ? "SHOTGUN" : "CLAWS";
      fillTextShadow(ctx, weapon, panelX + 18, panelY + 50, "rgba(0, 255, 136, 0.68)");

      let gx = panelX + 18;
      for (const graft of possessed.grafts) {
        const label = graft === "dorsalShield" ? "PLATING" : "STRIDE";
        ctx.font = FONT(9, 700);
        const chipW = ctx.measureText(label).width + 12;
        ctx.fillStyle = "rgba(0, 255, 136, 0.1)";
        roundedRect(ctx, gx, panelY + 58, chipW, 16, 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 255, 136, 0.35)";
        ctx.stroke();
        fillTextShadow(ctx, label, gx + 6, panelY + 70, "rgba(141, 255, 202, 0.85)");
        gx += chipW + 6;
      }

      if (critical) {
        ctx.textAlign = "right";
        ctx.font = FONT(11, 700);
        fillTextShadow(ctx, "COLLAPSE", panelX + panelW - 12, panelY + 20, rgba(COLORS.warning, pulse));
        ctx.textAlign = "left";
      }
    } else {
      ctx.font = FONT(12, 700);
      fillTextShadow(ctx, "SPORE // UNHOSTED", panelX + 18, panelY + 26, "rgba(200, 240, 222, 0.65)");
      ctx.font = FONT(11, 600);
      fillTextShadow(ctx, "UNARMED // EXPOSED", panelX + 18, panelY + 48, "rgba(200, 240, 222, 0.45)");
    }

    // --- Contextual hint --------------------------------------------------
    const hint = this.contextHint(world);
    if (hint) {
      ctx.textAlign = "center";
      ctx.font = FONT(16, 700);
      const textWidth = ctx.measureText(hint).width;
      const bx = w / 2 - textWidth / 2 - 18;
      const by = h - 46;
      ctx.fillStyle = "rgba(4, 9, 11, 0.76)";
      roundedRect(ctx, bx, by, textWidth + 36, 28, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 255, 136, 0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      fillTextShadow(ctx, hint, w / 2, by + 19, "rgba(141, 255, 202, 0.92)");
      ctx.textAlign = "left";
    }

    // --- Graft banner -----------------------------------------------------
    if (world.graftBanner) {
      const banner = world.graftBanner;
      const fade = Math.min(1, banner.life / 0.35) * Math.min(1, (banner.maxLife - banner.life) / 0.2);
      ctx.save();
      ctx.globalAlpha = clamp(fade, 0, 1);
      const text = `GRAFT ACQUIRED // ${banner.text}`;
      ctx.font = FONT(15, 700);
      const detailWidth = (() => {
        ctx.font = FONT(11, 600);
        return ctx.measureText(banner.detail).width;
      })();
      ctx.font = FONT(15, 700);
      const width = Math.max(ctx.measureText(text).width, detailWidth);
      const bx = w / 2 - width / 2 - 18;
      const by = objective ? 272 : world.timeScale < 1 ? 100 : 80;
      ctx.fillStyle = "rgba(4, 14, 10, 0.9)";
      roundedRect(ctx, bx, by, width + 36, 50, 3);
      ctx.fill();
      ctx.strokeStyle = rgba(COLORS.spore, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.font = FONT(15, 700);
      fillTextShadow(ctx, text, w / 2, by + 21, COLORS.spore);
      ctx.font = FONT(11, 600);
      fillTextShadow(ctx, banner.detail, w / 2, by + 39, "rgba(200, 255, 230, 0.62)");
      ctx.restore();
      ctx.textAlign = "left";
    }

    // Outgoing fire marker.
    if (world.hitMarker > 0.02) {
      const mx = world.input.mouse.x;
      const my = world.input.mouse.y;
      ctx.strokeStyle = `rgba(255,255,255,${world.hitMarker * 0.8})`;
      ctx.lineWidth = 1.6;
      const d = 5;
      ctx.beginPath();
      ctx.moveTo(mx - d, my - d);
      ctx.lineTo(mx - d - 4, my - d - 4);
      ctx.moveTo(mx + d, my + d);
      ctx.lineTo(mx + d + 4, my + d + 4);
      ctx.moveTo(mx - d, my + d);
      ctx.lineTo(mx - d - 4, my + d + 4);
      ctx.moveTo(mx + d, my - d);
      ctx.lineTo(mx + d + 4, my - d - 4);
      ctx.stroke();
    }
    if (world.dungeon?.draft || world.tutorial?.draft) this.drawMutationDraft(w, h);
    if (world.dungeon && world.dungeon.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, world.dungeon.fade / 0.4)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  /**
   * Top-left radial lifespan gauge. Fixed geometry and a handful of arcs per
   * frame: no layout measurement, no allocation, cheap at 60 FPS.
   */
  private drawDecayDial(world: World, time: number): void {
    const ctx = this.ctx;
    const cx = 88;
    const cy = 88;
    const radius = 75;
    const host = world.possessed;

    const breathing = 0.82 + Math.sin(time * 3) * 0.12;
    const fraction = host ? clamp(host.decayFraction, 0, 1) : 1;
    // Crimson when the clock is thin, amber under half, toxic green above.
    // Crimson pulse under 3 seconds, amber under half, toxic green above.
    const critical = Boolean(host && host.decay < 3);
    const color = critical ? "#ff0055" : host && fraction <= 0.5 ? "#ffcc00" : "#00ff88";
    const label = host
      ? host.kind === "security"
        ? "SECURITY // DECAY"
        : host.kind === "enforcer"
          ? "ENFORCER // DECAY"
          : "MUTANT // DECAY"
      : "SPORE // UNHOSTED";
    const value = host ? `${String(Math.max(0, Math.ceil(host.decay))).padStart(2, "0")}s` : "1 HP";

    const beat = 0.72 + Math.sin(time * 10) * 0.28;
    const ringR = radius + (host ? 0 : Math.sin(time * 2.2) * 1.4);
    const alpha = critical ? beat : host ? 1 : breathing;

    ctx.save();
    ctx.translate(cx, cy);
    if (critical) {
      const scale = 1 + Math.sin(time * 10) * 0.035;
      ctx.scale(scale, scale);
    }

    ctx.fillStyle = "rgba(4, 9, 11, 0.8)";
    ctx.beginPath();
    ctx.arc(0, 0, radius + 9, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, TAU);
    ctx.stroke();

    // Active arc: clockwise from twelve o'clock, proportional to lifespan.
    ctx.strokeStyle = rgba(color, clamp(alpha, 0, 1));
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * fraction);
    ctx.stroke();
    ctx.lineCap = "butt";

    // Instrument ticks every 30 degrees.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i += 1) {
      const angle = -Math.PI / 2 + (i / 12) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * (ringR - 6), Math.sin(angle) * (ringR - 6));
      ctx.lineTo(Math.cos(angle) * (ringR + 2), Math.sin(angle) * (ringR + 2));
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = FONT(46, 700);
    fillTextShadow(ctx, value, 0, -6, critical ? "#ff9ab5" : "#effff7", 2);
    // Sub-badge stays inside the ring so the numerals own the centre.
    ctx.font = FONT(12, 700);
    fillTextShadow(ctx, host ? "DECAY" : "FRAGILE", 0, 27, rgba(color, 0.9), 1);
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT(10, 700);
    fillTextShadow(ctx, label, cx, cy + radius + 24, rgba(color, critical ? alpha : 0.85));

    // Detonation charge cells: lit cells are charges, the dim cell fills as it recharges.
    const pipW = 36;
    const pipH = 10;
    const pipGap = 6;
    const pipTotal = POSSESSION.maxCharges * pipW + (POSSESSION.maxCharges - 1) * pipGap;
    const pipY = cy + radius + 36;
    const pipColor = critical ? "#ff0055" : "#00ff88";
    const charges = world.hijack.charges;
    for (let i = 0; i < POSSESSION.maxCharges; i += 1) {
      const px = cx - pipTotal / 2 + i * (pipW + pipGap);
      const lit = i < charges;
      ctx.fillStyle = "rgba(4, 9, 11, 0.9)";
      roundedRect(ctx, px, pipY, pipW, pipH, 2);
      ctx.fill();
      if (lit) {
        ctx.save();
        ctx.shadowColor = pipColor;
        ctx.shadowBlur = 12;
        ctx.fillStyle = pipColor;
        roundedRect(ctx, px + 1, pipY + 1, pipW - 2, pipH - 2, 1.5);
        ctx.fill();
        ctx.restore();
      } else if (i === charges) {
        const fill = world.hijack.rechargeFraction;
        ctx.fillStyle = rgba(pipColor, 0.55);
        roundedRect(ctx, px + 1, pipY + 1, (pipW - 2) * fill, pipH - 2, 1.5);
        ctx.fill();
      }
      ctx.strokeStyle = lit ? pipColor : "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = 1;
      roundedRect(ctx, px, pipY, pipW, pipH, 2);
      ctx.stroke();
    }

    // Bio-shield pip: consumed by the first absorbed hit.
    if (host && host.bioShield > 0) {
      ctx.font = FONT(8, 700);
      fillTextShadow(ctx, "BIO-SHIELD READY", cx, cy + radius + 58, "rgba(190, 255, 225, 0.8)");
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  /**
   * Top-centre instruction card. Its width is bounded by the 150px lifespan
   * dial on the left and the room counter on the right, so every line stays
   * inside the safe band even on a small window.
   */
  private drawTutorialPrompt(objective: TutorialObjective, width: number, y: number): void {
    const ctx = this.ctx;
    const panelW = Math.min(760, Math.max(200, width - 380));
    const panelH = 86;
    const x = Math.round((width - panelW) / 2);
    ctx.save();
    ctx.globalAlpha = objective.alpha;

    ctx.fillStyle = "rgba(10, 15, 24, 0.9)";
    roundedRect(ctx, x, y, panelW, panelH, 4);
    ctx.fill();
    ctx.strokeStyle = "#00FF88";
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, panelW, panelH, 4);
    ctx.stroke();
    ctx.fillStyle = "#00FF88";
    ctx.fillRect(x, y, 3, panelH);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT(12, 700);
    fillTextShadow(
      ctx,
      `CHAMBER ${String(objective.chamber).padStart(2, "0")} // ${objective.title}`,
      x + 20,
      y + 22,
      "rgba(0, 255, 136, 0.92)",
    );

    // Instruction copy is 16px bold; it only shrinks if the line would overflow.
    let promptSize = 16;
    ctx.font = FONT(promptSize, 700);
    while (ctx.measureText(objective.prompt).width > panelW - 40 && promptSize > 10) {
      promptSize -= 1;
      ctx.font = FONT(promptSize, 700);
    }
    fillTextShadow(ctx, objective.prompt, x + 20, y + 48, "#ffffff");

    ctx.font = FONT(13, 600);
    fillTextShadow(ctx, `▸ ${objective.objective}`, x + 20, y + 70, "rgba(255, 201, 74, 0.92)");

    // Five-segment chamber progress.
    const segments = TUTORIAL_ROOMS.length;
    const segY = y + panelH - 8;
    for (let i = 0; i < segments; i += 1) {
      const sx = x + panelW - 20 - (segments - i) * 14;
      ctx.fillStyle = i < objective.chamber - 1
        ? "rgba(0, 255, 136, 0.32)"
        : i === objective.chamber - 1
          ? "rgba(0, 255, 136, 0.95)"
          : "rgba(255, 255, 255, 0.08)";
      ctx.fillRect(sx, segY, 10, 3);
    }

    ctx.restore();
    ctx.textAlign = "left";
  }

  private contextHint(world: World): string {
    switch (world.spore.state) {
      case "aiming":
        return world.hijack.locked ? "RELEASE RMB // INHABIT" : "MOVE THE CONE ONTO A HOST";
      case "ejectAim":
        return world.hijack.locked ? "RELEASE RMB // LEAP TO HOST" : "RELEASE RMB // CANCEL";
      case "hosted":
        return world.hijack.detonating
          ? "RELEASE R // DETONATE"
          : "LMB // FIRE   HOLD R // DETONATE   RMB / SPACE // LEAP   SHIFT // SPRINT";
      case "flying":
        return "IN TRANSIT";
      default:
        return "WASD // MOVE      HOLD RMB // SLOW TIME";
    }
  }

  /** Screen-space crosshair at the raw hardware cursor. Never camera-smoothed. */
  drawCursor(input: Input, mode: "aim" | "ui" = "aim"): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { x, y } = input.mouse;
    ctx.save();
    if (mode === "ui") {
      ctx.fillStyle = "#e8fff3";
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 255, 136, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, TAU);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(0, 255, 136, 0.85)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0, 255, 136, 0.55)";
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x + dx * 11, y + dy * 11);
        ctx.lineTo(x + dx * 16, y + dy * 16);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0, 255, 136, 0.9)";
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** CRT scanline pass, drawn after every UI layer. */
  drawScanlines(): void {
    if (!this.scanPattern) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.scanPattern;
    ctx.fillRect(0, 0, this.width, this.height);
  }
}

function inView(view: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number, pad: number): boolean {
  return x + pad >= view.minX && x - pad <= view.maxX && y + pad >= view.minY && y - pad <= view.maxY;
}
