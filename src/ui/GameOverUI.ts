import type { GameMode, RunStats } from "../world/World";
import {
  FONT,
  HoverTracker,
  UI,
  drawButton,
  drawCrtLines,
  drawPanel,
  fillTextShadow,
  formatClock,
  inRect,
  type Rect,
  type UiInput,
} from "./theme";

type OverAction = "retry" | "codex" | "menu" | null;

/** Autopsy report shown when the run ends, by meltdown, gunfire or a cleared sector. */
export class GameOverUI {
  private won = false;
  private cause = "";
  private stats: RunStats = { hijacks: 0, kills: 0 };
  private elapsed = 0;
  private mode: GameMode = "standard";
  private readonly hover = new HoverTracker();

  show(won: boolean, cause: string, stats: RunStats, elapsed: number, mode: GameMode = "standard"): void {
    this.won = won;
    this.cause = cause;
    this.stats = { ...stats };
    this.elapsed = elapsed;
    this.mode = mode;
    this.hover.reset();
  }

  handle(ui: UiInput): OverAction {
    const { input, width, height, sfx } = ui;
    const layout = this.layout(width, height);

    let hovered: string | null = null;
    if (inRect(input.mouse, layout.retry)) hovered = "retry";
    if (inRect(input.mouse, layout.codex)) hovered = "codex";
    if (inRect(input.mouse, layout.menu)) hovered = "menu";
    this.hover.update(hovered, sfx);

    if (!input.leftPressed) return null;
    if (inRect(input.mouse, layout.retry)) {
      sfx.play("uiClick");
      return "retry";
    }
    if (inRect(input.mouse, layout.codex)) {
      sfx.play("uiClick");
      return "codex";
    }
    if (inRect(input.mouse, layout.menu)) {
      sfx.play("uiClick");
      return "menu";
    }
    return null;
  }

  /** Three-hitbox row, re-measured from the live viewport every frame. */
  private layout(width: number, height: number): { retry: Rect; codex: Rect; menu: Rect } {
    const gap = 14;
    const bw = Math.round(Math.min(206, (width - 88 - gap * 2) / 3));
    const bh = 46;
    const total = bw * 3 + gap * 2;
    const x = Math.round(width / 2 - total / 2);
    const y = Math.round(height * 0.68);
    return {
      retry: { x, y, w: bw, h: bh },
      codex: { x: x + bw + gap, y, w: bw, h: bh },
      menu: { x: x + (bw + gap) * 2, y, w: bw, h: bh },
    };
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    const layout = this.layout(width, height);
    const accent = this.won ? UI.green : "#ff3d3d";

    ctx.fillStyle = "rgba(3, 5, 8, 0.84)";
    ctx.fillRect(0, 0, width, height);

    // Hazard bands.
    ctx.save();
    ctx.globalAlpha = 0.16 + Math.sin(time * 2) * 0.04;
    ctx.strokeStyle = this.won ? UI.green : "#d8a91d";
    ctx.lineWidth = 8;
    for (let i = -height; i < width + height; i += 48) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 30, 26);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, height - 26);
      ctx.lineTo(i + 30, height);
      ctx.stroke();
    }
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT(12, 700);
    const eyebrow = this.won
      ? "AUTOPSY REPORT // EXIT CLEAR"
      : this.mode === "tutorial"
        ? "AUTOPSY REPORT // TRAINING LOST"
        : "AUTOPSY REPORT // SUBJECT LOST";
    fillTextShadow(ctx, eyebrow, width / 2, height * 0.2, "rgba(220, 240, 232, 0.45)");

    const jitter = Math.sin(time * 1.3) > 0.97 ? 3 : 0;
    ctx.font = FONT(Math.round(Math.min(64, width * 0.05)), 700);
    const title = this.won ? "SECTOR CLEARED" : this.mode === "tutorial" ? "TRAINING FAILED" : "SPORE DESTROYED";
    fillTextShadow(ctx, title, width / 2 + jitter, height * 0.3, accent, 2);

    ctx.font = FONT(14, 600);
    const subtitle = this.won
      ? "CONTAINMENT BROKEN // THE FLESH MOVES ON"
      : this.mode === "tutorial"
        ? "PROVING GROUND RESET // LEARN THE LOOP"
        : this.cause || "A HOSTILE TOUCH ENDED THE SPORE";
    fillTextShadow(ctx, subtitle, width / 2, height * 0.3 + 34, this.won ? "rgba(0, 255, 136, 0.7)" : "rgba(255, 110, 110, 0.82)");

    // Stats plate.
    const panelW = Math.min(460, width - 80);
    const panelX = Math.round(width / 2 - panelW / 2);
    const panelY = Math.round(height * 0.38);
    const panelH = 138;
    drawPanel(ctx, { x: panelX, y: panelY, w: panelW, h: panelH }, { fill: "rgba(5, 12, 12, 0.9)", stroke: "rgba(255,255,255,0.1)" });
    ctx.fillStyle = accent;
    ctx.fillRect(panelX, panelY, 3, panelH);

    const rows: Array<[string, string]> = [
      ["BODIES WORN", String(this.stats.hijacks).padStart(2, "0")],
      ["HOSTS ENDED", String(this.stats.kills).padStart(2, "0")],
      ["TIME INSIDE", formatClock(this.elapsed)],
      ["FINAL STATE", this.won ? "SECTOR VOID" : "SPORE DEAD"],
    ];
    rows.forEach(([label, value], index) => {
      const ry = panelY + 30 + index * 28;
      ctx.textAlign = "left";
      ctx.font = FONT(12, 600);
      fillTextShadow(ctx, label, panelX + 24, ry, "rgba(175, 215, 198, 0.6)");
      ctx.textAlign = "right";
      ctx.font = FONT(16, 700);
      fillTextShadow(ctx, value, panelX + panelW - 24, ry, index === 3 ? accent : "#eafff3");
    });
    ctx.textAlign = "left";

    drawButton(ctx, layout.retry, this.mode === "tutorial" ? "RETRY TRAINING  //  R" : "RETRY  //  R", {
      hover: this.hover.hovered === "retry",
      center: true,
      accent,
    });
    drawButton(ctx, layout.codex, "VIEW CODEX", { hover: this.hover.hovered === "codex", center: true });
    drawButton(ctx, layout.menu, "MAIN MENU  //  ESC", { hover: this.hover.hovered === "menu", center: true });
    ctx.textAlign = "center";
    ctx.font = FONT(11, 600);
    fillTextShadow(
      ctx,
      "R RETRY   //   ESC TITLE   //   TAB DATABASE",
      width / 2,
      layout.retry.y + 76,
      "rgba(175, 215, 198, 0.45)",
    );
    ctx.textAlign = "left";

    drawCrtLines(ctx, 0, 0, width, height);
  }
}
