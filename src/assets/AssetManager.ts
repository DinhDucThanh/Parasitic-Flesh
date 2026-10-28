import { ASSET_REGISTRY, SPRITE_KEYS, type AudioKey, type SpriteKey } from "./AssetRegistry";

const BASE = import.meta.env.BASE_URL;

function resolve(path: string): string {
  return `${BASE.replace(/\/$/, "")}/${path}`;
}

/**
 * Loads optional external assets. Every failure path is intentionally silent:
 * the renderer and synth each have a procedural fallback, so a missing or
 * corrupt file is a non-event rather than a crash.
 *
 * Important detail: Vite's dev server answers unknown paths with the SPA's
 * `index.html` (HTTP 200, `text/html`). Without a content-type check, an
 * `<img>` would fire `load` on HTML bytes and audio decode would throw. The
 * checks below reject anything whose MIME type doesn't match.
 */
export class AssetManager {
  private readonly images = new Map<SpriteKey, HTMLImageElement>();

  async loadAll(): Promise<void> {
    await Promise.all(SPRITE_KEYS.map((key) => this.loadImage(key)));
  }

  image(key: SpriteKey): HTMLImageElement | undefined {
    return this.images.get(key);
  }

  private loadImage(key: SpriteKey): Promise<void> {
    const url = resolve(ASSET_REGISTRY.sprites[key]);
    return new Promise<void>((done) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        // Reject SPA fallback HTML decoded as a broken image.
        if (img.naturalWidth > 0 && img.naturalHeight > 0) this.images.set(key, img);
        done();
      };
      img.onerror = () => done();
      img.src = url;
    });
  }

  /** Fetch + validate + decode one optional WAV/OGG. Returns null to use the synth. */
  async loadAudio(key: AudioKey, ctx: AudioContext): Promise<AudioBuffer | null> {
    try {
      const response = await fetch(resolve(ASSET_REGISTRY.audio[key]), { cache: "no-cache" });
      if (!response.ok) return null;
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("audio/") && !type.includes("octet-stream")) return null;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 44) return null;
      return await ctx.decodeAudioData(bytes);
    } catch {
      return null;
    }
  }
}
