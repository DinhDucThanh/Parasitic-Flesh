import { COLORS } from "../core/config";
import { FONT, fillTextShadow } from "../core/fonts";
import { TAU, easeOutCubic, type Vec2 } from "../core/math";
import type { Explosion, Hazard, Particle } from "../systems/Effects";

/** Convert "#rrggbb" + alpha to a canvas color. */
export function rgba(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawExplosion(ctx: CanvasRenderingContext2D, e: Explosion, time = 0): void {
  const t = e.t;
  const radius = e.radius * (0.2 + 0.8 * easeOutCubic(t));
  const alpha = 1 - t;
  const base = e.kind === "meltdown" ? "#ff5a3c" : e.kind === "spark" ? "#ffe089" : COLORS.acid;

  ctx.save();
  ctx.translate(e.position.x, e.position.y);

  const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  fill.addColorStop(0, rgba(base, alpha * 0.7));
  fill.addColorStop(0.55, rgba(base, alpha * 0.3));
  fill.addColorStop(1, rgba(base, 0));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = rgba(base, alpha * 0.8);
  ctx.lineWidth = 3.5 * (1 - t) + 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();

  // Shards.
  ctx.strokeStyle = rgba("#ffffff", alpha * 0.6);
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * TAU + time * 0.1;
    const inner = radius * 0.35;
    const outer = radius * (0.85 + (i % 3) * 0.12);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }

  if (t < 0.22) {
    ctx.fillStyle = `rgba(255, 255, 240, ${(1 - t / 0.22) * 0.85})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.35, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export function drawParticle(ctx: CanvasRenderingContext2D, p: Particle): void {
  ctx.globalAlpha = p.alpha;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.position.x, p.position.y, p.size, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawHazard(ctx: CanvasRenderingContext2D, h: Hazard): void {
  ctx.save();
  ctx.translate(h.position.x, h.position.y);
  ctx.globalAlpha = h.alpha;
  const radius = h.radius * (0.85 + Math.sin(h.phase) * 0.08);
  const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  pool.addColorStop(0, "rgba(150, 255, 60, 0.22)");
  pool.addColorStop(0.6, "rgba(110, 210, 40, 0.14)");
  pool.addColorStop(1, "rgba(110, 210, 40, 0)");
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = "rgba(190, 255, 90, 0.3)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i += 1) {
    const a = h.phase + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * radius * 0.3, Math.sin(a) * radius * 0.3, 3 + Math.sin(h.phase * 2 + i) * 1.5, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  time: number,
  locked: boolean,
  color: string = COLORS.spore,
): void {
  const pulse = 1 + Math.sin(time * (locked ? 9 : 4)) * 0.1;
  const r = radius * pulse;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time * (locked ? 1.6 : 0.6));
  ctx.strokeStyle = rgba(color, locked ? 0.95 : 0.5);
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU;
    ctx.beginPath();
    ctx.arc(0, 0, r, a + 0.18, a + TAU / 4 - 0.18);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(color, locked ? 0.7 : 0.3);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, TAU);
  ctx.stroke();

  // Corner ticks.
  ctx.strokeStyle = rgba(color, locked ? 0.9 : 0.4);
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * TAU + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
    ctx.lineTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawAimCone(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  angle: number,
  target: Vec2 | null,
  time: number,
  cone: number,
  range: number,
  mode: "leap" | "eject",
): void {
  const color = mode === "eject" ? "#ffe27a" : COLORS.spore;
  ctx.save();

  const wedge = ctx.createRadialGradient(from.x, from.y, 10, from.x, from.y, range);
  wedge.addColorStop(0, rgba(color, 0.12));
  wedge.addColorStop(0.65, rgba(color, 0.05));
  wedge.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = wedge;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.arc(from.x, from.y, range, angle - cone, angle + cone);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(color, 0.22);
  ctx.lineWidth = 1;
  for (const edge of [angle - cone, angle + cone]) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + Math.cos(edge) * range, from.y + Math.sin(edge) * range);
    ctx.stroke();
  }

  const endX = target ? target.x : from.x + Math.cos(angle) * range;
  const endY = target ? target.y : from.y + Math.sin(angle) * range;

  ctx.setLineDash([7, 9]);
  ctx.lineDashOffset = -time * 55;
  ctx.strokeStyle = rgba(color, target ? 0.85 : 0.45);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Chevrons along the path.
  for (let i = 1; i <= 4; i += 1) {
    const t = i / 5;
    const x = from.x + (endX - from.x) * t;
    const y = from.y + (endY - from.y) * t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = rgba(color, 0.5);
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(0, 0);
    ctx.lineTo(-4, 4);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
  drawReticle(ctx, endX, endY, target ? 16 : 10, time, Boolean(target), color);
}

export function drawWhisper(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  life: number,
  maxLife: number,
): void {
  const age = maxLife - life;
  const fade = Math.min(1, age / 0.25) * Math.min(1, life / 0.6);
  const revealed = Math.floor(Math.max(0, age) * 34);
  const visible = text.slice(0, revealed);
  if (!visible) return;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = FONT(13, 600);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const width = ctx.measureText(visible).width;
  ctx.fillStyle = "rgba(3, 8, 10, 0.78)";
  roundedRect(ctx, x - width / 2 - 8, y - 18, width + 16, 22, 3);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 255, 136, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  fillTextShadow(ctx, `“${visible}”`, x, y, "#b9ffe2");
  ctx.restore();
}
