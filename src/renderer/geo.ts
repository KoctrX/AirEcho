import type { Feature, Geometry, Position } from "geojson";

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Initial bearing from one point to another, degrees clockwise from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

/** The point `km` ahead along a bearing — flat-earth, fine for the short course line it draws. */
export function ahead(lat: number, lon: number, heading: number, km: number): [number, number] {
  const h = (heading * Math.PI) / 180;
  return [lon + (km * Math.sin(h)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(h)) / 111.32];
}

/** A radius on the map: maplibre has no geographic circle, so it is drawn as a polygon. */
export function circleRing(lat: number, lon: number, km: number, steps = 96): Position[] {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
}

function outerRings(geometry: Geometry | null): Position[][] {
  if (geometry?.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

function inRing(lat: number, lon: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ponytail: holes ignored — fine for oblast/raion lookups, add them if a region ever wraps another.
export function pointInFeature(lat: number, lon: number, feature: Feature<Geometry | null>): boolean {
  return outerRings(feature.geometry).some((ring) => inRing(lat, lon, ring));
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/**
 * The region's centre, for its label and the default location: the area centroid of its largest
 * ring. ponytail: can fall outside a strongly concave shape; the user can move the point.
 */
export function featureCenter(feature: Feature<Geometry | null>): [number, number] {
  const ring = outerRings(feature.geometry).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0] ?? [];
  const area = ringArea(ring);
  if (ring.length === 0 || area === 0) return [ring[0]?.[1] ?? 0, ring[0]?.[0] ?? 0];
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
  }
  return [y / (6 * area), x / (6 * area)];
}

/** West-south and east-north corners of a region, for fitting the map to it. */
export function featureBounds(feature: Feature<Geometry | null>): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of outerRings(feature.geometry)) {
    for (const [x, y] of ring) {
      w = Math.min(w, x); e = Math.max(e, x);
      s = Math.min(s, y); n = Math.max(n, y);
    }
  }
  return [[w, s], [e, n]];
}

/** The region's outline as an SVG path fitted into a `size` box — the icon next to an alert. */
export function shapePath(
  feature: Feature<Geometry | null>,
  size: number,
  /** Draw in another region's frame — a raion inside its oblast's icon. */
  frame = featureBounds(feature),
): string {
  const [[w, s], [e, n]] = frame;
  if (!Number.isFinite(w)) return "";
  // Longitude degrees shrink towards the pole: scale them, or every region looks too wide.
  const kx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const scale = (size - 2) / Math.max((e - w) * kx, n - s);
  const dx = (size - (e - w) * kx * scale) / 2;
  const dy = (size - (n - s) * scale) / 2;
  return outerRings(feature.geometry)
    .map((ring) => {
      // A 28px icon needs a few dozen points, not the border's thousands.
      const step = Math.max(1, Math.floor(ring.length / 120));
      const points = ring.filter((_, i) => i % step === 0);
      return `M${points.map(([x, y]) => `${(dx + (x - w) * kx * scale).toFixed(1)} ${(dy + (n - y) * scale).toFixed(1)}`).join("L")}Z`;
    })
    .join("");
}

/** The whole world with the region cut out: filled dark, it dims everything but the region. */
export function maskAround(feature: Feature<Geometry | null>): Feature {
  const world: Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...outerRings(feature.geometry)] } };
}
