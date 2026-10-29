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
  /** Fixed CSS-pixel world scale; HUD rendering is independent of this transform. */
  zoom = 1.5;
  angle = 0;
  width = 1280;
  height = 720;
  trauma = 0;

  private shakeX = 0;
  private shakeY = 0;
  private time = 0;
  private focusX = ARENA.width / 2;
  private focusY = ARENA.height / 2;
  /** Optional camera limit; the tutorial pins this to the active chamber. */
  private bounds: { x: number; y: number; w: number; h: number } | null = null;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.clampToArena();
  }

  /** Tighten the camera for enclosed levels; the sector keeps the wide read. */
  setViewSize(_worldWidth: number, _worldHeight: number): void {
    // The requested fixed zoom is independent of room and viewport dimensions.
    this.clampToArena();
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

  /**
   * Place the frame immediately, without clearing shake. The room-locked
   * tutorial camera hands the view to the next chamber by calling this with a
   * panned centre every frame, so the hand-off is exact rather than asymptotic.
   */
  setCenter(target: Vec2): void {
    this.focusX = target.x;
    this.focusY = target.y;
    this.x = target.x;
    this.y = target.y;
    this.clampToArena();
  }

  /** Confine the view to a rectangle; null restores the whole-arena limit. */
  setBounds(bounds: { x: number; y: number; w: number; h: number } | null): void {
    this.bounds = bounds;
    this.clampToArena();
  }

  /** `focus` null freezes the follow target (rooms pin the camera themselves). */
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
    const b = this.bounds ?? { x: 0, y: 0, w: ARENA.width, h: ARENA.height };
    this.x = halfW * 2 >= b.w ? b.x + b.w / 2 : clamp(this.x, b.x + halfW, b.x + b.w - halfW);
    this.y = halfH * 2 >= b.h ? b.y + b.h / 2 : clamp(this.y, b.y + halfH, b.y + b.h - halfH);
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
