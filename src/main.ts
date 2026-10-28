import { Engine } from "./core/Engine";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Fatal: #game canvas not found");
}

const engine = new Engine(canvas);

// Dev console handle: inspect state, force a step, or teleport for testing.
// e.g. __game.world.hosts.length, __game.world.update(0.016)
(window as unknown as { __game: Engine }).__game = engine;
