import type { Vec2 } from "./math";

/**
 * Owns all raw browser input. Edge flags (`pressed` / `released`) are valid for
 * exactly one frame and cleared by `endFrame()` at the end of the engine loop.
 */
export class Input {
  /** Mouse position in CSS pixels, relative to the canvas top-left. */
  readonly mouse: Vec2 = { x: 0, y: 0 };
  leftHeld = false;
  rightHeld = false;
  leftPressed = false;
  leftReleased = false;
  rightPressed = false;
  rightReleased = false;

  private readonly down = new Set<string>();
  private readonly pressedKeys = new Set<string>();
  private readonly releasedKeys = new Set<string>();
  private readonly cleanups: Array<() => void> = [];
  /** Cached once per layout change: never call getBoundingClientRect per pointer event. */
  private readonly bounds = { left: 0, top: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.refreshBounds();
    this.on(window, "resize", () => this.refreshBounds());
    this.on(window, "scroll", () => this.refreshBounds());

    this.on(window, "keydown", (event: KeyboardEvent) => {
      // The game owns these keys; stop the page from scrolling or tabbing away.
      if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }
      if (event.repeat) return;
      this.down.add(event.code);
      this.pressedKeys.add(event.code);
    });

    this.on(window, "keyup", (event: KeyboardEvent) => {
      this.down.delete(event.code);
      this.releasedKeys.add(event.code);
    });

    // Releasing outside the canvas must still clear held buttons.
    this.on(window, "blur", () => {
      this.down.clear();
      this.leftHeld = false;
      this.rightHeld = false;
    });

    this.on(window, "pointerdown", (event: PointerEvent) => {
      if (event.button === 0) {
        this.leftHeld = true;
        this.leftPressed = true;
      }
      if (event.button === 2) {
        this.rightHeld = true;
        this.rightPressed = true;
      }
      this.trackPointer(event);
    });

    this.on(window, "pointerup", (event: PointerEvent) => {
      if (event.button === 0) {
        this.leftHeld = false;
        this.leftReleased = true;
      }
      if (event.button === 2) {
        this.rightHeld = false;
        this.rightReleased = true;
      }
      this.trackPointer(event);
    });

    // pointermove gives us the pointer pipeline's coalesced high-frequency samples.
    this.on(window, "pointermove", (event: PointerEvent) => this.trackPointer(event));
    this.on(window, "contextmenu", (event: Event) => event.preventDefault());
  }

  /** Re-measure the canvas box after a resize, scroll or fullscreen change. */
  refreshBounds(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.bounds.left = rect.left;
    this.bounds.top = rect.top;
  }

  private on<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): void {
    target.addEventListener(type, handler as EventListener);
    this.cleanups.push(() => target.removeEventListener(type, handler as EventListener));
  }

  private trackPointer(event: PointerEvent): void {
    // Raw hardware position, no smoothing, no interpolation and no time-scale
    // damping. Crosshair and aim both read this exact value each frame.
    this.mouse.x = event.clientX - this.bounds.left;
    this.mouse.y = event.clientY - this.bounds.top;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  wasReleased(code: string): boolean {
    return this.releasedKeys.has(code);
  }

  /** True if any of the given keys is held (e.g. WASD or arrows). */
  anyDown(...codes: string[]): boolean {
    return codes.some((code) => this.down.has(code));
  }

  /** Raw -1..1 movement axes from WASD / arrow keys. */
  get moveAxis(): Vec2 {
    const x = (this.isDown("KeyD") || this.isDown("ArrowRight") ? 1 : 0) - (this.isDown("KeyA") || this.isDown("ArrowLeft") ? 1 : 0);
    const y = (this.isDown("KeyS") || this.isDown("ArrowDown") ? 1 : 0) - (this.isDown("KeyW") || this.isDown("ArrowUp") ? 1 : 0);
    return { x, y };
  }

  /**
   * Drops held/edge mouse state without touching keyboard input. Called on
   * hijack so a click made during the leap cannot fire the new body on frame 0.
   * The physical button must be released and pressed again to act.
   */
  clearMouseState(): void {
    this.leftHeld = false;
    this.leftPressed = false;
    this.leftReleased = false;
  }

  endFrame(): void {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.leftPressed = false;
    this.leftReleased = false;
    this.rightPressed = false;
    this.rightReleased = false;
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }
}
