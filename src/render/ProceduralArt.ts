import { COLORS } from "../core/config";
import { FONT, fillTextShadow } from "../core/fonts";
import { TAU, clamp, easeOutCubic, type Vec2 } from "../core/math";
import type { Host } from "../entities/Host";
import type { Spore } from "../entities/Spore";
import type { TrainingTarget } from "../entities/Target";
import type { Explosion, Hazard, Particle } from "../systems/Effects";
import type { Projectile } from "../systems/Projectile";

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

function hostPalette(host: Host): { body: string; accent: string } {
  if (host.kind === "security") return { body: COLORS.security, accent: COLORS.securityLight };
  if (host.kind === "enforcer") return { body: COLORS.enforcer, accent: COLORS.enforcerLight };
  return { body: COLORS.mutant, accent: COLORS.mutantLight };
}

/** Undulating amoebic blob: displaced polygon + radial glow. */
export function drawSpore(ctx: CanvasRenderingContext2D, spore: Spore, time: number): void {
  // The hitbox is deliberately tiny (7px); the silhouette is drawn larger so
  // the player can actually see and read their own body.
  const r = spore.radius * 1.75;
  const pulse = 1 + Math.sin(time * 3.1) * 0.07;

  ctx.save();
  ctx.translate(spore.position.x, spore.position.y);

  const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 6);
  glow.addColorStop(0, "rgba(0, 255, 136, 0.32)");
  glow.addColorStop(0.45, "rgba(0, 255, 136, 0.1)");
  glow.addColorStop(1, "rgba(0, 255, 136, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, r * 6, 0, TAU);
  ctx.fill();

  // Amoeba silhouette.
  const points = 20;
  ctx.beginPath();
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * TAU;
    const wobble =
      1 +
      0.2 * Math.sin(angle * 3 + time * 5.2) +
      0.13 * Math.sin(angle * 5 - time * 3.6) +
      0.07 * Math.sin(angle * 7 + time * 7.3);
    const radius = r * wobble * pulse;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const body = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.25);
  body.addColorStop(0, "#e9fff6");
  body.addColorStop(0.35, COLORS.spore);
  body.addColorStop(1, "#036b40");
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(180, 255, 220, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Nucleus + organelles.
  ctx.fillStyle = "rgba(230, 255, 245, 0.7)";
  ctx.beginPath();
  ctx.arc(r * 0.1, -r * 0.05, r * 0.34, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(2, 70, 44, 0.55)";
  for (let i = 0; i < 3; i += 1) {
    const a = time * 1.4 + (i / 3) * TAU;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.12, 0, TAU);
    ctx.fill();
  }

  // Crawling cilia.
  ctx.strokeStyle = "rgba(0, 255, 136, 0.4)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * TAU + time * 0.5;
    const inner = r * 1.05;
    const outer = r * (1.55 + 0.3 * Math.sin(time * 4 + i));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a + 0.1) * outer, Math.sin(a + 0.1) * outer);
    ctx.stroke();
  }

  if (spore.state === "aiming" || spore.state === "ejectAim") {
    ctx.strokeStyle = "rgba(0, 255, 136, 0.7)";
    ctx.lineWidth = 1.4;
    const ring = r * 2 + Math.sin(time * 8) * 2;
    ctx.beginPath();
    ctx.arc(0, 0, ring, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawHost(ctx: CanvasRenderingContext2D, host: Host, time: number): void {
  const r = host.radius;
  const palette = hostPalette(host);
  const walking = clamp(host.moving, 0, 1);

  // Ground shadow, unrotated.
  ctx.save();
  ctx.translate(host.position.x, host.position.y);
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 1.05, r * 0.55, 0, 0, TAU);
  ctx.fill();

  // White i-frame shell: the hit landed, but the clock is briefly frozen.
  if (host.damageGrace > 0) {
    ctx.strokeStyle = `rgba(235, 255, 245, ${0.2 + host.graceFraction * 0.45})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r + 4 + (1 - host.graceFraction) * 5, 0, TAU);
    ctx.stroke();
  } else if (host.bioShield > 0) {
    // Arrival shield: a single pale chevron, gone after the first absorbed hit.
    ctx.strokeStyle = "rgba(190, 255, 225, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, -2.3, -0.84);
    ctx.stroke();
  }

  if (host.possessed) {
    const aura = 0.22 + Math.sin(time * 6) * 0.08;
    const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 3);
    glow.addColorStop(0, rgba(COLORS.spore, aura));
    glow.addColorStop(1, rgba(COLORS.spore, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 3, 0, TAU);
    ctx.fill();

    // Rootlet tendrils locking the spore into the body.
    ctx.strokeStyle = rgba(COLORS.spore, 0.5);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i += 1) {
      const base = (i / 6) * TAU + Math.sin(time * 2 + i) * 0.25;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(
        Math.cos(base + 0.4) * r * 1.3,
        Math.sin(base + 0.4) * r * 1.3,
        Math.cos(base) * (r * 1.8 + Math.sin(time * 5 + i) * 2.5),
        Math.sin(base) * (r * 1.8 + Math.sin(time * 5 + i) * 2.5),
      );
      ctx.stroke();
    }
  }

  ctx.rotate(host.facing);
  const bob = Math.sin(host.walkPhase * 2) * 1.4 * walking;
  ctx.translate(-host.recoil * 2.6, bob);

  if (host.kind === "security") drawSecurity(ctx, host, palette.body, palette.accent, time);
  else if (host.kind === "enforcer") drawEnforcer(ctx, host, palette.body, palette.accent, time);
  else drawMutant(ctx, host, palette.body, palette.accent, time);

  // Flesh corruption veins spreading as the decay clock empties.
  if (host.corruption > 0.02) drawCorruption(ctx, host, time);

  // Damage flash.
  if (host.flash > 0.01) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255, 235, 235, ${host.flash * 0.5})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.05, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.restore();
}

function drawSecurity(
  ctx: CanvasRenderingContext2D,
  host: Host,
  body: string,
  accent: string,
  time: number,
): void {
  const r = host.radius;
  const swing = Math.sin(host.walkPhase * 2) * 4 * clamp(host.moving, 0, 1);

  // Legs first so they sit behind the torso.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(-r * 0.15 + swing * side, side * r * 0.6);
    ctx.rotate(side * 0.1);
    ctx.fillStyle = "#18212c";
    roundedRect(ctx, -5, -3.2, 12, 6.4, 3);
    ctx.fill();
    ctx.fillStyle = rgba(accent, 0.5);
    ctx.fillRect(4, -2.4, 2.2, 4.8);
    ctx.restore();
  }

  // Torso.
  const torso = ctx.createRadialGradient(-r * 0.35, -r * 0.3, r * 0.2, 0, 0, r);
  torso.addColorStop(0, rgba(accent, 0.95));
  torso.addColorStop(0.45, body);
  torso.addColorStop(1, "#0d1826");
  ctx.fillStyle = torso;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(5, 12, 20, 0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Visor / helmet.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, -1.05, 1.05);
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 0.18);
  ctx.beginPath();
  ctx.arc(r * 0.18, 0, r * 0.5, -0.9, 0.9);
  ctx.closePath();
  ctx.fill();

  // Rifle.
  const recoilOffset = -host.recoil * 3;
  ctx.save();
  ctx.translate(recoilOffset, 0);
  ctx.fillStyle = "#11171f";
  roundedRect(ctx, r * 0.2, -2.6, r + 10, 5.2, 2);
  ctx.fill();
  ctx.fillStyle = "#2b3947";
  ctx.fillRect(r + 4, -1.4, 10, 2.8);
  ctx.fillStyle = accent;
  ctx.fillRect(r * 0.72, -3.8, 4, 7.6);
  // Arms.
  ctx.strokeStyle = rgba(accent, 0.55);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-1, -r * 0.5);
  ctx.lineTo(r * 0.55, -r * 0.2);
  ctx.moveTo(-1, r * 0.5);
  ctx.lineTo(r * 0.4, r * 0.35);
  ctx.stroke();
  ctx.restore();

  drawMuzzleFlash(ctx, host, r + 16, 8, "#ffd9a0");
  if (host.windup > 0 && host.aimLaser > 0) drawWindupGlow(ctx, r, host.windup, time);
}

function drawEnforcer(
  ctx: CanvasRenderingContext2D,
  host: Host,
  body: string,
  accent: string,
  time: number,
): void {
  const r = host.radius;
  const swing = Math.sin(host.walkPhase * 1.6) * 2.4 * clamp(host.moving, 0, 1);

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(-r * 0.2 + swing * side, side * r * 0.72);
    ctx.fillStyle = "#161b21";
    roundedRect(ctx, -7, -4.4, 15, 8.8, 3.5);
    ctx.fill();
    ctx.restore();
  }

  // Heavy square torso.
  const torso = ctx.createLinearGradient(-r, -r, r, r);
  torso.addColorStop(0, "#5d646d");
  torso.addColorStop(0.5, body);
  torso.addColorStop(1, "#252b32");
  ctx.fillStyle = torso;
  roundedRect(ctx, -r * 0.85, -r * 0.85, r * 1.7, r * 1.7, 6);
  ctx.fill();
  ctx.strokeStyle = "#12161b";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Chest plating + bolt rims.
  ctx.strokeStyle = rgba(accent, 0.35);
  ctx.lineWidth = 1.4;
  roundedRect(ctx, -r * 0.55, -r * 0.6, r * 1.05, r * 1.2, 4);
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 0.5);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(-r * 0.42, side * r * 0.42, 1.9, 0, TAU);
    ctx.fill();
  }

  // Shoulder pads.
  ctx.fillStyle = "#39414a";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, side * r * 0.82, r * 0.4, r * 0.3, 0, 0, TAU);
    ctx.fill();
  }

  // Shotgun.
  const recoilOffset = -host.recoil * 4;
  ctx.save();
  ctx.translate(recoilOffset, 0);
  ctx.fillStyle = "#0e1216";
  roundedRect(ctx, r * 0.2, -3.6, r + 16, 7.2, 2.5);
  ctx.fill();
  ctx.fillStyle = "#39424c";
  ctx.fillRect(r + 2, -2.4, 13, 4.8);
  ctx.strokeStyle = rgba(accent, 0.7);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(r * 0.55, -5);
  ctx.lineTo(r * 0.55, 5);
  ctx.stroke();
  ctx.restore();

  // Frontal riot shield.
  const shieldGlow = host.shieldFlash;
  ctx.save();
  ctx.translate(r * 0.98, 0);
  ctx.rotate(Math.sin(time * 2.2) * 0.02);
  ctx.fillStyle = "#3c3320";
  roundedRect(ctx, -4, -r * 1.05, 9, r * 2.1, 4);
  ctx.fill();
  ctx.strokeStyle = shieldGlow > 0.05 ? "#fff2b0" : COLORS.shield;
  ctx.lineWidth = 2.4;
  roundedRect(ctx, -4, -r * 1.05, 9, r * 2.1, 4);
  ctx.stroke();
  // Hazard bands.
  ctx.save();
  roundedRect(ctx, -3, -r, 7, r * 2, 3);
  ctx.clip();
  ctx.strokeStyle = rgba(COLORS.shield, 0.55);
  ctx.lineWidth = 3;
  for (let y = -r * 1.4; y < r * 1.4; y += 11) {
    ctx.beginPath();
    ctx.moveTo(-6, y);
    ctx.lineTo(6, y + 8);
    ctx.stroke();
  }
  ctx.restore();
  if (shieldGlow > 0.05) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255, 240, 190, ${shieldGlow * 0.5})`;
    roundedRect(ctx, -5, -r * 1.1, 11, r * 2.2, 5);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();

  // Grafted dorsal plate (rear shield).
  if (host.grafts.has("dorsalShield")) {
    ctx.fillStyle = "#2d4a38";
    roundedRect(ctx, -r - 6, -r * 0.85, 8, r * 1.7, 4);
    ctx.fill();
    ctx.strokeStyle = rgba(COLORS.spore, 0.8);
    ctx.lineWidth = 1.8;
    roundedRect(ctx, -r - 6, -r * 0.85, 8, r * 1.7, 4);
    ctx.stroke();
  }

  drawMuzzleFlash(ctx, host, r + 22, 15, "#ffe0a0");
  if (host.windup > 0 && host.aimLaser > 0) drawWindupGlow(ctx, r, host.windup, time);
}

function drawMutant(
  ctx: CanvasRenderingContext2D,
  host: Host,
  body: string,
  accent: string,
  time: number,
): void {
  const r = host.radius;
  const twitch = Math.sin(time * 13) * 0.6;
  const dashing = host.isDashing;
  const recovering = host.lungePhase === "recover";
  // Coil: compress forward, swell upward as the legs load.
  const coil = host.lungePhase === "windup" ? clamp(1 - host.windup / 0.45, 0, 1) : 0;

  ctx.save();
  if (dashing) ctx.scale(1.22, 0.82);
  else if (coil > 0) ctx.scale(1 - coil * 0.2, 1 + coil * 0.26);
  if (recovering) {
    // Slumped, quivering exhaustion pose.
    ctx.translate(-r * 0.12, 0);
    ctx.rotate(Math.sin(time * 26) * 0.022);
  }

  // Splayed limbs.
  ctx.strokeStyle = "#5d151d";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    const swing = Math.sin(host.walkPhase * 2.4 + (side > 0 ? Math.PI : 0)) * 6 * clamp(host.moving, 0, 1);
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, side * r * 0.5);
    ctx.lineTo(r * 0.15 + swing, side * r * 1.15);
    ctx.stroke();
  }
  ctx.lineCap = "butt";

  // Jagged diamond body.
  ctx.beginPath();
  ctx.moveTo(r * 1.25, 0);
  ctx.lineTo(r * 0.15, r * 0.85);
  ctx.lineTo(-r * 0.75, r * 0.35);
  ctx.lineTo(-r * 0.95, 0);
  ctx.lineTo(-r * 0.7, -r * 0.4);
  ctx.lineTo(r * 0.15, -r * 0.9);
  ctx.closePath();
  const flesh = ctx.createRadialGradient(r * 0.2, -r * 0.25, r * 0.15, 0, 0, r * 1.2);
  flesh.addColorStop(0, accent);
  flesh.addColorStop(0.45, body);
  flesh.addColorStop(1, "#490c14");
  ctx.fillStyle = flesh;
  ctx.fill();
  ctx.strokeStyle = "#26060b";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Spikes along the back.
  ctx.fillStyle = accent;
  for (let i = 0; i < 4; i += 1) {
    const a = -0.7 + i * 0.45 + twitch * 0.01;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
    ctx.lineTo(Math.cos(a + 0.06) * r * 1.15, Math.sin(a + 0.06) * r * 1.15);
    ctx.lineTo(Math.cos(a + 0.16) * r * 0.68, Math.sin(a + 0.16) * r * 0.68);
    ctx.closePath();
    ctx.fill();
  }

  // Claws. During recovery they hang low, broadcasting the punish window.
  const droop = recovering ? 0.62 + Math.sin(time * 4) * 0.05 : 0;
  ctx.strokeStyle = recovering ? "rgba(255, 165, 172, 0.7)" : "#ffc4c4";
  ctx.lineWidth = 2.2;
  for (const side of [-1, 1]) {
    const reach = r * (1.55 + (dashing ? 0.35 : 0));
    ctx.beginPath();
    ctx.moveTo(r * 0.35, side * r * 0.45);
    ctx.quadraticCurveTo(r * 1.1, side * r * 0.5, reach, side * r * (0.85 + droop));
    ctx.stroke();
  }

  // Eyes dim while stunned.
  ctx.fillStyle = recovering ? "rgba(255, 175, 180, 0.45)" : "#ffd3d6";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(r * 0.62, side * r * 0.2, 1.7, 0, TAU);
    ctx.fill();
  }

  // Motion-blur arcs during the burst, trailing behind the lunge vector.
  if (dashing) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i += 1) {
      ctx.strokeStyle = `rgba(255, 70, 90, ${0.3 - i * 0.08})`;
      ctx.lineWidth = 2.4 - i * 0.5;
      ctx.beginPath();
      ctx.arc(-r * (1.1 + i * 0.5), 0, r * (1.1 + i * 0.14), -0.9, 0.9);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  if (host.windup > 0) drawWindupGlow(ctx, r, host.windup, time);
  ctx.restore();
}

