/**
 * One type system for every surface: canvas HUD, Bio-Terminal, menus and
 * in-world labels. Chakra Petch is loaded in index.html; if the network font
 * is unavailable the stack falls back to the platform UI sans without any
 * layout or logic changes.
 */
export const FONT_STACK = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';

export const FONT = (size: number, weight = 400): string => `${weight} ${size}px ${FONT_STACK}`;

/**
 * Crisp, 1px-offset solid drop shadow. Deliberately not ctx.shadowBlur:
 * blurred canvas shadows are a per-draw CPU cost we cannot afford in-frame.
 */
export function fillTextShadow(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  color: string,
  offset = 1,
): void {
  const previous = ctx.fillStyle;
  ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
  ctx.fillText(value, x + offset, y + offset);
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.fillStyle = previous;
}

/** Multi-line variant used by wrapped copy. */
export function fillLinesShadow(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  x: number,
  y: number,
  lineHeight: number,
  color: string,
  offset = 1,
): void {
  const previous = ctx.fillStyle;
  ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
  lines.forEach((line, index) => ctx.fillText(line, x + offset, y + index * lineHeight + offset));
  ctx.fillStyle = color;
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  ctx.fillStyle = previous;
}
