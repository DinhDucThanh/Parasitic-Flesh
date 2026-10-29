import { AssetManager } from "../assets/AssetManager";
import { SfxSynth } from "../assets/SfxSynth";
import { Renderer } from "../render/Renderer";
import { DecalSystem } from "../systems/DecalSystem";
import { CodexUI, type CodexTab } from "../ui/CodexUI";
import { GameOverUI } from "../ui/GameOverUI";
import { MainMenu } from "../ui/MainMenu";
import { saveRunStats } from "../services/supabase";
import { TutorialCompleteUI } from "../ui/TutorialCompleteUI";
import { UI, FONT, type UiInput } from "../ui/theme";
import { World } from "../world/World";
import { fillTextShadow } from "./fonts";
import { Camera } from "./Camera";
import { Input } from "./Input";

export enum GameState {
  BOOT = "BOOT",
  MAIN_MENU = "MAIN_MENU",
  PLAYING = "PLAYING",
  CODEX_PAUSE = "CODEX_PAUSE",
  LEVEL_CLEAR = "LEVEL_CLEAR",
  GAME_OVER = "GAME_OVER",
}

/**
 * Application shell: owns the requestAnimationFrame loop, the game state
 * machine, canvas sizing and the shared services every screen needs.
 *
 * State flow:
 *   BOOT → MAIN_MENU → PLAYING ⇄ CODEX_PAUSE → GAME_OVER → PLAYING | MAIN_MENU
 *   PLAYING → LEVEL_CLEAR (tutorial) → PLAYING (next level) | MAIN_MENU
 */
export class Engine {
  readonly renderer: Renderer;
  readonly world: World;
  readonly input: Input;

  private readonly camera = new Camera();
  private readonly decals = new DecalSystem();
  private readonly assets = new AssetManager();
  private readonly sfx: SfxSynth;
  private readonly menu: MainMenu;
  private readonly codex: CodexUI;
  private readonly gameOver = new GameOverUI();
  private readonly tutorialClear = new TutorialCompleteUI();

