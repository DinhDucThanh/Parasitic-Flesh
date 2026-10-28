# PARASITIC FLESH

A single-room, top-down body-horror action roguelite prototype built on Vite + TypeScript + HTML5 Canvas.
Everything you see and hear is generated in code: there are **no required image or audio files**, and no runtime dependencies.

You are a one-hit-point spore. Slow time, aim a leap, **hijack a body**, wear out its lifespan, and detonate it on the way out.

## Run

Requires Node.js 18 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # strict typecheck + production build into dist/
npm run preview  # serve the production build
```

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move the active body (spore or host) |
| Mouse | Aim weapons and the leap trajectory |
| Hold `RMB` | Bullet-time (world at 0.18x) + draw the hijack cone |
| Release `RMB` | Launch at the locked host / eject and detonate the current host |
| `LMB` | Fire the host weapon (rifle, shotgun, claw dash) |
| `Tab` / `Esc` | Open or close the Bio-Codex |
| `1`–`5` | Codex tabs |
| `R` | Retry after death |

## The hijack loop

1. **Spore state** — 1 HP, 7px hitbox, 460 px/s. A single hostile contact is fatal.
2. **Hold RMB** — time drops to 18%. The nearest body inside the green cone gets a pulsing reticle.
3. **Release** — the spore flies at 1400 px/s into that body. Impact triggers a 45ms hit-stop, a camera jolt, a memory whisper, and full control.
4. **Decay** — every body has a real-time lifespan of **10–16s**. Bullet-time does **not** slow it. Incoming hits do not kill you; they subtract **3.0s**. Under 3s the screen pulses red, the aim jitters, and a heartbeat plays. At zero the body folds inward around you: game over.
5. **Eject** — hold RMB again to slow time and aim the next launch, release to detonate the abandoned body in a **140px acid blast** that strips armor and permanently scars the floor.
6. **Graft** — leaving a body transfers its signature trait to the next one: security grants an auto-sidearm, enforcer grants rear plating, mutant grants +35% speed and caustic footsteps.

## Project structure

```
src/
├── core/        Engine (game-state machine + rAF loop), Input, Camera, math/config
├── entities/    Entity base, Spore state machine, Host archetypes (stats, decay, grafts)
├── systems/     CombatSystem, HijackSystem, DecalSystem, projectiles/effects
├── render/      Renderer (layers, lighting, post-FX, HUD), ProceduralArt
├── assets/      AssetRegistry, AssetManager (validated loader), SfxSynth
├── ui/          MainMenu, CodexUI, GameOverUI, shared terminal theme
├── world/       World simulation, AIController, lore/whispers
└── main.ts      Canvas bootstrap + `window.__game` dev handle
```

Presentation never drives gameplay: hosts own state, systems mutate it, and the renderer only reads.
The floor and all gore live on one persistent world-sized offscreen canvas; the light map is a second
screen-sized canvas that is punched out per frame and composited back.

## Drop in your own art and audio

All optional files are listed in [`src/assets/AssetRegistry.ts`](src/assets/AssetRegistry.ts):

| Key | Path | Notes |
| --- | --- | --- |
| `spore` | `public/assets/sprites/spore.png` | 64×64, centered, transparent |
| `host_security` | `public/assets/sprites/host_security.png` | 96×96, drawn facing **right (+x)** |
| `host_enforcer` | `public/assets/sprites/host_enforcer.png` | 112×112, faces +x |
| `host_mutant` | `public/assets/sprites/host_mutant.png` | 96×96, faces +x |
| `vfx_explosion` | `public/assets/sprites/vfx_explosion.png` | 256×256, centered |
| `sfx_launch` / `sfx_hijack` / `sfx_blast` | `public/assets/audio/*.wav` | Optional overrides |
| `sfx_shot` / `sfx_shotgun` / `sfx_claw` | `public/assets/audio/*.wav` | Optional overrides |

Drop a file in and reload: `AssetManager` checks the MIME type (so Vite's SPA fallback HTML is never
mistaken for artwork), and anything missing transparently falls back to procedural canvas art and
Web Audio synthesis. No game logic changes.

## Tuning

- [`src/core/config.ts`](src/core/config.ts) — speeds, bullet-time scale, decay window, blast radius/damage, arena size, colors.
- [`src/entities/Host.ts`](src/entities/Host.ts) — archetype stats, lifespans, weapons and graft definitions.
- [`src/world/World.ts`](src/world/World.ts) — spawn layout and grace period.

## Debugging

`window.__game` exposes the live engine: `__game.world`, `__game.input`, `__game.currentState`.
The engine's frame loop is the only system that calls `Input.endFrame()`; state is cleared each frame.
