import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ["fflate"] })] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], define: { __APP_VERSION__: JSON.stringify(version) } },
});
