import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";

/**
 * The browser build of the same renderer, for GitHub Pages. `resources/` is published as-is (the
 * default preset and the icon); NEPTUN's boundary files are copied into `geo/` by the Pages
 * workflow — and proxied in dev — because NEPTUN serves them without a CORS header.
 */
export default defineConfig({
  root: "src/renderer",
  base: "./",
  publicDir: "../../resources",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "../../dist-web", emptyOutDir: true },
  server: {
    proxy: {
      "/geo": { target: "https://neptun.in.ua", changeOrigin: true, rewrite: (path) => path.replace(/^\/geo/, "") },
    },
  },
});
