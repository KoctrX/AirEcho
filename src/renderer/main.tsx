import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import { createWebApi } from "./webApi";

// Outside Electron (the GitHub Pages build) there is no preload: the browser stands in for it.
if (!("api" in window)) (window as Window).api = createWebApi();

createRoot(document.getElementById("root")!).render(<App />);
