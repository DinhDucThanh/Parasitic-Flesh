import {
  FONT,
  HoverTracker,
  UI,
  drawButton,
  drawCrtLines,
  fillTextShadow,
  inRect,
  type Rect,
  type UiInput,
} from "./theme";

export type TutorialClearAction = "proceed" | "menu" | null;

/**
 * Debrief shown the moment the Proving Ground portal is entered. It replaces
 * the old automatic hand-off: the player chooses to deploy into Sector 1 or
 * return to the title screen.
 */
export class TutorialCompleteUI {
  private readonly hover = new HoverTracker();

  reset(): void {
    this.hover.reset();
  }

  handle(ui: UiInput): TutorialClearAction {
    const { input, width, height, sfx } = ui;
    const layout = this.layout(width, height);

    let hovered: string | null = null;
    if (inRect(input.mouse, layout.proceed)) hovered = "proceed";
    if (inRect(input.mouse, layout.menu)) hovered = "menu";
    this.hover.update(hovered, sfx);

    if (input.wasPressed("Enter") || input.wasPressed("Space")) {
      sfx.play("uiClick");
      return "proceed";
    }
    if (input.wasPressed("Escape")) {
      sfx.play("uiClick");
      return "menu";
    }
    if (!input.leftPressed) return null;
    if (inRect(input.mouse, layout.proceed)) {
      sfx.play("uiClick");
      return "proceed";
    }
    if (inRect(input.mouse, layout.menu)) {
      sfx.play("uiClick");
      return "menu";
    }
    return null;
  }

  private layout(width: number, height: number): { proceed: Rect; menu: Rect } {
    const gap = 14;
    const bw = Math.round(Math.min(268, (width - 96 - gap) / 2));
    const bh = 50;
    const total = bw * 2 + gap;
    const x = Math.round(width / 2 - total / 2);
    const y = Math.round(height * 0.64);
    return {
      proceed: { x, y, w: bw, h: bh },
      menu: { x: x + bw + gap, y, w: bw, h: bh },
    };
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    const layout = this.layout(width, height);

    ctx.fillStyle = "rgba(3, 7, 9, 0.82)";
    ctx.fillRect(0, 0, width, height);

    // Slow green sweep behind the report.
    ctx.save();
    ctx.globalAlpha = 0.1 + Math.sin(time * 1.4) * 0.03;
    const sweep = ctx.createLinearGradient(0, 0, width, height);
    sweep.addColorStop(0, "rgba(0, 255, 136, 0)");
    sweep.addColorStop(0.5, "rgba(0, 255, 136, 0.5)");
    sweep.addColorStop(1, "rgba(0, 255, 136, 0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, height * 0.24, width, 2);
    ctx.restore();

    // Containment ring motif.
    ctx.save();
    ctx.strokeStyle = "rgba(0, 255, 136, 0.14)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.arc(width / 2, height * 0.42, 108 + i * 22, time * 0.3 + i, time * 0.3 + i + Math.PI * 1.2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0, 255, 136, 0.35)";
    ctx.beginPath();
    ctx.arc(width / 2, height * 0.42, 132, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.96);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT(12, 700);
    fillTextShadow(ctx, "PROVING GROUND // CLEAR", width / 2, height * 0.2, "rgba(0, 255, 136, 0.7)");

    ctx.font = FONT(Math.round(Math.min(58, width * 0.048)), 700);
    fillTextShadow(ctx, "QUALIFICATION COMPLETE", width / 2, height * 0.3, "#eafff3", 2);

    ctx.font = FONT(15, 500);
    fillTextShadow(
      ctx,
      "SEVEN CHAMBERS SURVIVED // PROCEED TO SECTOR 1",
      width / 2,
      height * 0.3 + 34,
      "rgba(190, 235, 214, 0.7)",
    );

    ctx.font = FONT(12, 700);
    fillTextShadow(
      ctx,
      "SECTOR 1 // LIVE CONTAINMENT  ·  EIGHT HOSTILES  ·  NO RESUPPLY",
      width / 2,
      height * 0.3 + 60,
      "rgba(175, 215, 198, 0.45)",
    );

    drawButton(ctx, layout.proceed, "ENTER SECTOR 1", {
      hover: this.hover.hovered === "proceed",
      center: true,
      accent: UI.green,
    });
    drawButton(ctx, layout.menu, "MAIN MENU", {
      hover: this.hover.hovered === "menu",
      center: true,
    });

    drawCrtLines(ctx, 0, 0, width, height);
    ctx.textAlign = "left";
  }
}

