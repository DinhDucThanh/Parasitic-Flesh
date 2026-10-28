import type { SfxSynth } from "../assets/SfxSynth";
import { FONT, fillLinesShadow, fillTextShadow } from "../core/fonts";
import type { Input } from "../core/Input";
import type { Vec2 } from "../core/math";

export { FONT };
export { fillTextShadow };

export interface UiInput {
  input: Input;
  sfx: SfxSynth;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const UI = {
  green: "#00ff88",
  greenDim: "rgba(0, 255, 136, 0.35)",
  greenFaint: "rgba(0, 255, 136, 0.12)",
  panel: "#0a0d12",
  text: "#cfeedd",
  dim: "rgba(175, 215, 198, 0.5)",
  red: "#ff3d3d",
  amber: "#ffc94a",
  cyan: "#7fe9ff",
} as const;

export function inRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function centeredRect(cx: number, y: number, w: number, h: number): Rect {
  return { x: Math.round(cx - w / 2), y, w, h };
}

/** Bracketed terminal button. Caller decides hover/click; this only draws. */
export function drawButton(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  options: { hover?: boolean; active?: boolean; disabled?: boolean; size?: number; center?: boolean; accent?: string } = {},
): void {
  const { hover = false, active = false, disabled = false, size = 15, center = false, accent = UI.green } = options;
  const alpha = disabled ? 0.3 : 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hover || active ? "rgba(0, 255, 136, 0.1)" : "rgba(5, 14, 11, 0.55)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = hover || active ? accent : "rgba(0, 255, 136, 0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

  // Left marker.
  ctx.fillStyle = hover || active ? accent : "rgba(0, 255, 136, 0.35)";
  ctx.fillRect(rect.x, rect.y, hover || active ? 3 : 1, rect.h);

  ctx.font = FONT(size, 700);
  ctx.textAlign = center ? "center" : "left";
  ctx.textBaseline = "middle";
  const color = disabled ? "rgba(160, 200, 185, 0.4)" : hover || active ? "#eafff3" : UI.text;
  fillTextShadow(ctx, label, center ? rect.x + rect.w / 2 : rect.x + 16, rect.y + rect.h / 2 + 1, color);
  ctx.restore();
}

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  options: { fill?: string; stroke?: string; thickness?: number } = {},
): void {
  ctx.fillStyle = options.fill ?? "rgba(6, 12, 14, 0.85)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = options.stroke ?? "rgba(0, 255, 136, 0.22)";
  ctx.lineWidth = options.thickness ?? 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

/** Word wrapper that respects explicit newlines. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Draws wrapped text and returns the y after the last line. */
export function drawParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  color: string = UI.text,
): number {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, text, maxWidth);
  fillLinesShadow(ctx, lines, x, y, lineHeight, color);
  return y + lines.length * lineHeight;
}

/** Keycap used by the controls tab. */
export function drawKeycap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  active = false,
): void {
  ctx.fillStyle = active ? "rgba(0, 255, 136, 0.18)" : "rgba(255, 255, 255, 0.045)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = active ? UI.green : "rgba(0, 255, 136, 0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = FONT(13, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fillTextShadow(ctx, label, x + w / 2, y + h / 2 + 1, active ? "#eafff3" : UI.text);
}

/** Tracks which control is hovered so the UI blips exactly once per entry. */
export class HoverTracker {
  private current: string | null = null;

  update(key: string | null, sfx: SfxSynth): void {
    if (key === this.current) return;
    this.current = key;
    if (key) sfx.play("uiHover");
  }

  get hovered(): string | null {
    return this.current;
  }

  reset(): void {
    this.current = null;
  }
}

/** Fine CRT scanlines for modal surfaces. */
export function drawCrtLines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let line = y; line < y + h; line += 3) {
    ctx.fillRect(x, line, w, 1);
  }
  ctx.restore();
}

export function formatClock(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
