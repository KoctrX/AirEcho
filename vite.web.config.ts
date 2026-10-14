import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";

/**
 * The browser build of the same renderer, for GitHub Pages. `resources/` is published as-is: the
 * default preset, the icons and PWA files, and `geo/` — a copy of NEPTUN's boundary files, which
 * NEPTUN serves without a CORS header (refresh it with `npm run geo:update` if the borders change).
 */
export default defineConfig({
  root: "src/renderer",
  base: "./",
  publicDir: "../../resources",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "../../dist-web", emptyOutDir: true },
});
