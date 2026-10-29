import type { Rect } from "../core/arena";
import type { Door } from "../world/Tutorial";

interface View { minX: number; minY: number; maxX: number; maxY: number }
const SIZE = 16;

/** Draw only visible world cells; collision geometry remains owned by the level. */
export class Tilemap {
  private readonly chunks = new Map<string, HTMLCanvasElement>();

  constructor(private readonly image: HTMLImageElement) {}

  private tile(ctx: CanvasRenderingContext2D, column: number, row: number, x: number, y: number, w = SIZE, h = SIZE): void {
    ctx.drawImage(this.image, column * SIZE, row * SIZE, SIZE, SIZE, x, y, w, h);
  }

  ground(ctx: CanvasRenderingContext2D, view: View, width: number, height: number): void {
    const chunkSize = 256;
    const minX = Math.max(0, Math.floor(view.minX / chunkSize));
    const minY = Math.max(0, Math.floor(view.minY / chunkSize));
    const maxX = Math.min(Math.ceil(width / chunkSize), Math.ceil(view.maxX / chunkSize));
    const maxY = Math.min(Math.ceil(height / chunkSize), Math.ceil(view.maxY / chunkSize));
    for (let cy = minY; cy < maxY; cy++) for (let cx = minX; cx < maxX; cx++) {
      const key = `${cx},${cy}`;
      let chunk = this.chunks.get(key);
      if (!chunk) {
        chunk = document.createElement("canvas");
        chunk.width = chunkSize; chunk.height = chunkSize;
        const off = chunk.getContext("2d");
        if (!off) continue;
        off.imageSmoothingEnabled = false;
        for (let y = 0; y < chunkSize / SIZE; y++) for (let x = 0; x < chunkSize / SIZE; x++) {
          const gx = cx * (chunkSize / SIZE) + x, gy = cy * (chunkSize / SIZE) + y;
          const hash = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
          const variant = hash % 97 === 0 ? 2 : hash % 29 === 0 ? 3 : hash % 5 === 0 ? 1 : 0;
          this.tile(off, variant, 0, x * SIZE, y * SIZE);
        }
        this.chunks.set(key, chunk);
      }
      ctx.drawImage(chunk, cx * chunkSize, cy * chunkSize);
    }
  }

  architecture(ctx: CanvasRenderingContext2D, view: View, walls: readonly Rect[], doors: readonly Door[]): void {
    // Shadows are below every south-facing wall and behind all architecture.
    for (const wall of walls) {
      if (!this.visible(wall, view)) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(wall.x, wall.y + wall.h, wall.w, SIZE); ctx.clip();
      this.tile(ctx, 4, 1, wall.x, wall.y + wall.h, wall.w, SIZE);
      ctx.restore();
    }
    for (const wall of walls) {
      if (!this.visible(wall, view)) continue;
      ctx.save();
      ctx.beginPath(); ctx.rect(wall.x, wall.y, wall.w, wall.h); ctx.clip();
      // Wall art is cached per rectangle, rather than thousands of clipped draws per frame.
      const chunkSize = 256;
      const firstX = Math.max(0, Math.floor((view.minX - wall.x) / chunkSize));
      const firstY = Math.max(0, Math.floor((view.minY - wall.y) / chunkSize));
      const lastX = Math.min(Math.ceil(wall.w / chunkSize), Math.ceil((view.maxX - wall.x) / chunkSize));
      const lastY = Math.min(Math.ceil(wall.h / chunkSize), Math.ceil((view.maxY - wall.y) / chunkSize));
      for (let cy = firstY; cy < lastY; cy++) for (let cx = firstX; cx < lastX; cx++) {
        const w = Math.min(chunkSize, wall.w - cx * chunkSize);
        const h = Math.min(chunkSize, wall.h - cy * chunkSize);
        const key = `wall:${w},${h},${cy === 0}`;
        let cached = this.chunks.get(key);
        if (!cached) {
          cached = document.createElement("canvas"); cached.width = Math.ceil(w); cached.height = Math.ceil(h);
          const off = cached.getContext("2d");
          if (!off) continue;
          off.imageSmoothingEnabled = false;
          for (let y = 0; y < h; y += SIZE) for (let x = 0; x < w; x += SIZE) this.tile(off, cy === 0 && y === 0 ? 0 : 1, 1, x, y);
          this.chunks.set(key, cached);
        }
        ctx.drawImage(cached, wall.x + cx * chunkSize, wall.y + cy * chunkSize);
      }
      ctx.restore();
      // Coolant conduit and small observation windows on long top-wall faces.
      if (wall.w > wall.h * 3 && wall.h >= 16) {
        const start = Math.max(wall.x, view.minX), end = Math.min(wall.x + wall.w, view.maxX);
        ctx.fillStyle = "#004d48"; ctx.fillRect(start, wall.y + 4, Math.max(0, end - start), 3);
        ctx.fillStyle = "#00aabb"; ctx.fillRect(start, wall.y + 4, Math.max(0, end - start), 1);
        for (let x = wall.x + Math.max(0, Math.floor((start - wall.x) / 96)) * 96 + 16; x < end - 24; x += 96) {
          ctx.fillStyle = "#101f2d"; ctx.fillRect(x, wall.y + 9, 28, Math.min(8, wall.h - 9));
          ctx.fillStyle = "#246171"; ctx.fillRect(x + 2, wall.y + 10, 24, 1);
        }
      }
    }
    for (const door of doors) {
      if (!this.visible(door.rect, view)) continue;
      const { x, y, w, h } = door;
      // Caution stripes frame the entry rather than obstructing its opening.
      if (h >= w) {
        for (let yy = y; yy < y + h; yy += SIZE) {
          this.tile(ctx, 4, 0, x - 8, yy, 8, Math.min(SIZE, y + h - yy));
          this.tile(ctx, 4, 0, x + w, yy, 8, Math.min(SIZE, y + h - yy));
        }
      } else {
        for (let xx = x; xx < x + w; xx += SIZE) {
          this.tile(ctx, 4, 0, xx, y - 6, Math.min(SIZE, x + w - xx), 6);
          this.tile(ctx, 4, 0, xx, y + h, Math.min(SIZE, x + w - xx), 6);
        }
      }
      // Two independently retracting leaves preserve the gameplay door opening.
      const leaf = door.destroyed ? 0 : h * (1 - door.open) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, leaf); ctx.rect(x, y + h - leaf, w, leaf); ctx.clip();
      this.tile(ctx, 1, 3, x, y, w, h);
      ctx.restore();
      // Retraction rails and indicator remain when the opening is clear.
      this.tile(ctx, 0, 3, x, y - 8, w, 12);
      this.tile(ctx, 0, 3, x, y + h - 4, w, 12);
      ctx.fillStyle = door.open > 0.7 || door.destroyed ? "#00ff88" : door.kind === "reinforced" ? "#ff0055" : "#d4a017";
      ctx.fillRect(x + w / 2 - 2, y - 4, 4, 4);
    }
  }

  private visible(rect: Rect, view: View): boolean {
    return rect.x + rect.w >= view.minX && rect.x <= view.maxX && rect.y + rect.h + SIZE >= view.minY && rect.y <= view.maxY;
  }
}
