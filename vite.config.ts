import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  // Files placed in /public/assets/... are served at /assets/... and picked up by AssetManager.
  publicDir: "public",
});
