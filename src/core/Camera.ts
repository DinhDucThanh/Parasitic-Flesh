import { ARENA, CAMERA, SETTINGS } from "./config";
import { clamp, smoothing, type Vec2 } from "./math";

/**
 * Follow camera with trauma-based screen shake.
 *
 * References:
 *  - Game feel / trauma shake: Squirrel Eiserloh, "Juicing Your Cameras With Math".
 *
 * World drawing uses `applyTransform`; conversion helpers give the exact inverse
 * (including shake rotation) so the mouse-to-world aim stays accurate mid-shake.
 */
export class Camera {
  x = ARENA.width / 2;
  y = ARENA.height / 2;
  zoom = 1;
  angle = 0;
  width = 1280;
  height = 720;
  trauma = 0;
  private viewW = 1560;
  private viewH = 880;

  private shakeX = 0;
  private shakeY = 0;
  private time = 0;
  private focusX = ARENA.width / 2;
  private focusY = ARENA.height / 2;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.recomputeZoom();
  }

  /** Tighten the camera for enclosed levels; the sector keeps the wide read. */
  setViewSize(worldWidth: number, worldHeight: number): void {
    this.viewW = worldWidth;
    this.viewH = worldHeight;
    this.recomputeZoom();
  }

  private recomputeZoom(): void {
    this.zoom = clamp(Math.min(this.width / this.viewW, this.height / this.viewH), 0.55, 2.2);
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, CAMERA.maxTrauma);
  }

  /** Jump straight to the target (used on spawn/restart to avoid a swoop). */
  snapTo(target: Vec2): void {
    this.focusX = target.x;
    this.focusY = target.y;
    this.x = target.x;
    this.y = target.y;
    this.trauma = 0;
    this.clampToArena();
  }

  update(dt: number, focus: Vec2 | null): void {
    this.time += dt;

    if (focus) {
      const t = smoothing(CAMERA.follow, dt);
      this.focusX += (focus.x - this.focusX) * t;
      this.focusY += (focus.y - this.focusY) * t;
    }

    this.trauma = Math.max(0, this.trauma - CAMERA.traumaDecay * dt);

    const shake = SETTINGS.screenShake ? this.trauma * this.trauma : 0;
    const t = this.time * 26;
    // Layered sines read as smooth, organic noise instead of per-frame jitter.
    this.shakeX = shake * 17 * (Math.sin(t * 1.71) * 0.6 + Math.sin(t * 3.13 + 1.7) * 0.4);
    this.shakeY = shake * 17 * (Math.cos(t * 1.93 + 0.4) * 0.6 + Math.sin(t * 2.71 + 2.2) * 0.4);
    this.angle = shake * 0.035 * Math.sin(t * 1.27 + 0.9);

    this.x = this.focusX;
    this.y = this.focusY;
    this.clampToArena();
  }

  private clampToArena(): void {
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    this.x = halfW * 2 >= ARENA.width ? ARENA.width / 2 : clamp(this.x, halfW, ARENA.width - halfW);
    this.y = halfH * 2 >= ARENA.height ? ARENA.height / 2 : clamp(this.y, halfH, ARENA.height - halfH);
  }

  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.width / 2 + this.shakeX, this.height / 2 + this.shakeY);
    ctx.rotate(this.angle);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  screenToWorld(p: Vec2): Vec2 {
    const dx = (p.x - this.width / 2 - this.shakeX) / this.zoom;
    const dy = (p.y - this.height / 2 - this.shakeY) / this.zoom;
    const cos = Math.cos(-this.angle);
    const sin = Math.sin(-this.angle);
    return {
      x: dx * cos - dy * sin + this.x,
      y: dx * sin + dy * cos + this.y,
    };
  }

  worldToScreen(p: Vec2): Vec2 {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    return {
      x: (dx * cos - dy * sin) * this.zoom + this.width / 2 + this.shakeX,
      y: (dx * sin + dy * cos) * this.zoom + this.height / 2 + this.shakeY,
    };
  }

  /** World-space bounds of the visible viewport, inflated for culling safety. */
  get view(): { minX: number; minY: number; maxX: number; maxY: number } {
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    // Rotation + shake can reveal a little past the axis-aligned box.
    const pad = 90;
    return {
      minX: this.x - halfW - pad,
      minY: this.y - halfH - pad,
      maxX: this.x + halfW + pad,
      maxY: this.y + halfH + pad,
    };
  }
}
