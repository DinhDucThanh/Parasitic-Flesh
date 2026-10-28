import type { SfxSynth } from "../assets/SfxSynth";
import { HOST_SPECS, Host, type HostKind } from "../entities/Host";
import { drawHost, rgba } from "../render/ProceduralArt";
import { INCIDENT_LOGS, type LoreLog } from "../world/Lore";
import {
  FONT,
  HoverTracker,
  UI,
  drawButton,
  drawCrtLines,
  drawKeycap,
  drawParagraph,
  drawPanel,
  fillTextShadow,
  inRect,
  type Rect,
  type UiInput,
} from "./theme";

export type CodexTab = 0 | 1 | 2 | 3 | 4;

const TAB_LABELS = ["CONTROLS", "BIOLOGY", "SPECIMENS", "GRAFTING", "INCIDENT LOGS"];

const KIND_COLOR: Record<HostKind, string> = {
  security: "#6da4dd",
  enforcer: "#e6c455",
  mutant: "#ff7079",
};

/**
 * Bio-Terminal. Deliberately readable: large type, short lines, specimen cards
 * with only a class, a lifespan dial, one weapon sentence and one trait tag.
 * No stat sheets, no pixel-per-second readouts.
 */
export class CodexUI {
  private tab: CodexTab = 0;
  private readonly hover = new HoverTracker();
  /** One inert host per kind, posed each frame for the containment previews. */
  private readonly previews = new Map<HostKind, Host>();

  constructor(
    private readonly sfx: SfxSynth,
    private readonly getLore: () => LoreLog,
  ) {}

  open(tab: CodexTab = this.tab): void {
    this.tab = tab;
    this.hover.reset();
    this.sfx.startHum();
  }

  close(): void {
    this.sfx.stopHum();
  }

  handle(ui: UiInput): "close" | null {
    const { input, width, height, sfx } = ui;
    const layout = this.layout(width, height);

    let hovered: string | null = null;
    layout.tabs.forEach((rect, index) => {
      if (inRect(input.mouse, rect)) hovered = `tab-${index}`;
    });
    if (inRect(input.mouse, layout.close)) hovered = "close";
    this.hover.update(hovered, sfx);

    for (let index = 0; index < 5; index += 1) {
      if (input.wasPressed(`Digit${index + 1}`) || input.wasPressed(`Numpad${index + 1}`)) {
        this.setTab(index as CodexTab, sfx);
      }
    }

    if (!input.leftPressed) return null;

    for (let index = 0; index < layout.tabs.length; index += 1) {
      if (inRect(input.mouse, layout.tabs[index] as Rect)) {
        this.setTab(index as CodexTab, sfx);
        return null;
      }
    }
    if (inRect(input.mouse, layout.close)) {
      sfx.play("uiClick");
      return "close";
    }
    return null;
  }

  private setTab(tab: CodexTab, sfx: SfxSynth): void {
    if (this.tab === tab) return;
    this.tab = tab;
    sfx.play("uiClick");
  }

  private layout(width: number, height: number): {
    panel: Rect;
    tabs: Rect[];
    content: Rect;
    close: Rect;
  } {
    const pad = 26;
    const panel = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };
    const tabs: Rect[] = [];
    const tabX = pad + 18;
    const tabY = 116;
    const tabW = Math.min(244, Math.max(200, width * 0.17));
    for (let i = 0; i < 5; i += 1) {
      tabs.push({ x: tabX, y: tabY + i * 56, w: tabW, h: 46 });
    }
    const contentX = tabX + tabW + 28;
    const content = {
      x: contentX,
      y: 104,
      w: width - contentX - pad - 20,
      h: height - 104 - pad - 54,
    };
    const close = { x: width - pad - 188, y: height - pad - 46, w: 168, h: 36 };
    return { panel, tabs, content, close };
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
    const layout = this.layout(width, height);
    const lore = this.getLore();

    ctx.fillStyle = "rgba(3, 6, 9, 0.86)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(9, 12, 16, 0.98)";
    ctx.fillRect(layout.panel.x, layout.panel.y, layout.panel.w, layout.panel.h);

