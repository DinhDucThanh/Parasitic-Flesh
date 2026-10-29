import { SETTINGS } from "../core/config";
import { TAU, clamp } from "../core/math";
import { FONT, HoverTracker, UI, drawButton, drawPanel, fillTextShadow, inRect, type Rect, type UiInput } from "./theme";

interface Mote {
  nx: number;
  ny: number;
  radius: number;
  speed: number;
  phase: number;
  green: boolean;
}

type MenuAction = "tutorial" | "sector" | "codex" | null;

interface MenuLayout {
  start: Rect;
  sector: Rect;
  codex: Rect;
  settings: Rect;
  volume: Rect;
  shakeToggle: Rect;
  back: Rect;
  panel: Rect;
}

/**
 * Retro terminal title screen. Draws its own animated backdrop (drifting
 * spores, pulsing hazard decals, a giant specimen mass) and the settings panel.
 */
export class MainMenu {
  private mode: "main" | "settings" = "main";
  private readonly hover = new HoverTracker();
  private readonly motes: Mote[] = [];

  constructor() {
    for (let i = 0; i < 56; i += 1) {
      this.motes.push({
        nx: Math.random(),
        ny: Math.random(),
        radius: 1 + Math.random() * 3.6,
        speed: 0.3 + Math.random() * 0.8,
        phase: Math.random() * TAU,
        green: Math.random() < 0.45,
      });
    }
  }

  reset(): void {
    this.mode = "main";
    this.hover.reset();
  }

  handle(ui: UiInput): MenuAction {
    const { input, width, height, sfx } = ui;
    const layout = this.layout(width, height);

    if (this.mode === "settings") {
      const hovered = this.settingsHit(layout, input.mouse);
      this.hover.update(hovered, sfx);

      if (inRect(input.mouse, layout.volume) && input.leftHeld) {
        const ratio = clamp((input.mouse.x - layout.volume.x) / layout.volume.w, 0, 1);
        if (Math.abs(ratio - SETTINGS.volume) > 0.005) {
          sfx.setVolume(ratio);
        }
      }
      if (input.wasPressed("Escape")) {
        this.mode = "main";
        sfx.play("uiClick");
        this.hover.reset();
        return null;
      }
      if (!input.leftPressed) return null;

      if (inRect(input.mouse, layout.volume)) {
        const ratio = clamp((input.mouse.x - layout.volume.x) / layout.volume.w, 0, 1);
        sfx.setVolume(ratio);
        sfx.play("uiClick");
        return null;
      }
      if (inRect(input.mouse, layout.shakeToggle)) {
        SETTINGS.screenShake = !SETTINGS.screenShake;
        sfx.play("uiClick");
        return null;
      }
      if (inRect(input.mouse, layout.back)) {
        this.mode = "main";
        sfx.play("uiClick");
        this.hover.reset();
        return null;
      }
      return null;
    }

    const buttons = [layout.start, layout.sector, layout.codex, layout.settings];
    const ids = ["tutorial", "sector", "codex", "settings"];
    let hovered: string | null = null;
    buttons.forEach((rect, index) => {
      if (inRect(input.mouse, rect)) hovered = ids[index] as string;
    });
    this.hover.update(hovered, sfx);

    if (input.wasPressed("Enter") || input.wasPressed("Space")) {
      sfx.play("uiClick");
      return "tutorial";
    }
    if (input.wasPressed("KeyD")) {
      sfx.play("uiClick");
      return "sector";
    }
    if (input.wasPressed("KeyC")) {
      sfx.play("uiClick");
      return "codex";
    }

    if (!input.leftPressed) return null;
    if (inRect(input.mouse, layout.start)) {
      sfx.play("uiClick");
      return "tutorial";
    }
    if (inRect(input.mouse, layout.sector)) {
      sfx.play("uiClick");
      return "sector";
    }
    if (inRect(input.mouse, layout.codex)) {
      sfx.play("uiClick");
      return "codex";
    }
    if (inRect(input.mouse, layout.settings)) {
      this.mode = "settings";
      sfx.play("uiClick");
      this.hover.reset();
    }
    return null;
  }

  private layout(width: number, height: number): MenuLayout {
    const x = Math.round(Math.max(52, width * 0.09));
    const w = Math.round(clamp(width * 0.27, 300, 372));
    const h = 44;
    const gap = 12;
    const y = Math.round(height * 0.5);
    const panelW = Math.min(560, width - 80);
    const panelH = 348;
    const panel = { x: Math.round(width / 2 - panelW / 2), y: Math.round(height / 2 - panelH / 2), w: panelW, h: panelH };
    return {
      start: { x, y, w, h },
      sector: { x, y: y + h + gap, w, h },
      codex: { x, y: y + (h + gap) * 2, w, h },
      settings: { x, y: y + (h + gap) * 3, w, h },
      panel,
      volume: { x: panel.x + 36, y: panel.y + 132, w: panelW - 72, h: 18 },
      shakeToggle: { x: panel.x + 36, y: panel.y + 186, w: 168, h: 34 },
      back: { x: panel.x + 36, y: panel.y + panelH - 66, w: 190, h: 40 },
    };
  }

