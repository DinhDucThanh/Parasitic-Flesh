/** Sprite sheets are generated into public/assets; audio samples are optional. */
export const ASSET_REGISTRY = {
  sprites: {
    spore: "assets/spore.png",
    host_security: "assets/guard-rig.png",
    host_enforcer: "assets/enforcer-rig.png",
    host_mutant: "assets/mutant-rig.png",
    lab_props: "assets/lab-props.png",
    tileset: "assets/tileset.png",
    props: "assets/props.png",
    projectiles: "assets/projectiles.png",
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
