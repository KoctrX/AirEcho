import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type ExpressionSpecification, type FilterSpecification, type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { Box, GlobalStyles } from "@mui/material";
import type { Feature, FeatureCollection } from "geojson";
import type { Location } from "../shared/types";
import type { Focus } from "./App";
import { ahead, circleRing, featureBounds, maskAround, pointInFeature } from "./geo";
import { useApp } from "./store";
import { typeKey } from "./TargetsTab";
import type { RegionRef } from "./AlertsTab";
import { useNeptun, type AlertRegion, type Place, type Threat } from "./neptun";
import { t } from "./texts";
import { lookOf, markerSize, markerSvg } from "./silhouettes";
import { threatCard } from "./threatInfo";
import { on } from "./shortcuts";
import Legend from "./Legend";

/** West, south, east, north of Ukraine, Crimea included: the "focus" view. */
const UKRAINE: [[number, number], [number, number]] = [[22.1, 44.3], [40.3, 52.4]];
const FIT = { padding: 24, duration: 600 };

/** A map button that brings the whole country back into view. */
class FocusControl implements maplibregl.IControl {
  private box?: HTMLElement;
  onAdd(map: MlMap): HTMLElement {
    this.box = document.createElement("div");
    this.box.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const button = document.createElement("button");
    button.type = "button";
    button.title = t.focusUkraine;
    button.className = "focus-ua";
    button.onclick = () => map.fitBounds(UKRAINE, FIT);
    this.box.append(button);
    return this.box;
  }
  onRemove(): void {
    this.box?.remove();
  }
}
const RED = "#e53935";
const YELLOW = "#f9a825";
const ME = "#3355cc";
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * CARTO's free minimal basemaps, Positron and Dark Matter, as vector styles: the raster tiles now
 * need an API key, the vector ones do not.
 */
export const cartoStyle = (dark: boolean): string =>
  `https://basemaps.cartocdn.com/gl/${dark ? "dark-matter" : "positron"}-gl-style/style.json`;

const finite = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Our layers go under the basemap's labels, so place names stay readable over a red oblast. */
function firstLabel(map: MlMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

function source(map: MlMap, id: string, data: FeatureCollection = EMPTY): GeoJSONSource {
  if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
  return map.getSource(id) as GeoJSONSource;
}

/**
 * Ours, not `isStyleLoaded()`: that one stays false while tiles load, and an update skipped then
 * is never retried. A style swap clears it until the new style's `style.load`.
 */
const ready = new WeakSet<MlMap>();

/** Call once per map: marks it ready on every style load and shows local (Ukrainian) names. */
export function onStyle(map: MlMap, then: () => void): void {
  map.on("style.load", () => {
    ready.add(map);
    // CARTO labels in English from zoom 0–8; `name` is the local spelling (Київ, not Kyiv).
    for (const layer of map.getStyle().layers) {
      if (layer.type === "symbol" && JSON.stringify(layer.layout?.["text-field"] ?? "").includes("name_en")) {
        map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name"], ["get", "name_en"]]);
      }
    }
    then();
  });
}

export function setStyle(map: MlMap, dark: boolean): void {
  ready.delete(map);
  // A full reload (no diff) so `style.load` fires and our layers are put back.
  map.setStyle(cartoStyle(dark), { diff: false });
}

/** The location's point and radius; shared by the main map and the picker in settings. */
export function drawLocation(map: MlMap, loc: Location | undefined): void {
  if (!ready.has(map)) return;
  const data: FeatureCollection = !loc
    ? EMPTY
    : {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(loc.lat, loc.lon, loc.radiusKm)] } },
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [loc.lon, loc.lat] } },
        ],
      };
  source(map, "me").setData(data);
  if (map.getLayer("me-line")) return;
  map.addLayer({ id: "me-fill", type: "fill", source: "me", filter: ["==", "$type", "Polygon"], paint: { "fill-color": ME, "fill-opacity": 0.05 } });
  map.addLayer({
    id: "me-line",
    type: "line",
    source: "me",
    filter: ["==", "$type", "Polygon"],
    paint: { "line-color": ME, "line-width": 1.5, "line-dasharray": [3, 3] },
  });
  map.addLayer({
    id: "me-dot",
    type: "circle",
    source: "me",
    filter: ["==", "$type", "Point"],
    paint: { "circle-radius": 6, "circle-color": ME, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });
}