function drawMuzzleFlash(
  ctx: CanvasRenderingContext2D,
  host: Host,
  distance: number,
  size: number,
  color: string,
): void {
  if (host.muzzle <= 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(distance, 0);
  ctx.globalAlpha = clamp(host.muzzle, 0, 1);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.16);
  glow.addColorStop(0, "rgba(255, 255, 235, 0.95)");
  glow.addColorStop(0.4, rgba(color, 0.7));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, size * 1.16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#fffdf0";
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(size * 1.5, 0);
  ctx.lineTo(0, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Pulsing red wedge while an AI winds up a shot or a leap. */
function drawWindupGlow(ctx: CanvasRenderingContext2D, radius: number, windup: number, time: number): void {
  // Matches the 0.45s AI telegraph: the wedge fills as the shot approaches.
  const urgency = clamp(1 - windup / 0.45, 0, 1);
  const pulse = 0.25 + Math.sin(time * 22) * 0.1 + urgency * 0.25;
  ctx.strokeStyle = `rgba(255, 70, 70, ${pulse + 0.2})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 7, -0.6, 0.6);
  ctx.stroke();
}

function drawCorruption(ctx: CanvasRenderingContext2D, host: Host, time: number): void {
  const r = host.radius;
  const alpha = host.corruption;
  ctx.save();
  ctx.strokeStyle = `rgba(0, 255, 136, ${0.18 + alpha * 0.45})`;
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 5; i += 1) {
    const base = (i / 5) * TAU + 0.4;
    let x = Math.cos(base) * r * 0.2;
    let y = Math.sin(base) * r * 0.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let seg = 0; seg < 3; seg += 1) {
      const a = base + Math.sin(time * 2 + i + seg) * 0.4;
      x += Math.cos(a) * r * 0.28;
      y += Math.sin(a) * r * 0.28;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Ichor spots.
  ctx.fillStyle = `rgba(20, 60, 40, ${alpha * 0.55})`;
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + time * 0.2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.12, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Decay arc around the worn body plus the numeric bar above its head. */
export function drawHostStatus(ctx: CanvasRenderingContext2D, host: Host, time: number): void {
  if (!host.possessed) return;
  const fraction = host.decayFraction;
  const critical = host.decay <= 3;
  const color = critical ? COLORS.warning : fraction < 0.5 ? COLORS.hazard : COLORS.spore;
  const pulse = critical ? 0.6 + Math.sin(time * 18) * 0.4 : 1;

  ctx.save();
  ctx.translate(host.position.x, host.position.y);

  // Ring arc.
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  ctx.arc(0, 0, host.radius + 12, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, pulse);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, host.radius + 12, -Math.PI / 2, -Math.PI / 2 + TAU * fraction);
  ctx.stroke();
  ctx.lineCap = "butt";

  // One bold readout above the ring. The arc already carries the fraction, so
  // there is no second bar or technical caption to parse mid-fight.
  const labelY = -host.radius - 22;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = FONT(19, 700);
  fillTextShadow(ctx, `${Math.max(0, Math.ceil(host.decay))}s`, 0, labelY, critical ? COLORS.warning : "#d8f5e6");
  if (critical) {
    ctx.font = FONT(9, 700);
    fillTextShadow(ctx, "COLLAPSE", 0, labelY - 22, rgba(COLORS.warning, pulse));
  }
  ctx.restore();
}

export function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
  ctx.save();
  ctx.translate(p.position.x, p.position.y);
  ctx.rotate(p.angle);
  const trail = ctx.createLinearGradient(-p.length * 2.2, 0, 0, 0);
  trail.addColorStop(0, rgba(p.team === "player" ? "#9dffcf" : "#ff8b7a", 0));
  trail.addColorStop(0.7, rgba(p.team === "player" ? "#9dffcf" : "#ff8b7a", 0.45));
  trail.addColorStop(1, p.color);
  ctx.strokeStyle = trail;
  ctx.lineWidth = p.radius * 1.1;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-p.length * 2.2, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();
  ctx.fillStyle = "#fffdf4";
  ctx.beginPath();
  ctx.arc(0, 0, p.radius * 0.75, 0, TAU);
  ctx.fill();
  ctx.restore();
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

/** Bullseye practice target: three rings, a damage pulse, no text. */
export function drawTarget(ctx: CanvasRenderingContext2D, target: TrainingTarget, time: number): void {
  const color = target.alive ? "#ffc94a" : "#54524a";
  ctx.save();
  ctx.translate(target.position.x, target.position.y);

  // Floor shadow and stabilizer legs.
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  ctx.ellipse(0, target.radius * 0.7, target.radius * 1.1, target.radius * 0.45, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#303943";
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, target.radius * 0.35);
    ctx.lineTo(side * target.radius * 0.95, target.radius * 1.25);
    ctx.stroke();
  }

  if (target.alive) {
    ctx.rotate(Math.sin(time * 2 + target.phase) * 0.04);
    ctx.fillStyle = "#252c31";
    ctx.beginPath();
    ctx.arc(0, 0, target.radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#101519";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Remaining integrity shown as ring segments rather than a number.
    const segments = 12;
    for (let i = 0; i < segments; i += 1) {
      const lit = i < Math.round((target.hp / target.maxHp) * segments);
      ctx.strokeStyle = lit ? rgba(color, 0.9) : "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, target.radius - 4, (i / segments) * TAU, ((i + 0.72) / segments) * TAU);
      ctx.stroke();
    }

    // Concentric bullseye.
    ctx.fillStyle = "#f4ead8";
    ctx.beginPath();
    ctx.arc(0, 0, target.radius * 0.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, target.radius * 0.36, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#1a1e21";
    ctx.beginPath();
    ctx.arc(0, 0, target.radius * 0.17, 0, TAU);
    ctx.fill();

    if (target.hitFlash > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255, 255, 225, ${target.hitFlash * 0.75})`;
      ctx.beginPath();
      ctx.arc(0, 0, target.radius, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    // Blown apart: charred, cracked plate.
    ctx.fillStyle = "#2a2a28";
    ctx.beginPath();
    ctx.arc(0, 0, target.radius * 0.9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 201, 74, 0.25)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU + 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
      ctx.lineTo(Math.cos(a + 0.2) * target.radius * 0.85, Math.sin(a + 0.2) * target.radius * 0.85);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.arc(0, 0, target.radius * 0.28, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
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
