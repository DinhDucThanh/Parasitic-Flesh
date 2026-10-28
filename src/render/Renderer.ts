import type { AssetManager } from "../assets/AssetManager";
import { AIM, CHIMERA, COLORS, DECAY, POSSESSION, SPAWN_GRACE } from "../core/config";
import { FONT, fillTextShadow } from "../core/fonts";
import type { Camera } from "../core/Camera";
import type { Input } from "../core/Input";
import { TAU, clamp } from "../core/math";
import type { Host } from "../entities/Host";
import type { World } from "../world/World";
import { TUTORIAL_ROOMS, type Door, type TutorialObjective } from "../world/Tutorial";
import {
  drawAimCone,
  drawExplosion,
  drawHazard,
  drawHost,
  drawHostStatus,
  drawParticle,
  drawProjectile,
  drawSpore,
  drawTarget,
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

    world.decals.draw(ctx);
    this.drawTutorialFloor(world, time);
    this.drawArchitecture(world);

    for (const hazard of world.hazards) drawHazard(ctx, hazard);

    for (const particle of world.particles) {
      if (inView(view, particle.position.x, particle.position.y, particle.size + 4)) {
        drawParticle(ctx, particle);
      }
    }

    for (const target of world.targets) {
      if (inView(view, target.position.x, target.position.y, 60)) drawTarget(ctx, target, time);
    }

    const hosts = world.hosts.filter((host) => host.alive).sort((a, b) => a.position.y - b.position.y);
    for (const host of hosts) {
      if (!inView(view, host.position.x, host.position.y, host.radius * 3)) continue;
      this.drawHostSprite(ctx, host, time);
    }

    if (world.spore.isExposed && inView(view, world.spore.position.x, world.spore.position.y, 80)) {
      this.drawSporeTrail(ctx, world);
      this.drawSporeSprite(ctx, world, time);
    }

    for (const projectile of world.projectiles) {
      if (inView(view, projectile.position.x, projectile.position.y, 30)) drawProjectile(ctx, projectile);
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
      ctx.fillText(String(index + 1).padStart(2, "0"), x, 930);
    });
    ctx.restore();

    // Live wall conduits: lethal to the naked spore in chamber one.
    for (const conduit of tutorial.conduits) {
      const charge = tutorial.phase === 0 ? 0.5 + Math.sin(time * 8) * 0.28 : 0.16;
      ctx.save();
      ctx.fillStyle = `rgba(255, 60, 70, ${charge * 0.3})`;
      ctx.fillRect(conduit.x, conduit.y, conduit.w, conduit.h);
      ctx.strokeStyle = `rgba(255, 96, 96, ${charge})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(conduit.x, conduit.y, conduit.w, conduit.h);
      ctx.strokeStyle = `rgba(255, 192, 192, ${charge * 0.45})`;
      ctx.lineWidth = 1;
      for (let y = conduit.y + 10; y < conduit.y + conduit.h; y += 24) {
        ctx.beginPath();
        ctx.moveTo(conduit.x + 3, y);
        ctx.lineTo(conduit.x + conduit.w - 3, y);
        ctx.stroke();
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

    // Exit portal.
    const portal = tutorial.portal;
    ctx.save();
    ctx.translate(portal.x, portal.y);
    ctx.strokeStyle = portal.active
      ? `rgba(141, 255, 202, ${0.65 + Math.sin(time * 5) * 0.2})`
      : "rgba(110, 140, 150, 0.2)";
    ctx.lineWidth = portal.active ? 2.4 : 1.4;
    for (let i = 0; i < 3; i += 1) {
      const width = portal.radius * (0.5 + i * 0.22);
      const height = portal.radius * (1.15 + i * 0.18);
      ctx.beginPath();
      ctx.ellipse(0, 0, width, height, 0, 0, TAU);
      ctx.stroke();
    }
    if (portal.active) {
      const core = ctx.createLinearGradient(0, -portal.radius, 0, portal.radius);
      core.addColorStop(0, "rgba(141, 255, 202, 0.02)");
      core.addColorStop(0.5, "rgba(141, 255, 202, 0.26)");
      core.addColorStop(1, "rgba(141, 255, 202, 0.02)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.ellipse(0, 0, portal.radius * 0.55, portal.radius * 1.2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawArchitecture(world: World): void {
    if (world.walls.length === 0 && world.doors.length === 0) return;
    const ctx = this.ctx;

    for (const wall of world.walls) {
      ctx.fillStyle = "#10161d";
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.fillStyle = "#202b36";
      ctx.fillRect(wall.x, wall.y, wall.w, 4);
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(wall.x, wall.y + wall.h - 3, wall.w, 3);
      ctx.strokeStyle = "rgba(120, 160, 180, 0.13)";
      ctx.lineWidth = 1;
      ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);

      // Sparse rivets.
      ctx.fillStyle = "rgba(140, 170, 185, 0.22)";
      if (wall.w > wall.h) {
        for (let x = wall.x + 14; x < wall.x + wall.w - 8; x += 58) {
          ctx.beginPath();
          ctx.arc(x, wall.y + wall.h * 0.5, 1.6, 0, TAU);
          ctx.fill();
        }
      } else {
        for (let y = wall.y + 14; y < wall.y + wall.h - 8; y += 58) {
          ctx.beginPath();
          ctx.arc(wall.x + wall.w * 0.5, y, 1.6, 0, TAU);
          ctx.fill();
        }
      }

      // Hazard lip on the room-facing edge.
      ctx.fillStyle = "rgba(216, 169, 29, 0.24)";
      if (wall.w > wall.h) ctx.fillRect(wall.x, wall.y + wall.h - 5, wall.w, 1);
      else ctx.fillRect(wall.x + wall.w - 5, wall.y, 1, wall.h);
    }

    for (const door of world.doors) this.drawDoor(door);
  }

  private drawDoor(door: Door): void {
    const ctx = this.ctx;
    const { x, y, w, h } = door;
    const reinforced = door.kind === "reinforced";

    // Frame only: the opening itself must stay transparent so an open door
    // reads as a gap rather than a dark slab.
    ctx.fillStyle = "#070b0f";
    ctx.fillRect(x - 5, y - 5, w + 10, 5);
    ctx.fillRect(x - 5, y + h, w + 10, 5);
    ctx.fillRect(x - 5, y - 5, 5, h + 10);
    ctx.fillRect(x + w, y - 5, 5, h + 10);

    if (door.destroyed) {
      ctx.fillStyle = "#2a1b1b";
      ctx.fillRect(x, y, w, 16);
      ctx.fillRect(x, y + h - 16, w, 16);
      ctx.fillStyle = "rgba(255, 90, 60, 0.35)";
      ctx.fillRect(x, y + 16, w, 2);
      ctx.fillRect(x, y + h - 18, w, 2);
      return;
    }

    const half = h / 2;
    const topHeight = half * (1 - door.open);
    const bottomHeight = half * (1 - door.open);

    // Retracting panels slide up/down into the partition.
    ctx.fillStyle = reinforced ? "#3b2424" : "#232d37";
    ctx.fillRect(x, y, w, topHeight);
    ctx.fillRect(x, y + h - bottomHeight, w, bottomHeight);
    ctx.fillStyle = reinforced ? "#5a3230" : "#303d48";
    ctx.fillRect(x + 3, y, w - 6, Math.max(0, topHeight - 3));
    ctx.fillRect(x + 3, y + h - bottomHeight, w - 6, Math.max(0, bottomHeight - 3));

    // Bright inner seam.
    if (topHeight > 1) {
      ctx.fillStyle = reinforced ? "rgba(255, 90, 60, 0.7)" : "rgba(216, 169, 29, 0.7)";
      ctx.fillRect(x, y + topHeight - 2, w, 2);
    }
    if (bottomHeight > 1) {
      ctx.fillStyle = reinforced ? "rgba(255, 90, 60, 0.7)" : "rgba(216, 169, 29, 0.7)";
      ctx.fillRect(x, y + h - bottomHeight, w, 2);
    }

    // Frame rails.
    ctx.fillStyle = "#0d1318";
    ctx.fillRect(x - 3, y - 5, 3, h + 10);
    ctx.fillRect(x + w, y - 5, 3, h + 10);

    const status = door.open > 0.7 ? "#00ff88" : reinforced ? "#ff3d3d" : "#e6c455";
    ctx.fillStyle = status;
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.5, 2.6, 0, TAU);
    ctx.fill();

    if (reinforced) {
      ctx.fillStyle = "rgba(255, 90, 60, 0.35)";
      for (const oy of [0.18, 0.38, 0.62, 0.82]) {
        ctx.fillRect(x + 3, y + h * oy, w - 6, 2);
      }
      ctx.strokeStyle = "rgba(255, 190, 100, 0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 4.5, y + 4.5, w - 9, h - 9);
    }
  }

  // --- Entities -----------------------------------------------------------

  private drawSporeSprite(ctx: CanvasRenderingContext2D, world: World, time: number): void {
    const spore = world.spore;
    const image = this.assets.image("spore");
    if (!image) {
      drawSpore(ctx, spore, time);
      return;
    }
    const size = spore.radius * 5;
    ctx.save();
    ctx.translate(spore.position.x, spore.position.y);
    ctx.rotate(time * 0.7);
    ctx.drawImage(image, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  private drawHostSprite(ctx: CanvasRenderingContext2D, host: Host, time: number): void {
    const key =
      host.kind === "security" ? "host_security" : host.kind === "enforcer" ? "host_enforcer" : "host_mutant";
    const image = this.assets.image(key);
    if (host.possessed) this.drawSprintTrail(ctx, host, image, time);
    if (!image) {
      drawHost(ctx, host, time);
    } else {
      const size = host.radius * 4.4;
      ctx.save();
      ctx.translate(host.position.x, host.position.y);
      ctx.rotate(host.facing);
      ctx.drawImage(image, -size / 2, -size / 2, size, size);
      ctx.restore();
      if (host.possessed) {
        ctx.save();
        ctx.translate(host.position.x, host.position.y);
        ctx.strokeStyle = rgba(COLORS.spore, 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, host.radius + 9, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (host.possessed) this.drawStaminaBar(ctx, host, time);

    if (host.isTrainingDummy && host.alive) {
      ctx.save();
      ctx.translate(host.position.x, host.position.y);
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = time * 12;
      ctx.strokeStyle = "rgba(230, 196, 85, 0.5)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, host.radius + 9, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /** Cyan afterimages and white wind streaks behind a sprinting host. */
  private drawSprintTrail(
    ctx: CanvasRenderingContext2D,
    host: Host,
    image: CanvasImageSource | undefined,
    time: number,
  ): void {
    const size = host.radius * 4.4;
    for (const ghost of host.afterimages) {
      const fade = clamp(ghost.life / 0.25, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.45 * fade;
      ctx.translate(ghost.x, ghost.y);
      ctx.rotate(ghost.facing);
      if (image) {
        ctx.drawImage(image, -size / 2, -size / 2, size, size);
      }
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

    for (const host of world.hosts) {
      if (host.alive && host.possessed) drawHostStatus(ctx, host, time);
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
      const subtitle = world.mode === "tutorial" ? "PROVING GROUND // INDUCTION" : "SECTOR 4 // LIVE CONTAINMENT";
      fillTextShadow(ctx, subtitle, 184, 104, "rgba(0, 255, 136, 0.62)");
    }

    // --- Objective count --------------------------------------------------
    let countLabel = "HOSTILES";
    let countValue = String(world.enemiesRemaining).padStart(2, "0");
    let countColor = "#ff5a5a";
    if (tutorial) {
      if (tutorial.phase === 2) {
        countLabel = "TARGETS";
        countValue = String(world.targetsRemaining).padStart(2, "0");
        countColor = "#ffc94a";
      } else if (tutorial.phase === 4) {
        countLabel = "HOSTILES";
        countValue = String(world.enemiesRemaining).padStart(2, "0");
        countColor = "#ff5a5a";
      } else {
        countLabel = "CHAMBER";
        countValue = `${String(tutorial.phase + 1).padStart(2, "0")} / 07`;
        countColor = "#8dffca";
      }
    }
    ctx.textAlign = "right";
    ctx.font = FONT(27, 700);
    fillTextShadow(ctx, countValue, w - 24, 38, countColor);
    ctx.font = FONT(11, 700);
    fillTextShadow(ctx, countLabel, w - 24, 55, "rgba(200, 230, 220, 0.58)");

    // --- Center status: grace, bullet-time --------------------------------
    // The tutorial banner sits top-centre, so status lines drop below it.
    let centerY = objective ? 122 : 31;
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
      // The corner dial is always visible, so the chamber banner starts below it.
      this.drawTutorialPrompt(objective, w, 24);
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
        const label = graft === "sidearm" ? "SIDEARM" : graft === "dorsalShield" ? "PLATING" : "STRIDE";
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

  private drawTutorialPrompt(objective: TutorialObjective, width: number, y: number): void {
    const ctx = this.ctx;
    // The 150px corner dial and the right-hand level counter both stay clear.
    const panelW = Math.max(240, Math.min(760, width - 368));
    const panelH = 86;
    // Centred, but never under the gauge on narrow windows.
    const x = Math.max(184, (width - panelW) / 2);
    ctx.save();
    ctx.globalAlpha = objective.alpha;

    ctx.fillStyle = "rgba(10, 15, 24, 0.85)";
    roundedRect(ctx, x, y, panelW, panelH, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 255, 136, 0.9)";
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

    // Seven-segment chamber progress.
    const segY = y + panelH - 8;
    for (let i = 0; i < 7; i += 1) {
      const sx = x + panelW - 20 - (7 - i) * 14;
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