  private state: GameState = GameState.BOOT;
  private codexReturn: GameState = GameState.MAIN_MENU;
  private settle = 0;
  /** One telemetry row per run, no matter how the game-over screen is reached. */
  private runReported = false;
  private time = 0;
  private lastTimestamp = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, this.assets);
    this.sfx = new SfxSynth((key, ctx) => this.assets.loadAudio(key, ctx));
    this.resize();
    this.world = new World(this.input, this.camera, this.decals, this.sfx);
    this.menu = new MainMenu();
    this.codex = new CodexUI(this.sfx, () => this.world.lore, this.assets);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointerdown", this.unlockAudio);
    window.addEventListener("keydown", this.unlockAudio);

    this.raf = requestAnimationFrame(this.frame);
    void this.boot();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointerdown", this.unlockAudio);
    window.removeEventListener("keydown", this.unlockAudio);
    this.codex.close();
    this.input.dispose();
  }

  get currentState(): GameState {
    return this.state;
  }

  private readonly onResize = (): void => this.resize();

  private readonly unlockAudio = (): void => {
    // Browsers require a user gesture before the AudioContext may run.
    this.sfx.resume();
  };

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Retina 2x/3x canvas rasters are a major input-to-photon cost for 2D art.
    // 1.25 keeps high-DPI crispness without choking the rasterizer.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.camera.resize(width, height);
    this.renderer.resize(width, height, dpr);
    this.input.refreshBounds();
  }

  private async boot(): Promise<void> {
    await this.loadFonts();
    // Images are optional; failures fall back silently to procedural art.
    await this.assets.loadAll();
    this.state = GameState.MAIN_MENU;
    this.lastTimestamp = 0;
  }

  /** Wait briefly for Chakra Petch, then draw with the fallback rather than stall boot. */
  private async loadFonts(): Promise<void> {
    if (!("fonts" in document)) return;
    const loads = [
      document.fonts.load('400 16px "Chakra Petch"'),
      document.fonts.load('600 16px "Chakra Petch"'),
      document.fonts.load('700 16px "Chakra Petch"'),
    ].map((promise) => promise.catch(() => undefined));
    await Promise.race([
      Promise.all(loads),
      new Promise<void>((resolve) => window.setTimeout(resolve, 1200)),
    ]);
  }

  private readonly frame = (timestamp: number): void => {
    const dt = this.lastTimestamp === 0 ? 1 / 60 : Math.min(0.05, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    this.time += dt;

    this.update(dt);
    this.render();
    this.input.endFrame();

    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    const ui = this.makeUiInput();
    switch (this.state) {
      case GameState.BOOT:
        break;

      case GameState.MAIN_MENU: {
        const action = this.menu.handle(ui);
        if (action === "tutorial") this.deployLevel("tutorial");
        else if (action === "sector") this.deployLevel("sector_1");
        else if (action === "codex") this.openCodex(GameState.MAIN_MENU, 0);
        break;
      }

      case GameState.PLAYING: {
        if (this.world.dungeon?.draft || this.world.tutorial?.draft) {
          for (let i = 0; i < 3; i++) {
            if (this.input.wasPressed(`Digit${i + 1}`)) {
              this.world.dungeon?.chooseMutation(i);
              this.world.tutorial?.chooseMutation(i);
            }
          }
          break;
        }
        if (this.input.wasPressed("Tab") || this.input.wasPressed("Escape")) {
          this.openCodex(GameState.PLAYING, 0);
          break;
        }
        // R is the detonation key during play, so the quick restart lives on T.
        if (this.input.wasPressed("KeyT")) {
          this.retryGame();
          break;
        }
        this.world.update(dt);

        // The Proving Ground ends at its portal: hold the last frame, then
        // present the debrief where the player chooses the next mission.
        if (this.world.result === "tutorialComplete") {
          this.settle += dt;
          if (this.settle > 0.8) {
            this.reportRun();
            this.state = GameState.LEVEL_CLEAR;
            this.tutorialClear.reset();
          }
          break;
        }

        if (this.world.result !== "alive") {
          this.settle += dt;
          if (this.settle > 0.9) {
            this.reportRun();
            this.state = GameState.GAME_OVER;
            this.gameOver.show(
              this.world.result === "won",
              this.world.deathCause,
              this.world.stats,
              this.world.elapsed,
              this.world.mode,
            );
          }
        }
        break;
      }

      case GameState.LEVEL_CLEAR: {
        // Keep effects and camera alive behind the debrief.
        this.world.update(dt);
        const action = this.tutorialClear.handle(ui);
        if (action === "proceed") this.advanceLevel();
        else if (action === "menu") this.returnToMenu();
        break;
      }

      case GameState.CODEX_PAUSE: {
        if (this.input.wasPressed("Escape") || this.input.wasPressed("Tab")) {
          this.closeCodex();
          break;
        }
        if (this.codex.handle(ui) === "close") this.closeCodex();
        break;
      }

      case GameState.GAME_OVER: {
        // Let the death effects keep playing behind the report.
        this.world.update(dt);
        if (this.input.wasPressed("KeyR")) {
          this.retryGame();
          break;
        }
        if (this.input.wasPressed("Escape")) {
          this.returnToMenu();
          break;
        }
        if (this.input.wasPressed("Tab")) {
          this.openCodex(GameState.GAME_OVER, 4);
          break;
        }
        const action = this.gameOver.handle(ui);
        if (action === "retry") this.retryGame();
        else if (action === "codex") this.openCodex(GameState.GAME_OVER, 4);
        else if (action === "menu") this.returnToMenu();
        break;
      }
    }
  }

  /** Load a registered level and start playing it. */
  private deployLevel(id: string): void {
    this.world.applyLevel(this.world.levels.loadLevel(id));
    this.beginPlaying();
  }

  /** Tutorial cleared: advance through the registry, or fall back to title. */
  private advanceLevel(): void {
    const next = this.world.levels.loadNextLevel();
    if (!next) {
      this.returnToMenu();
      return;
    }
    const tutorialMutation = this.world.tutorial?.chosenMutation;
    this.world.applyLevel(next);
    if (tutorialMutation !== null && tutorialMutation !== undefined) this.world.dungeon?.grantMutation(tutorialMutation);
    this.beginPlaying();
  }

  /** Replay the mission currently loaded in the LevelManager. */
  private retryGame(): void {
    this.world.applyLevel(this.world.levels.restartCurrentLevel());
    this.beginPlaying();
  }

  private returnToMenu(): void {
    this.codex.close();
    this.menu.reset();
    this.state = GameState.MAIN_MENU;
    this.settle = 0;
    this.sfx.play("uiClick");
  }

  private beginPlaying(): void {
    this.settle = 0;
    this.runReported = false;
    this.state = GameState.PLAYING;
    this.sfx.resume();
    this.sfx.play("uiClick");
  }

  /** Persist one run to Supabase. Fire-and-forget: failures never block play. */
  private reportRun(): void {
    if (this.runReported) return;
    this.runReported = true;
    const { world } = this;
    const cleared = world.result === "won" || world.result === "tutorialComplete";
    void saveRunStats({
      sector_reached: world.level?.id ?? "unknown",
      bodies_hijacked: world.stats.hijacks,
      enemies_neutralized: world.stats.kills,
      survival_time_seconds: Math.round(world.elapsed),
      cause_of_death: cleared ? null : world.deathCause || null,
    });
  }

  private openCodex(returnState: GameState, tab: CodexTab): void {
    this.codexReturn = returnState;
    this.state = GameState.CODEX_PAUSE;
    this.codex.open(tab);
  }

  private closeCodex(): void {
    this.codex.close();
    this.state = this.codexReturn;
    if (this.state === GameState.MAIN_MENU) this.menu.reset();
    this.sfx.play("uiClick");
  }

  private makeUiInput(): UiInput {
    return {
      input: this.input,
      sfx: this.sfx,
      width: this.renderer.width,
      height: this.renderer.height,
    };
  }

  private render(): void {
    this.renderer.begin();
    const ctx = this.renderer.ctx;
    const width = this.renderer.width;
    const height = this.renderer.height;

    switch (this.state) {
      case GameState.BOOT:
        this.renderBoot(ctx, width, height);
        break;

      case GameState.MAIN_MENU:
        this.menu.render(ctx, width, height, this.time);
        break;

      case GameState.PLAYING:
        this.renderSimulation();
        break;

      case GameState.LEVEL_CLEAR:
        this.renderer.drawWorld(this.world, this.time);
        this.renderer.drawPost(this.world, this.time);
        this.tutorialClear.render(ctx, width, height, this.time);
        break;

      case GameState.CODEX_PAUSE:
        if (this.codexReturn === GameState.MAIN_MENU) {
          this.menu.renderBackdrop(ctx, width, height, this.time);
        } else {
          this.renderer.drawWorld(this.world, this.time);
          this.renderer.drawPost(this.world, this.time);
        }
        this.codex.render(ctx, width, height, this.time);
        break;

      case GameState.GAME_OVER:
        this.renderer.drawWorld(this.world, this.time);
        this.renderer.drawPost(this.world, this.time);
        this.gameOver.render(ctx, width, height, this.time);
        break;
    }

    this.renderer.drawScanlines();
    this.renderer.drawCursor(this.input, this.state === GameState.PLAYING ? "aim" : "ui");
  }

  private renderSimulation(): void {
    this.renderer.drawWorld(this.world, this.time);
    this.renderer.drawPost(this.world, this.time);
    this.renderer.drawHud(this.world, this.time);
  }

  private renderBoot(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = FONT(Math.round(Math.min(42, width * 0.045)), 700);
    fillTextShadow(ctx, "PARASITIC FLESH", width / 2, height / 2 - 20, UI.green, 2);

    const dots = ".".repeat(1 + (Math.floor(this.time * 3) % 3));
    ctx.font = FONT(12, 700);
    fillTextShadow(ctx, `CULTURING BIOMASS${dots}`, width / 2, height / 2 + 30, "rgba(175, 215, 198, 0.7)");

    const barW = Math.min(320, width * 0.4);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(width / 2 - barW / 2, height / 2 + 52, barW, 3);
    const progress = Math.min(1, this.time / 1.6);
    ctx.fillStyle = "rgba(0, 255, 136, 0.8)";
    ctx.fillRect(width / 2 - barW / 2, height / 2 + 52, barW * progress, 3);

    ctx.font = FONT(11);
    fillTextShadow(ctx, "SECTOR 4 // BIO-TERMINAL", width / 2, height / 2 + 82, "rgba(175, 215, 198, 0.45)");
    ctx.textAlign = "left";
  }
}
