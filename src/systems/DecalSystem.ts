import { ARENA, COLORS } from "../core/config";
import { rand } from "../core/math";

/** Deterministic PRNG so the floor detail is stable between rebakes. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The "second canvas" of the dual-canvas architecture.
 *
 * One world-sized offscreen bitmap holds the static metal floor plus every
 * splatter, acid pool and scorch mark ever produced. It is drawn once per
 * frame with the camera transform, so scars stay on the arena floor and cost
 * only a single blit.
 */
export class DecalSystem {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ARENA.width;
    this.canvas.height = ARENA.height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.bakeFloor("standard");
  }

  /** Wipe all gore and repaint the base floor for the selected level. */
  reset(mode: "standard" | "tutorial" = "standard"): void {
    this.bakeFloor(mode);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.canvas, 0, 0);
  }

  stampBlood(x: number, y: number, radius: number, angle = Math.random() * Math.PI * 2): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = "source-over";

    // Pool
    for (let i = 0; i < 7; i += 1) {
      const dx = rand(-radius * 0.7, radius * 0.7);
      const dy = rand(-radius * 0.45, radius * 0.45);
      const r = radius * rand(0.28, 0.62);
      ctx.fillStyle = `rgba(${70 + Math.floor(rand(0, 30))}, ${10 + Math.floor(rand(0, 12))}, ${20}, ${rand(0.28, 0.5)})`;
      ctx.beginPath();
      ctx.ellipse(dx, dy, r, r * rand(0.55, 1), rand(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    // Droplets flung outward
    for (let i = 0; i < 12; i += 1) {
      const a = rand(0, Math.PI * 2);
      const d = rand(radius * 0.5, radius * 1.9);
      const r = rand(1.2, 4.4);
      ctx.fillStyle = `rgba(112, 16, 26, ${rand(0.25, 0.6)})`;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d * 0.7, r * 1.7, r, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wet highlight
    ctx.fillStyle = "rgba(190, 60, 70, 0.12)";
    ctx.beginPath();
    ctx.ellipse(-radius * 0.2, -radius * 0.2, radius * 0.3, radius * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  stampAcid(x: number, y: number, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 6; i += 1) {
      const dx = rand(-radius * 0.6, radius * 0.6);
      const dy = rand(-radius * 0.6, radius * 0.6);
      const r = radius * rand(0.3, 0.8);
      ctx.fillStyle = `rgba(${140 + Math.floor(rand(0, 60))}, 255, 60, ${rand(0.07, 0.16)})`;
      ctx.beginPath();
      ctx.ellipse(dx, dy, r, r * rand(0.6, 1), rand(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    // Etched bubbles
    for (let i = 0; i < 8; i += 1) {
      const a = rand(0, Math.PI * 2);
      const d = rand(0, radius * 0.9);
      ctx.strokeStyle = `rgba(180, 255, 80, ${rand(0.08, 0.2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, rand(1.5, 5), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  stampScorch(x: number, y: number, radius: number): void {
    const ctx = this.ctx;
    ctx.save();
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(4, 4, 6, 0.72)");
    gradient.addColorStop(0.55, "rgba(8, 8, 10, 0.45)");
    gradient.addColorStop(1, "rgba(8, 8, 10, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 14; i += 1) {
      const a = rand(0, Math.PI * 2);
      const d = rand(radius * 0.2, radius * 0.95);
      ctx.fillStyle = `rgba(0, 0, 0, ${rand(0.2, 0.5)})`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(1, 5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Acid footstep from the mutant graft. */
  stampFootprint(x: number, y: number, angle: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(160, 255, 70, 0.13)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(190, 255, 90, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Large permanent mark for a meltdown / corpse detonation. */
  stampDetonation(x: number, y: number, radius: number): void {
    this.stampScorch(x, y, radius);
    this.stampBlood(x, y, radius * 0.7);
    this.stampAcid(x, y, radius);
  }

  private bakeFloor(mode: "standard" | "tutorial"): void {
    const ctx = this.ctx;
    const random = mulberry32(0x5eed);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ARENA.width, ARENA.height);
    ctx.fillStyle = COLORS.floorDark;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    const tile = 100;
    // Metal plate variation
    for (let y = 0; y < ARENA.height; y += tile) {
      for (let x = 0; x < ARENA.width; x += tile) {
        const shade = random();
        ctx.fillStyle = shade > 0.7 ? COLORS.floorLight : shade > 0.35 ? "#1d242d" : COLORS.floorDark;
        ctx.fillRect(x, y, tile, tile);

        // Bevels
        ctx.strokeStyle = "rgba(255, 255, 255, 0.028)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + tile - 0.5);
        ctx.lineTo(x + 0.5, y + 0.5);
        ctx.lineTo(x + tile - 0.5, y + 0.5);
        ctx.stroke();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
        ctx.beginPath();
        ctx.moveTo(x + tile - 0.5, y + 0.5);
        ctx.lineTo(x + tile - 0.5, y + tile - 0.5);
        ctx.lineTo(x + 0.5, y + tile - 0.5);
        ctx.stroke();
      }
    }

    // Grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    for (let x = tile; x < ARENA.width; x += tile) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, ARENA.height);
      ctx.stroke();
    }
    for (let y = tile; y < ARENA.height; y += tile) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(ARENA.width, y + 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Rivets
    for (let y = 50; y < ARENA.height; y += 100) {
      for (let x = 50; x < ARENA.width; x += 100) {
        if (random() > 0.55) continue;
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.beginPath();
        ctx.arc(x + 1, y + 1, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.rivet;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.arc(x - 0.6, y - 0.6, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Grime, oil and hairline cracks
    for (let i = 0; i < 110; i += 1) {
      const x = random() * ARENA.width;
      const y = random() * ARENA.height;
      const r = 8 + random() * 55;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, `rgba(0, 0, 0, ${0.06 + random() * 0.12})`);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    for (let i = 0; i < 26; i += 1) {
      let x = random() * ARENA.width;
      let y = random() * ARENA.height;
      ctx.lineWidth = random() * 0.9 + 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let seg = 0; seg < 4; seg += 1) {
        x += (random() - 0.5) * 46;
        y += (random() - 0.5) * 46;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Heavy panel seams every four tiles.
    for (let x = 400; x < ARENA.width; x += 400) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(x, ARENA.wall, 2, ARENA.height - ARENA.wall * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
      ctx.fillRect(x + 2, ARENA.wall, 1, ARENA.height - ARENA.wall * 2);
    }
    for (let y = 400; y < ARENA.height; y += 400) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(ARENA.wall, y, ARENA.width - ARENA.wall * 2, 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
      ctx.fillRect(ARENA.wall, y + 2, ARENA.width - ARENA.wall * 2, 1);
    }

    // Stencilled sector marking.
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.font = "700 96px 'Chakra Petch', 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#c8d6e2";
    ctx.fillText(mode === "tutorial" ? "PROVING GROUND" : "SECTOR 04", ARENA.width / 2, 240);
    ctx.font = "700 46px 'Chakra Petch', 'Segoe UI', sans-serif";
    ctx.fillText(
      mode === "tutorial" ? "CONTAINMENT // 01-05" : "BIOFOUNDRY // B4",
      ARENA.width / 2,
      ARENA.height - 150,
    );
    ctx.restore();

    // Painted chevrons that point toward the arena interior.
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = COLORS.hazard;
    ctx.lineWidth = 3;
    for (const [cx, cy, dir] of [
      [150, ARENA.height / 2, 1],
      [ARENA.width - 150, ARENA.height / 2, -1],
      [ARENA.width / 2, 150, 0],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      if (dir === 0) ctx.rotate(Math.PI / 2);
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-12 + i * 14, -22);
        ctx.lineTo(2 + i * 14, 0);
        ctx.lineTo(-12 + i * 14, 22);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // Dormant light strips
    for (let y = 240; y < ARENA.height; y += 320) {
      ctx.fillStyle = "rgba(30, 84, 98, 0.3)";
      ctx.fillRect(ARENA.wall + 90, y, ARENA.width - (ARENA.wall + 90) * 2, 5);
      ctx.fillStyle = "rgba(70, 190, 210, 0.08)";
      ctx.fillRect(ARENA.wall + 90, y - 1, ARENA.width - (ARENA.wall + 90) * 2, 2);
    }

    // Hazard border band
    const band = ARENA.wall;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.width, ARENA.height);
    ctx.rect(band, band, ARENA.width - band * 2, ARENA.height - band * 2);
    ctx.clip("evenodd");
    ctx.fillStyle = "#0c0e12";
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    ctx.globalAlpha = 0.24;
    ctx.strokeStyle = COLORS.hazard;
    ctx.lineWidth = 14;
    for (let i = -ARENA.height; i < ARENA.width + ARENA.height; i += 56) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + ARENA.height, ARENA.height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Border frame lines
    ctx.strokeStyle = "rgba(216, 169, 29, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(band - 1, band - 1, ARENA.width - band * 2 + 2, ARENA.height - band * 2 + 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, ARENA.width - 1, ARENA.height - 1);

    // Corner warning chevrons
    ctx.fillStyle = "rgba(216, 169, 29, 0.22)";
    for (const [cx, cy, sx, sy] of [
      [band + 18, band + 18, 1, 1],
      [ARENA.width - band - 18, band + 18, -1, 1],
      [band + 18, ARENA.height - band - 18, 1, -1],
      [ARENA.width - band - 18, ARENA.height - band - 18, -1, -1],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(34, 0);
      ctx.lineTo(0, 34);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