  private settingsHit(layout: MenuLayout, mouse: { x: number; y: number }): string | null {
    if (inRect(mouse, layout.volume)) return "volume";
    if (inRect(mouse, layout.shakeToggle)) return "shake";
    if (inRect(mouse, layout.back)) return "back";
    return null;
  }

  renderBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, width, height);

    // Ambient green pool of light behind the specimen.
    const cx = width * 0.76;
    const cy = height * 0.42;
    const ambient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.6);
    ambient.addColorStop(0, "rgba(0, 255, 136, 0.07)");
    ambient.addColorStop(0.45, "rgba(0, 80, 50, 0.05)");
    ambient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, width, height);

    // Faint technical grid.
    ctx.strokeStyle = "rgba(80, 130, 115, 0.05)";
    ctx.lineWidth = 1;
    const grid = 64;
    for (let x = (time * 4) % grid; x < width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Drifting spores.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const mote of this.motes) {
      const x = mote.nx * width + Math.sin(time * mote.speed + mote.phase) * 26;
      const y = ((mote.ny * height - time * mote.speed * 16) % (height + 60) + height + 60) % (height + 60);
      const alpha = 0.12 + 0.16 * (0.5 + Math.sin(time * 2 + mote.phase) * 0.5);
      ctx.fillStyle = mote.green ? `rgba(0, 255, 136, ${alpha})` : `rgba(120, 190, 170, ${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Giant specimen silhouette: same displaced-polygon trick as the spore.
    const radius = Math.min(width, height) * 0.21;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 0.12) * 0.1);
    ctx.beginPath();
    for (let i = 0; i < 40; i += 1) {
      const angle = (i / 40) * TAU;
      const wobble = 1 + 0.13 * Math.sin(angle * 3 + time * 0.6) + 0.07 * Math.sin(angle * 7 - time * 0.35);
      const x = Math.cos(angle) * radius * wobble;
      const y = Math.sin(angle) * radius * wobble;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const mass = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.2);
    mass.addColorStop(0, "rgba(0, 255, 136, 0.06)");
    mass.addColorStop(0.7, "rgba(0, 90, 55, 0.04)");
    mass.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = mass;
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 255, 136, 0.13)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Inner organelles.
    ctx.strokeStyle = "rgba(0, 255, 136, 0.1)";
    for (let i = 0; i < 5; i += 1) {
      const a = time * 0.2 + (i / 5) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * radius * 0.45, Math.sin(a) * radius * 0.45, radius * (0.08 + i * 0.02), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    // Hazard stripe band along the bottom.
    const bandY = height - 54;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bandY, width, 54);
    ctx.clip();
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, bandY, width, 54);
    ctx.globalAlpha = 0.22 + Math.sin(time * 2) * 0.05;
    ctx.strokeStyle = "#d8a91d";
    ctx.lineWidth = 10;
    for (let i = -height; i < width + height; i += 54) {
      ctx.beginPath();
      ctx.moveTo(i, bandY);
      ctx.lineTo(i + 60, bandY + 54);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(216, 169, 29, 0.28)";
    ctx.beginPath();
    ctx.moveTo(0, bandY + 0.5);
    ctx.lineTo(width, bandY + 0.5);
    ctx.stroke();

    // Vignette.
    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    this.renderBackdrop(ctx, width, height, time);
    const layout = this.layout(width, height);

    const titleSize = Math.round(clamp(height * 0.088, 42, 82));
    const left = Math.max(52, width * 0.09);

    // Kicker.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT(12, 700);
    fillTextShadow(ctx, "// BIOHAZARD CONTAINMENT FAILURE", left, height * 0.22, "rgba(255, 90, 90, 0.8)");
    ctx.fillStyle = "rgba(255, 70, 70, 0.35)";
    ctx.fillRect(left, height * 0.225, 300 + Math.sin(time * 3) * 8, 1);

    // Title.
    ctx.font = FONT(titleSize, 700);
    fillTextShadow(ctx, "PARASITIC", left, height * 0.32, "#dfeee7", 2);
    const glitch = Math.sin(time * 1.7) > 0.985 ? 3 : Math.sin(time * 0.7) * 0.6;
    fillTextShadow(ctx, "FLESH", left + glitch, height * 0.32 + titleSize * 1.02, UI.green, 2);

    ctx.font = FONT(13, 500);
    fillTextShadow(
      ctx,
      "A BODY-HORROR HIJACK ROGUELITE  //  DUNGEON",
      left,
      height * 0.32 + titleSize * 1.02 + 30,
      "rgba(175, 215, 198, 0.7)",
    );

    // Menu buttons.
    drawButton(ctx, layout.start, "01  //  TUTORIAL PROTOCOL", { hover: this.hover.hovered === "tutorial" });
    drawButton(ctx, layout.sector, "02  //  DEPLOY: SECTOR 1", { hover: this.hover.hovered === "sector" });
    drawButton(ctx, layout.codex, "03  //  BIO-DATABASE / CODEX", { hover: this.hover.hovered === "codex" });
    drawButton(ctx, layout.settings, "04  //  SYSTEM SETTINGS", { hover: this.hover.hovered === "settings" });

    // Specimen readout next to the mass (hidden when it would collide with the menu).
    if (width > 980) {
      const rx = width * 0.76;
      const ry = height * 0.72;
      ctx.textAlign = "center";
      ctx.font = FONT(11, 700);
      fillTextShadow(ctx, "SPECIMEN 0 // ACTIVE", rx, ry, "rgba(0, 255, 136, 0.5)");
      ctx.fillStyle = "rgba(0, 255, 136, 0.22)";
      ctx.fillRect(rx - 70, ry + 8, 140, 1);
    }

    // Footer.
    ctx.textAlign = "left";
    ctx.font = FONT(11, 600);
    fillTextShadow(ctx, "ENTER // TUTORIAL    D // SECTOR 1    C // CODEX", left, height - 76, "rgba(175, 215, 198, 0.5)");
    ctx.textAlign = "right";
    fillTextShadow(ctx, "BIO-TERMINAL // CONTAINMENT", width - 40, height - 76, "rgba(175, 215, 198, 0.35)");
    ctx.textAlign = "left";
    fillTextShadow(ctx, time % 1.4 < 0.7 ? "SYS: ONLINE_" : "SYS: ONLINE", left, height - 96, "rgba(0, 255, 136, 0.55)");

    if (this.mode === "settings") this.renderSettings(ctx, width, height);
  }

  private renderSettings(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const layout = this.layout(width, height);
    const panel = layout.panel;
    ctx.fillStyle = "rgba(2, 5, 8, 0.82)";
    ctx.fillRect(0, 0, width, height);

    drawPanel(ctx, panel, { fill: "rgba(6, 13, 12, 0.97)", stroke: "rgba(0, 255, 136, 0.4)" });
    ctx.fillStyle = "rgba(0, 255, 136, 0.1)";
    ctx.fillRect(panel.x, panel.y, panel.w, 46);
    ctx.font = FONT(18, 700);
    ctx.textAlign = "left";
    fillTextShadow(ctx, "SYSTEM CONFIG", panel.x + 20, panel.y + 30, UI.green);
    ctx.font = FONT(11, 600);
    fillTextShadow(ctx, "LOCAL TERMINAL", panel.x + panel.w - 124, panel.y + 30, "rgba(175, 215, 198, 0.5)");

    // Volume.
    ctx.font = FONT(13, 700);
    fillTextShadow(ctx, "AUDIO MASTER", panel.x + 36, panel.y + 96, UI.text);
    ctx.textAlign = "right";
    ctx.font = FONT(15, 700);
    fillTextShadow(ctx, `${Math.round(SETTINGS.volume * 100)}%`, panel.x + panel.w - 36, panel.y + 96, UI.green);
    ctx.textAlign = "left";

    const volume = layout.volume;
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.fillRect(volume.x, volume.y, volume.w, volume.h);
    ctx.fillStyle = "rgba(0, 255, 136, 0.7)";
    ctx.fillRect(volume.x, volume.y, volume.w * SETTINGS.volume, volume.h);
    ctx.fillStyle = "#eafff3";
    const knobX = volume.x + volume.w * SETTINGS.volume;
    ctx.fillRect(knobX - 2, volume.y - 5, 4, volume.h + 10);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.5)";
    ctx.strokeRect(volume.x + 0.5, volume.y + 0.5, volume.w - 1, volume.h - 1);

    // Screen shake toggle.
    ctx.font = FONT(13, 700);
    fillTextShadow(ctx, "SCREEN SHAKE", panel.x + 36, panel.y + 172, UI.text);
    drawButton(ctx, layout.shakeToggle, SETTINGS.screenShake ? "ENABLED" : "DISABLED", {
      hover: this.hover.hovered === "shake",
      active: SETTINGS.screenShake,
      center: true,
      size: 11,
    });

    ctx.font = FONT(12, 500);
    fillTextShadow(
      ctx,
      "Accessibility: disabling shake keeps all other feedback intact.",
      panel.x + 36,
      panel.y + 246,
      "rgba(175, 215, 198, 0.5)",
    );

    drawButton(ctx, layout.back, "BACK  //  ESC", { hover: this.hover.hovered === "back", center: true });
  }
}
