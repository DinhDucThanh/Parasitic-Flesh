/**
 * THE ONLY FILE YOU NEED TO EDIT TO OVERRIDE PROCEDURAL ART OR AUDIO.
 *
 * Drop a file at the matching path under `public/` and it is picked up on the
 * next page load. Missing files are expected and simply fall back to the
 * procedural renderer / synth; nothing in game logic changes either way.
 *
 * Example: drop `public/assets/sprites/spore.png` to replace the procedural
 * amoeba with your own sprite. Recommended sprite sizes:
 *   spore          64x64   (centered, transparent background)
 *   host_security  96x96
 *   host_enforcer  112x112
 *   host_mutant    96x96
 *   vfx_explosion  256x256 (center = blast origin)
 */
export const ASSET_REGISTRY = {
  sprites: {
    spore: "assets/sprites/spore.png",
    host_security: "assets/sprites/host_security.png",
    host_enforcer: "assets/sprites/host_enforcer.png",
    host_mutant: "assets/sprites/host_mutant.png",
    vfx_explosion: "assets/sprites/vfx_explosion.png",
  },
  audio: {
    sfx_launch: "assets/audio/launch.wav",
    sfx_hijack: "assets/audio/hijack.wav",
    sfx_blast: "assets/audio/blast.wav",
    sfx_shot: "assets/audio/shot.wav",
    sfx_shotgun: "assets/audio/shotgun.wav",
    sfx_claw: "assets/audio/claw.wav",
  },
} as const;

export type SpriteKey = keyof typeof ASSET_REGISTRY.sprites;
export type AudioKey = keyof typeof ASSET_REGISTRY.audio;

export const SPRITE_KEYS = Object.keys(ASSET_REGISTRY.sprites) as SpriteKey[];
export const AUDIO_KEYS = Object.keys(ASSET_REGISTRY.audio) as AudioKey[];
