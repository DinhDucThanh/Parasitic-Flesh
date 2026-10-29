export interface AnimationDef {
  row: number;
  frameCount: number;
  frameRate: number;
  loop: boolean;
}

/** A sheet is shared; the animation clock belongs to the entity. */
export class SpriteSheet {
  private readonly flashCanvas: HTMLCanvasElement;
  private readonly flashCtx: CanvasRenderingContext2D;

  constructor(
    public image: HTMLImageElement,
    public frameWidth: number,
    public frameHeight: number,
    public animations: Record<string, AnimationDef>,
  ) {
    this.flashCanvas = document.createElement("canvas");
    this.flashCanvas.width = frameWidth;
    this.flashCanvas.height = frameHeight;
    const ctx = this.flashCanvas.getContext("2d");
    if (!ctx) throw new Error("Sprite flash canvas unavailable");
    this.flashCtx = ctx;
  }

  draw(ctx: CanvasRenderingContext2D, animName: string, stateTimer: number, x: number, y: number, flipX = false, hitFlash = false): void {
    const anim = this.animations[animName] ?? Object.values(this.animations)[0];
    if (!anim || anim.frameCount < 1) return;
    const frame = Math.max(0, Math.floor(stateTimer * anim.frameRate));
    const sx = (anim.loop ? frame % anim.frameCount : Math.min(frame, anim.frameCount - 1)) * this.frameWidth;
    const sy = anim.row * this.frameHeight;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (flipX) ctx.scale(-1, 1);
    if (hitFlash) {
      const off = this.flashCtx;
      off.clearRect(0, 0, this.frameWidth, this.frameHeight);
      off.globalCompositeOperation = "source-over";
      off.drawImage(this.image, sx, sy, this.frameWidth, this.frameHeight, 0, 0, this.frameWidth, this.frameHeight);
      off.globalCompositeOperation = "source-in";
      off.fillStyle = "#ffffff";
      off.fillRect(0, 0, this.frameWidth, this.frameHeight);
      off.globalCompositeOperation = "source-over";
      ctx.drawImage(this.flashCanvas, -this.frameWidth / 2, -this.frameHeight / 2);
    } else {
      ctx.drawImage(this.image, sx, sy, this.frameWidth, this.frameHeight, -this.frameWidth / 2, -this.frameHeight / 2, this.frameWidth, this.frameHeight);
    }
    ctx.restore();
  }
}