    ctx.strokeStyle = "rgba(0, 255, 136, 0.26)";
    ctx.lineWidth = 1;
    ctx.strokeRect(layout.panel.x + 0.5, layout.panel.y + 0.5, layout.panel.w - 1, layout.panel.h - 1);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.08)";
    ctx.strokeRect(layout.panel.x + 6.5, layout.panel.y + 6.5, layout.panel.w - 13, layout.panel.h - 13);

    // Header.
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = FONT(26, 700);
    fillTextShadow(ctx, "BIO-TERMINAL", layout.panel.x + 20, layout.panel.y + 44, UI.green, 2);
    ctx.font = FONT(12, 500);
    fillTextShadow(
      ctx,
      "INCIDENT ARCHIVE  //  CLEARANCE: SPORE",
      layout.panel.x + 20,
      layout.panel.y + 64,
      "rgba(175, 215, 198, 0.5)",
    );

    ctx.textAlign = "right";
    ctx.font = FONT(13, 700);
    fillTextShadow(
      ctx,
      `ARCHIVE ${String(lore.unlockedCount).padStart(2, "0")}/${String(INCIDENT_LOGS.length).padStart(2, "0")}`,
      layout.panel.x + layout.panel.w - 20,
      layout.panel.y + 44,
      "rgba(0, 255, 136, 0.65)",
    );
    const blink = Math.sin(time * 3.4) > 0;
    ctx.font = FONT(12, 600);
    fillTextShadow(
      ctx,
      blink ? "● LINK ACTIVE" : "○ LINK ACTIVE",
      layout.panel.x + layout.panel.w - 20,
      layout.panel.y + 64,
      blink ? "rgba(0, 255, 136, 0.7)" : "rgba(0, 255, 136, 0.3)",
    );
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(0, 255, 136, 0.2)";
    ctx.fillRect(layout.panel.x + 20, layout.panel.y + 82, layout.panel.w - 40, 1);

    // Navigation.
    layout.tabs.forEach((rect, index) => {
      const active = index === this.tab;
      drawButton(ctx, rect, `${index + 1}  ${TAB_LABELS[index]}`, {
        active,
        hover: this.hover.hovered === `tab-${index}`,
        size: 14,
      });
      if (active) {
        ctx.fillStyle = UI.green;
        ctx.fillRect(rect.x + rect.w - 3, rect.y, 3, rect.h);
      }
    });

    // Content.
    const content = layout.content;
    ctx.save();
    ctx.beginPath();
    ctx.rect(content.x, content.y, content.w, content.h);
    ctx.clip();

    ctx.font = FONT(24, 700);
    fillTextShadow(ctx, TAB_LABELS[this.tab] ?? "", content.x, content.y + 24, "#effff7", 2);
    ctx.fillStyle = "rgba(0, 255, 136, 0.24)";
    ctx.fillRect(content.x, content.y + 38, content.w, 1);

    const bodyY = content.y + 60;
    const bodyH = content.h - 60;
    switch (this.tab) {
      case 0:
        this.renderControls(ctx, content.x, bodyY, content.w, bodyH);
        break;
      case 1:
        this.renderBiology(ctx, content.x, bodyY, content.w, bodyH);
        break;
      case 2:
        this.renderSpecimens(ctx, content.x, bodyY, content.w, bodyH, time);
        break;
      case 3:
        this.renderGrafting(ctx, content.x, bodyY, content.w, bodyH);
        break;
      default:
        this.renderLogs(ctx, content.x, bodyY, content.w, bodyH, lore);
        break;
    }
    ctx.restore();

    // Footer.
    ctx.font = FONT(12, 600);
    fillTextShadow(ctx, "1–5 NAVIGATE", layout.panel.x + 20, height - layout.panel.y - 24, "rgba(175, 215, 198, 0.45)");
    ctx.textAlign = "right";
    fillTextShadow(
      ctx,
      "TAB / ESC  //  RETURN TO SIMULATION",
      layout.close.x - 20,
      height - layout.panel.y - 24,
      "rgba(0, 255, 136, 0.55)",
    );
    ctx.textAlign = "left";
    drawButton(ctx, layout.close, "RETURN  //  ESC", {
      hover: this.hover.hovered === "close",
      size: 13,
      center: true,
    });

    drawCrtLines(ctx, layout.panel.x, layout.panel.y, layout.panel.w, layout.panel.h);
    ctx.fillStyle = `rgba(0, 255, 136, ${0.01 + Math.sin(time * 12.3) * 0.005})`;
    ctx.fillRect(layout.panel.x, layout.panel.y, layout.panel.w, layout.panel.h);
  }

  private renderControls(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    // Movement cluster.
    const key = 46;
    const kx = x + 66;
    const ky = y + 24;
    drawKeycap(ctx, kx + key + 7, ky, key, key, "W", true);
    drawKeycap(ctx, kx, ky + key + 7, key, key, "A");
    drawKeycap(ctx, kx + key + 7, ky + key + 7, key, key, "S");
    drawKeycap(ctx, kx + (key + 7) * 2, ky + key + 7, key, key, "D");

    ctx.textAlign = "center";
    ctx.font = FONT(12, 700);
    fillTextShadow(ctx, "MOVE THE ACTIVE BODY", kx + key + 3, ky + key * 2 + 38, "rgba(175, 215, 198, 0.55)");
    ctx.font = FONT(11, 500);
    fillTextShadow(ctx, "ARROWS ALSO WORK", kx + key + 3, ky + key * 2 + 56, "rgba(175, 215, 198, 0.35)");
    ctx.textAlign = "left";

    const listX = x + Math.min(280, w * 0.36);
    const listW = w - (listX - x);

    const rows: Array<[string, string]> = [
      ["MOUSE", "AIM"],
      ["LMB", "FIRE HOST WEAPON"],
      ["HOLD RMB", "SLOW TIME + AIM"],
      ["RELEASE RMB", "HIJACK / EJECT + DETONATE"],
      ["TAB / ESC", "OPEN BIO-TERMINAL"],
      ["R", "RETRY"],
    ];

    rows.forEach(([bind, action], index) => {
      const rowY = y + 22 + index * 62;
      if (index % 2 === 0) {
        ctx.fillStyle = "rgba(0, 255, 136, 0.03)";
        ctx.fillRect(listX, rowY - 22, listW, 54);
      }
      ctx.font = FONT(12, 700);
      fillTextShadow(ctx, bind, listX + 14, rowY, UI.green);
      ctx.font = FONT(15, 500);
      fillTextShadow(ctx, action, listX + 14, rowY + 22, UI.text);
    });

    ctx.fillStyle = "rgba(255, 61, 61, 0.1)";
    ctx.fillRect(x, y + h - 34, w, 26);
    ctx.font = FONT(12, 600);
    fillTextShadow(
      ctx,
      "ONE HIT OUTSIDE A BODY IS FINAL.",
      x + 12,
      y + h - 16,
      "rgba(255, 120, 120, 0.8)",
    );
  }

  private renderBiology(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const cards: Array<[string, string]> = [
      ["THE SPORE", "One touch outside a body ends the run. Move like it."],
      ["BULLET-TIME", "Hold RMB. The world crawls; your aim does not."],
      ["HIJACK", "Release inside the green cone. Take the body whole."],
      ["DECAY", "Every body is a fuse. The clock never slows."],
      ["COLLAPSE", "With seconds left, the body starts to reject you."],
      ["DETONATION", "Leave a body and it becomes a bomb."],
    ];
    const gap = 16;
    const colW = (w - gap) / 2;
    const rowH = Math.min(132, (h - 20) / 3);
    cards.forEach(([title, body], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const cx = x + col * (colW + gap);
      const cy = y + row * (rowH + 10);
      drawPanel(ctx, { x: cx, y: cy, w: colW, h: rowH }, { fill: "rgba(0, 255, 136, 0.025)" });
      ctx.fillStyle = "rgba(0, 255, 136, 0.5)";
      ctx.fillRect(cx, cy, 2, rowH);
      ctx.font = FONT(17, 700);
      fillTextShadow(ctx, title, cx + 16, cy + 28, "#effff7");
      ctx.font = FONT(14, 400);
      drawParagraph(ctx, body, cx + 16, cy + 46, colW - 32, 20, "rgba(207, 238, 221, 0.78)");
    });
  }

  /** Cached inert host used only for the card previews. */
  private previewHost(kind: HostKind): Host {
    let host = this.previews.get(kind);
    if (!host) {
      host = new Host(kind, 0, 0);
      host.aiEnabled = false;
      this.previews.set(kind, host);
    }
    return host;
  }

  /**
   * The specimen frame renders the SAME procedural model the arena uses, with
   * a slow weapon sweep and breathing bob so the containment readout is alive.
   */
  private renderSpecimenModel(
    ctx: CanvasRenderingContext2D,
    kind: HostKind,
    x: number,
    y: number,
    scale: number,
    time: number,
    index: number,
  ): void {
    const host = this.previewHost(kind);
    host.position.x = 0;
    host.position.y = 0;
    host.facing = -Math.PI / 2 + Math.sin(time * 0.6 + index * 1.7) * 0.5;
    host.walkPhase = time * 2.1 + index;
    host.moving = 0.1 + (Math.sin(time * 1.5 + index) + 1) * 0.05;
    host.recoil = 0;
    host.muzzle = 0;
    host.flash = 0;
    host.corruption = 0;
    host.possessed = false;
    host.dashTime = 0;
    host.windup = 0;
    host.aimLaser = 0;
    host.shieldFlash = Math.max(0, Math.sin(time * 1.1 + index)) * 0.35;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    drawHost(ctx, host, time);
    ctx.restore();
  }

  private renderSpecimens(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    time: number,
  ): void {
    const kinds: HostKind[] = ["security", "enforcer", "mutant"];
    const gap = 16;
    const colW = (w - gap * 2) / 3;
    const cardH = Math.min(h - 4, 430);
    const pad = Math.max(12, Math.min(20, colW * 0.09));
    /** Shrink a single line until it fits the card column. */
    const fit = (text: string, maxW: number, size: number, weight: number, min: number): number => {
      let next = size;
      ctx.font = FONT(next, weight);
      while (next > min && ctx.measureText(text).width > maxW) {
        next -= 1;
        ctx.font = FONT(next, weight);
      }
      return next;
    };

    kinds.forEach((kind, index) => {
      const spec = HOST_SPECS[kind];
      const color = KIND_COLOR[kind];
      const cx = x + index * (colW + gap);
      const cy = y + 2;
      const innerW = colW - pad * 2;
      drawPanel(ctx, { x: cx, y: cy, w: colW, h: cardH }, { fill: "rgba(6, 13, 16, 0.92)", stroke: "rgba(255,255,255,0.07)" });
      ctx.fillStyle = color;
      ctx.fillRect(cx, cy, colW, 3);
      ctx.fillRect(cx, cy, 3, cardH);

      // Header: name and class only.
      ctx.textAlign = "left";
      ctx.font = FONT(fit(spec.name, innerW, 21, 700, 13), 700);
      fillTextShadow(ctx, spec.name, cx + pad, cy + 36, "#effff7");
      ctx.font = FONT(fit(`[ ${spec.classTag} ]`, innerW, 12, 700, 9), 700);
      fillTextShadow(ctx, `[ ${spec.classTag} ]`, cx + pad, cy + 58, color);

      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(cx + pad, cy + 72, innerW, 1);

      // Containment frame: the LIVE in-game model idles inside a scanner ring.
      const frameR = Math.max(46, Math.min(72, colW * 0.38));
      const frameX = cx + colW / 2;
      const frameY = cy + 82 + frameR;
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.beginPath();
      ctx.arc(frameX, frameY, frameR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(color, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(frameX, frameY, frameR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(color, 0.28);
      ctx.lineWidth = 2;
      const sweep = time * 0.9 + index * 2.1;
      ctx.beginPath();
      ctx.arc(frameX, frameY, frameR, sweep, sweep + 0.7);
      ctx.stroke();
      ctx.restore();

      this.renderSpecimenModel(
        ctx,
        kind,
        frameX,
        frameY + 3,
        Math.max(1.45, Math.min(1.8, frameR / 30)),
        time,
        index,
      );

      // Lifespan badge on the frame's edge: one big number, no stat rows.
      const badgeR = Math.max(21, Math.min(27, frameR * 0.42));
      const badgeX = frameX + frameR * 0.72;
      const badgeY = frameY - frameR * 0.72;
      ctx.save();
      ctx.fillStyle = "rgba(4, 10, 10, 0.95)";
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR - 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = FONT(Math.round(badgeR * 0.82), 700);
      fillTextShadow(ctx, String(spec.lifespan), badgeX, badgeY - 2, "#effff7", 1);
      ctx.font = FONT(7, 700);
      fillTextShadow(ctx, "SEC", badgeX, badgeY + badgeR * 0.46, color, 1);
      ctx.restore();

      // One-sentence weapon line.
      const weaponLabelY = frameY + frameR + 24;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = FONT(9, 700);
      fillTextShadow(ctx, "PRIMARY WEAPON", cx + pad, weaponLabelY, "rgba(175, 215, 198, 0.45)");
      ctx.font = FONT(13, 500);
      drawParagraph(ctx, spec.weaponBlurb, cx + pad, weaponLabelY + 14, innerW, 17, "rgba(220, 245, 235, 0.85)");

      // Single signature trait tag anchored to the card footer.
      const tagH = 42;
      const tagY = cy + cardH - tagH - 16;
      ctx.font = FONT(9, 700);
      fillTextShadow(ctx, "SIGNATURE TRAIT", cx + pad, tagY - 8, "rgba(175, 215, 198, 0.45)");
      ctx.fillStyle = "rgba(0, 255, 136, 0.06)";
      roundedPanel(ctx, cx + pad, tagY, innerW, tagH, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 255, 136, 0.24)";
      ctx.lineWidth = 1;
      roundedPanel(ctx, cx + pad, tagY, innerW, tagH, 3);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = FONT(fit(spec.trait, innerW - 16, 13, 700, 9), 700);
      fillTextShadow(ctx, spec.trait, cx + colW / 2, tagY + tagH / 2 + 1, "#b6ffd9", 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    });
  }

  private renderGrafting(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.font = FONT(15, 400);
    const introY = drawParagraph(
      ctx,
      "When the spore leaves a body, it tears free with one signature trait attached. The next host keeps it. Chain bodies to build a worse animal.",
      x,
      y + 2,
      w,
      22,
      "rgba(220, 245, 235, 0.82)",
    );

    const rows: Array<[HostKind, string]> = [
      ["security", "SHOULDER SIDEARM"],
      ["enforcer", "DORSAL PLATING"],
      ["mutant", "ACID STRIDE"],
    ];
    let rowY = introY + 22;
    const rowH = Math.min(104, (h - (rowY - y) - 12) / 3);
    for (const [kind, title] of rows) {
      const spec = HOST_SPECS[kind];
      const color = KIND_COLOR[kind];
      drawPanel(ctx, { x, y: rowY, w, h: rowH }, { fill: "rgba(0, 255, 136, 0.022)", stroke: "rgba(255,255,255,0.06)" });
      ctx.fillStyle = color;
      ctx.fillRect(x, rowY, 3, rowH);

      ctx.font = FONT(12, 700);
      fillTextShadow(ctx, spec.name, x + 20, rowY + 24, color);
      ctx.font = FONT(19, 700);
      fillTextShadow(ctx, title, x + 20, rowY + 50, "#effff7");
      ctx.font = FONT(14, 400);
      drawParagraph(ctx, spec.graftBlurb, x + 20, rowY + 72, w - 40, 20, "rgba(220, 245, 235, 0.7)");
      rowY += rowH + 8;
    }
  }

  private renderLogs(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    lore: LoreLog,
  ): void {
    const leftW = w * 0.55;
    const rightX = x + leftW + 26;
    const rightW = w - leftW - 26;

    ctx.font = FONT(12, 700);
    fillTextShadow(ctx, "RECOVERED INCIDENT LOGS", x, y + 8, "rgba(0, 255, 136, 0.55)");
    fillTextShadow(ctx, "HOST WHISPERS", rightX, y + 8, "rgba(0, 255, 136, 0.55)");

    let logY = y + 30;
    for (let index = 0; index < INCIDENT_LOGS.length; index += 1) {
      const entry = INCIDENT_LOGS[index];
      if (!entry) continue;
      if (logY > y + h - 18) break;
      const unlocked = lore.isUnlocked(entry.id);
      ctx.font = FONT(14, 700);
      fillTextShadow(
        ctx,
        `${String(index + 1).padStart(2, "0")}  ${unlocked ? entry.title : "████ ENCRYPTED ████"}`,
        x,
        logY,
        unlocked ? "#effff7" : "rgba(175, 215, 198, 0.26)",
      );
      if (unlocked) {
        ctx.font = FONT(13, 400);
        logY = drawParagraph(ctx, entry.body, x, logY + 16, leftW - 8, 18, "rgba(207, 238, 221, 0.68)") + 14;
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        ctx.fillRect(x, logY + 16, leftW * 0.72, 9);
        ctx.font = FONT(11, 700);
        fillTextShadow(ctx, "REQUIRES FIELD DATA", x + leftW * 0.72 + 12, logY + 25, "rgba(255, 61, 61, 0.45)");
        logY += 44;
      }
    }

    ctx.fillStyle = "rgba(0, 255, 136, 0.12)";
    ctx.fillRect(rightX - 14, y + 24, 1, h - 38);

    if (lore.transcripts.length === 0) {
      ctx.font = FONT(14, 400);
      drawParagraph(
        ctx,
        "No memories recovered. Hijack a body and listen; the dead keep talking for a moment.",
        rightX,
        y + 40,
        rightW,
        21,
        "rgba(175, 215, 198, 0.55)",
      );
      return;
    }

    let ty = y + 34;
    for (const line of lore.transcripts.slice(0, 7)) {
      if (ty > y + h - 40) break;
      ctx.font = FONT(11, 700);
      fillTextShadow(ctx, HOST_SPECS[line.kind].name, rightX, ty, KIND_COLOR[line.kind]);
      ctx.font = FONT(14, 400);
      ty = drawParagraph(ctx, `“${line.text}”`, rightX, ty + 16, rightW, 19, "rgba(220, 245, 235, 0.8)") + 16;
    }
  }
}

function roundedPanel(
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