/** `key` → colour by alert level; anything not on alert is transparent. */
function alertColor(active: AlertRegion[], idle: string): ExpressionSpecification {
  const keys = (level: string) => active.filter((a) => (a.level ?? "red") === level).map((a) => a.key);
  return [
    "case",
    ["in", ["get", "key"], ["literal", keys("yellow")]],
    YELLOW,
    ["in", ["get", "key"], ["literal", active.map((a) => a.key)]],
    RED,
    idle,
  ];
}

function threatElement(x: Threat): HTMLElement {
  const { visual, color, heading, fade } = lookOf(x);
  // A destination record's point is the town it heads for, not where it is: drawn small, in a ring.
  const scale = x.destination ? 0.6 : 1;
  const size = markerSize(visual, scale);
  const el = document.createElement("div");
  el.className = `thr${x.destination ? " thr-goal" : ""}`;
  el.style.cssText = `width:${size}px;height:${size}px;opacity:${fade};--c:${color}`;
  el.innerHTML = markerSvg(visual, color, heading, size, heading === null);
  if ((x.count ?? 0) > 1) {
    const n = document.createElement("span");
    n.className = "thr-n";
    n.textContent = String(x.count);
    el.append(n);
  }
  // MapLibre positions the marker's root absolutely; our `.thr` is `position: relative` for the
  // badge, so it must not be the root — on the root it overrode that and markers drifted.
  const root = document.createElement("div");
  root.append(el);
  return root;
}

/** Our own region names: CARTO labels only the largest regions, and no Ukrainian oblast is one. */
function labels(places: Place[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((p) => ({
      type: "Feature" as const,
      properties: { name: p.raion ? p.name.replace(/ район$/, "") : p.name.replace(/ область$/, ""), raion: p.raion },
      geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
    })),
  };
}

const LABEL_FONT = ["Montserrat Medium", "Open Sans Bold", "Noto Sans Regular"];

/** Per track: the way it has come, a short course ahead, and a circle for how far off the point may be. */
function tracks(threats: Threat[]): FeatureCollection {
  const features: Feature[] = [];
  for (const x of threats) {
    const lat = finite(x.lat);
    const lon = finite(x.lon);
    if (x.areaOnly || lat === null || lon === null) continue;
    const { color, heading, trail, fade } = lookOf(x);
    if (trail.length > 0) {
      features.push({ type: "Feature", properties: { part: "trail", color, op: 0.6 * fade }, geometry: { type: "LineString", coordinates: [...trail, [lon, lat]] } });
    }
    if (!x.destination && heading !== null) {
      const op = (x.presumptiveCourse ? 0.3 : 0.65) * fade;
      features.push({ type: "Feature", properties: { part: "course", color, op }, geometry: { type: "LineString", coordinates: [[lon, lat], ahead(lat, lon, heading, 20)] } });
    }
    const km = finite(x.uncertaintyKm);
    if (km !== null && km > 0) {
      features.push({ type: "Feature", properties: { part: "uncert", color, op: 0.5 * fade }, geometry: { type: "Polygon", coordinates: [circleRing(lat, lon, km, 48)] } });
    }
  }
  return { type: "FeatureCollection", features };
}

