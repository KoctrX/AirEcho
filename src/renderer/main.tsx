import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import { createWebApi } from "./webApi";
import { watchInstall } from "./install";

// Outside Electron (the GitHub Pages build) there is no preload: the browser stands in for it.
if (!("api" in window)) {
  (window as Window).api = createWebApi();
  watchInstall();
  // Installable, and opens offline. Not in `vite dev`: a worker would serve stale modules there.
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("sw.js");
}

createRoot(document.getElementById("root")!).render(<App />);