export default function MapView({
  dark,
  location,
  focus,
  region,
  onRegion,
}: {
  dark: boolean;
  location?: Location;
  focus: Focus | null;
  region: RegionRef | null;
  onRegion: (r: RegionRef | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const neptun = useNeptun();
  const { settings } = useApp();
  // Types switched off in the targets tab are not drawn (they are still listed and voiced).
  const shown = useMemo(() => {
    const hidden = new Set(settings.hiddenTypes);
    return neptun.threats.filter((x) => !hidden.has(typeKey(x.type)));
  }, [neptun.threats, settings.hiddenTypes]);
  const regionFeature = useMemo(() => {
    if (!region || !neptun.catalog) return undefined;
    const list = region.kind === "oblast" ? neptun.catalog.oblasts.features : neptun.catalog.raions.features;
    return list.find((f) => f.properties?.key === region.key);
  }, [region, neptun.catalog]);
  const latest = useRef({ neptun, location, dark, shown, regionFeature, onRegion });
  latest.current = { neptun, location, dark, shown, regionFeature, onRegion };

  /** The info card of one target; follows it as the feed updates, closes when it is gone. */
  const card = useRef(new maplibregl.Popup({ className: "thr-popup", maxWidth: "340px", offset: 18, focusAfterOpen: false }));
  const cardId = useRef<string | null>(null);
  const showCard = (x: Threat, open = true) => {
    const lat = finite(x.lat);
    const lon = finite(x.lon);
    if (x.areaOnly || lat === null || lon === null || !map.current) return;
    card.current.setLngLat([lon, lat]).setDOMContent(threatCard(x, latest.current.location));
    if (open) card.current.addTo(map.current);
    cardId.current = x.id;
  };

  /** Puts our data on the map; runs on every data change and again after a style swap wipes it. */
  const sync = () => {
    const m = map.current;
    if (!m || !ready.has(m)) return;
    const { neptun: n, location: loc, dark: isDark, shown: visible, regionFeature: picked } = latest.current;
    const before = firstLabel(m);

    if (n.catalog && !m.getSource("oblasts")) {
      source(m, "oblasts", n.catalog.oblasts);
      source(m, "raions", n.catalog.raions);
      m.addLayer({ id: "oblast-fill", type: "fill", source: "oblasts", paint: { "fill-opacity": 0.32 } }, before);
      m.addLayer({ id: "raion-fill", type: "fill", source: "raions", paint: { "fill-opacity": 0.32 } }, before);
      m.addLayer({ id: "oblast-line", type: "line", source: "oblasts", paint: { "line-width": 1 } }, before);
      m.addLayer({ id: "raion-line", type: "line", source: "raions", paint: { "line-width": 0.6 } }, before);
      source(m, "tracks");
      const part = (name: string): FilterSpecification => ["==", ["get", "part"], name];
      const color: ExpressionSpecification = ["get", "color"];
      const op: ExpressionSpecification = ["get", "op"];
      m.addLayer({ id: "track-uncert-fill", type: "fill", source: "tracks", filter: part("uncert"), paint: { "fill-color": color, "fill-opacity": 0.06 } }, before);
      m.addLayer(
        { id: "track-uncert", type: "line", source: "tracks", filter: part("uncert"), paint: { "line-color": color, "line-opacity": op, "line-width": 1, "line-dasharray": [3, 3] } },
        before,
      );
      m.addLayer({ id: "track-trail", type: "line", source: "tracks", filter: part("trail"), paint: { "line-color": color, "line-opacity": op, "line-width": 1.5 } }, before);
      m.addLayer(
        { id: "track-course", type: "line", source: "tracks", filter: part("course"), paint: { "line-color": color, "line-opacity": op, "line-width": 1.5, "line-dasharray": [1.5, 2.5] } },
        before,
      );
      source(m, "labels", labels(n.catalog.places));
      // Above the basemap's labels: ours are the ones that matter here.
      const label = (id: string, raion: boolean, minzoom: number, maxzoom: number, size: number) =>
        m.addLayer({
          id,
          type: "symbol",
          source: "labels",
          filter: ["==", ["get", "raion"], raion],
          minzoom,
          maxzoom,
          layout: {
            "text-field": ["get", "name"],
            "text-font": LABEL_FONT,
            "text-size": size,
            "text-transform": raion ? "none" : "uppercase",
            "text-letter-spacing": raion ? 0 : 0.08,
            "text-max-width": 8,
          },
          paint: { "text-halo-width": 1.2 },
        });
      label("label-oblast", false, 4.5, 8, 11);
      label("label-raion", true, 7, 22, 11);
      // The picked region on top of everything drawn: the rest of the map dimmed, the border traced.
      source(m, "sel-mask");
      source(m, "sel-line");
      m.addLayer({ id: "sel-mask", type: "fill", source: "sel-mask", paint: { "fill-color": "#000" } });
      m.addLayer({ id: "sel-casing", type: "line", source: "sel-line", paint: { "line-color": "#000", "line-opacity": 0.55, "line-width": 6 } });
      m.addLayer({ id: "sel-line", type: "line", source: "sel-line", paint: { "line-color": "#fff", "line-width": 2.5 } });
    }
    if (m.getLayer("sel-mask")) {
      m.setPaintProperty("sel-mask", "fill-opacity", isDark ? 0.6 : 0.4);
      source(m, "sel-mask").setData(picked ? { type: "FeatureCollection", features: [maskAround(picked)] } : EMPTY);
      source(m, "sel-line").setData(picked ? { type: "FeatureCollection", features: [picked as Feature] } : EMPTY);
    }
    if (m.getLayer("label-oblast")) {
      for (const id of ["label-oblast", "label-raion"]) {
        m.setPaintProperty(id, "text-color", isDark ? "rgba(225,230,240,.75)" : "rgba(40,45,60,.75)");
        m.setPaintProperty(id, "text-halo-color", isDark ? "rgba(0,0,0,.7)" : "rgba(255,255,255,.8)");
      }
    }
    if (m.getLayer("oblast-fill")) {
      const clear = "rgba(0,0,0,0)";
      m.setPaintProperty("oblast-fill", "fill-color", alertColor(n.oblasts, clear));
      m.setPaintProperty("raion-fill", "fill-color", alertColor(n.raions, clear));
      m.setPaintProperty("oblast-line", "line-color", alertColor(n.oblasts, isDark ? "rgba(160,170,190,.45)" : "rgba(90,100,120,.45)"));
      m.setPaintProperty("raion-line", "line-color", alertColor(n.raions, clear));
      source(m, "tracks").setData(tracks(visible));
    }
    drawLocation(m, loc);
  };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: cartoStyle(latest.current.dark),
      bounds: UKRAINE,
      fitBoundsOptions: { padding: 24 },
      locale: {
        "NavigationControl.ZoomIn": t.zoomIn,
        "NavigationControl.ZoomOut": t.zoomOut,
        "FullscreenControl.Enter": t.fullscreen,
        "FullscreenControl.Exit": t.exitFullscreen,
      },
      minZoom: 3,
      maxZoom: 16,
      attributionControl: false,
      dragRotate: false,
      // Shift is for picking an oblast here, not for MapLibre's shift-drag box zoom.
      boxZoom: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: t.attribution }));
    // The whole app goes fullscreen, not just the map: the panels and their toggles stay usable.
    m.addControl(new maplibregl.FullscreenControl({ container: document.body }), "top-right");
    m.addControl(new FocusControl(), "top-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    onStyle(m, sync);

    // Region names on hover.
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "region-tip", offset: 12 });
    m.on("mousemove", (e) => {
      const layers = ["raion-fill", "oblast-fill"].filter((id) => m.getLayer(id));
      const hit = layers.length ? m.queryRenderedFeatures(e.point, { layers }) : [];
      const raion = hit.find((f) => f.layer.id === "raion-fill");
      const oblast = hit.find((f) => f.layer.id === "oblast-fill");
      const name = [raion?.properties.rayon, oblast?.properties.region ?? oblast?.properties.name].filter(Boolean).join(", ");
      if (name) popup.setLngLat(e.lngLat).setText(name).addTo(m);
      else popup.remove();
    });
    m.on("mouseout", () => popup.remove());
    card.current.on("close", () => (cardId.current = null));

    // With a region picked, a click outside it lets go and brings the whole country back.
    m.on("click", (e) => {
      // Shift+click picks the oblast under the cursor, Ctrl+click the raion.
      const mods = e.originalEvent as MouseEvent;
      if (mods.shiftKey || mods.ctrlKey || mods.metaKey) {
        const kind = mods.shiftKey ? "oblast" : "raion";
        const layer = `${kind}-fill`;
        const hit = m.getLayer(layer) ? m.queryRenderedFeatures(e.point, { layers: [layer] })[0] : undefined;
        const key = hit?.properties?.key as string | undefined;
        if (key) latest.current.onRegion({ kind, key });
        return;
      }
      const picked = latest.current.regionFeature;
      if (!picked || pointInFeature(e.lngLat.lat, e.lngLat.lng, picked)) return;
      latest.current.onRegion(null);
      m.fitBounds(UKRAINE, FIT);
    });

    map.current = m;
    const offFit = on("fit", () => m.fitBounds(UKRAINE, FIT));
    // Resizing the canvas clears it; redraw in the same frame, or a panel being dragged makes the map
    // blink empty on every step.
    const resize = new ResizeObserver(() => {
      m.resize();
      m.redraw();
    });
    resize.observe(el.current!);
    return () => {
      offFit();
      resize.disconnect();
      m.remove();
    };
  }, []);

  const styleDark = useRef(dark);
  useEffect(() => {
    if (styleDark.current === dark) return;
    styleDark.current = dark;
    if (map.current) setStyle(map.current, dark);
  }, [dark]);

  useEffect(sync, [neptun.catalog, neptun.oblasts, neptun.raions, shown, location, dark, regionFeature]);

  // Picking a region flies to it; Esc lets go.
  useEffect(() => {
    if (regionFeature) map.current?.fitBounds(featureBounds(regionFeature), { padding: 60, duration: 700, maxZoom: 10 });
  }, [regionFeature]);
  useEffect(() => {
    if (!region) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onRegion(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [region, onRegion]);

  useEffect(() => {
    for (const marker of markers.current) marker.remove();
    markers.current = shown.flatMap((x) => {
      const lat = finite(x.lat);
      const lon = finite(x.lon);
      // A record that only names an oblast has no place: it is listed, not drawn.
      if (x.areaOnly || lat === null || lon === null) return [];
      const element = threatElement(x);
      element.addEventListener("click", (e) => {
        e.stopPropagation();
        // A target outside the picked region: let the region go and fly to the target. One inside
        // it just opens its card — the region stays.
        const picked = latest.current.regionFeature;
        if (picked && !pointInFeature(lat, lon, picked)) {
          latest.current.onRegion(null);
          map.current?.flyTo({ center: [lon, lat], zoom: 8.5, duration: 800 });
        }
        showCard(x);
      });
      return [new maplibregl.Marker({ element }).setLngLat([lon, lat]).addTo(map.current!)];
    });
    if (cardId.current) {
      const open = shown.find((x) => x.id === cardId.current);
      if (open) showCard(open, false);
      else card.current.remove();
    }
  }, [shown]);

  useEffect(() => {
    if (!focus) return;
    map.current?.flyTo({ center: [focus.lon, focus.lat], zoom: 8.5, duration: 800 });
    const target = focus.id && latest.current.neptun.threats.find((x) => x.id === focus.id);
    if (target) showCard(target);
  }, [focus]);

  return (
    <Box sx={{ position: "relative", minWidth: 0 }}>
      <GlobalStyles
        styles={{
          ".maplibregl-map": { fontFamily: "inherit" },
          // MapLibre's own white boxes, restyled to the app's theme.
          ".maplibregl-ctrl.maplibregl-ctrl-attrib": {
            margin: "0 8px 8px 0",
            padding: "3px 10px",
            borderRadius: 8,
            fontSize: 11,
            background: "color-mix(in srgb, var(--mui-palette-background-paper) 80%, transparent)",
            backdropFilter: "blur(6px)",
            border: "1px solid var(--mui-palette-divider)",
            color: "var(--mui-palette-text-secondary)",
            boxShadow: "0 1px 4px rgba(0,0,0,.25)",
          },
          ".maplibregl-ctrl-attrib a": { color: "var(--mui-palette-text-secondary)" },
          ".maplibregl-ctrl-attrib a:hover": { color: "var(--mui-palette-primary-main)" },
          ".maplibregl-ctrl-attrib a[href*='neptun']": { color: "var(--mui-palette-primary-main)", fontWeight: 600 },
          ".region-tip .maplibregl-popup-content": {
            padding: "5px 10px",
            borderRadius: 8,
            fontSize: 12,
            background: "var(--mui-palette-background-paper)",
            color: "var(--mui-palette-text-primary)",
            boxShadow: "0 2px 10px rgba(0,0,0,.35)",
          },
          ".region-tip .maplibregl-popup-tip": { display: "none" },
          ".thr-popup .maplibregl-popup-tip": { display: "none" },
          ".thr-popup .maplibregl-popup-content": {
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--mui-palette-background-paper)",
            color: "var(--mui-palette-text-primary)",
            boxShadow: "0 6px 24px rgba(0,0,0,.35)",
            fontSize: 12.5,
            maxHeight: "60vh",
            overflowY: "auto",
          },
          ".thr-popup .maplibregl-popup-close-button": { color: "var(--mui-palette-text-secondary)", fontSize: 18, padding: "2px 8px" },
          ".thr-card-head": { display: "flex", alignItems: "center", gap: 8, fontSize: 15, paddingRight: 18 },
          ".thr-card-dot": { width: 22, height: 22, flexShrink: 0 },
          ".thr-card-sub": { color: "var(--mui-palette-text-secondary)", marginTop: 2 },
          ".thr-card-note": { margin: "8px 0", lineHeight: 1.35 },
          ".thr-card dl": { display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px", margin: "8px 0 0" },
          ".thr-card dt": { color: "var(--mui-palette-text-secondary)", whiteSpace: "nowrap" },
          ".thr-card dd": { margin: 0, overflowWrap: "anywhere" },
          ".thr-card-copy": {
            marginTop: 10,
            width: "100%",
            padding: "6px 10px",
            border: "1px solid var(--mui-palette-divider)",
            borderRadius: 8,
            background: "transparent",
            color: "var(--mui-palette-primary-main)",
            font: "inherit",
            fontWeight: 600,
            cursor: "pointer",
          },
          ".thr-card-copy:hover": { background: "var(--mui-palette-action-hover)" },
          ".maplibregl-ctrl button.focus-ua": {
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%23333'%3E%3Cpath d='M5 15H3v4c0 1.1.9 2 2 2h4v-2H5zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2m0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3'/%3E%3C/svg%3E")`,
          },
          ".thr": { position: "relative", cursor: "pointer", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))" },
          ".thr-goal": { borderRadius: "50%", outline: "2px dashed var(--c)", outlineOffset: 6 },
          ".thr-n": {
            position: "absolute",
            right: -10,
            top: -10,
            minWidth: 16,
            padding: "0 3px",
            borderRadius: 8,
            background: "#222",
            color: "#fff",
            fontSize: 10,
            lineHeight: "16px",
            textAlign: "center",
          },
        }}
      />
      <Box ref={el} sx={{ position: "absolute", inset: 0 }} />
      <Legend />
    </Box>
  );
}
