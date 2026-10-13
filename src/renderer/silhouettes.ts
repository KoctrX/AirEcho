import { bearing } from "./geo";
import type { Threat } from "./neptun";
import { threatMeta, THREATS } from "./texts";

const finite = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/**
 * Target silhouettes, ported from bots_controls (lib/air/markers.ts): a shape per real thing, not
 * per feed type — people read the map by shape. Filled in the type's colour with a white outline
 * so it reads over any tiles, turned to the course when there is one.
 */

type Point = [number, number];

/** Drawn on the right half, nose first, and mirrored: the two sides cannot disagree. */
function mirrored(right: Point[]): string {
  const left = right.slice(1, -1).reverse().map(([x, y]): Point => [24 - x, y]);
  return `M${[...right, ...left].map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
}

interface Shape {
  body: string;
  parts?: string[];
  lines?: { d: string; width: number }[];
  circles?: [number, number, number][];
  /** A decoy is drawn as an outline: it is a fake, and looks like one. */
  hollow?: boolean;
  /** The box on the map, in pixels. A missile is the thing to see first. */
  size: number;
  /** A quadcopter has no nose, so it is not turned. */
  turns: boolean;
}

const SHAPES = {
  // Shahed-136 / Geran-2: thin fuselage, big delta wing, fins at the tips, pusher propeller.
  shahed: {
    body: mirrored([[12, 1.5], [12.9, 4.2], [13.1, 9], [21.5, 19.2], [21.5, 21.6], [13.4, 20], [12.9, 21.2], [12, 21.6]]),
    lines: [{ d: "M8.4 23H15.6", width: 1.4 }],
    size: 32,
    turns: true,
  },
  // Geran-3: the same delta with a turbojet — the body swells into a round nozzle at the back.
  geran3: {
    body: mirrored([[12, 1.4], [12.9, 4], [13.1, 9.4], [20.6, 18.6], [20.6, 20.4], [15, 19.6], [15, 22], [13.6, 23], [12, 23]]),
    circles: [[12, 22.3, 1.3]],
    size: 32,
    turns: true,
  },
  // Gerbera: a foam decoy shaped like a small Shahed, drawn hollow.
  gerbera: {
    body: mirrored([[12, 2.6], [12.8, 5], [13, 9.4], [20, 18], [20, 19.8], [13.2, 18.8], [12, 19.6]]),
    lines: [{ d: "M9.2 21.4H14.8", width: 1.1 }],
    hollow: true,
    size: 26,
    turns: true,
  },
  // FPV: four rotors on an X around a hub.
  fpv: {
    body: "M10 10 H14 V14 H10 Z",
    lines: [{ d: "M7 7 L17 17 M17 7 L7 17", width: 2.4 }],
    circles: [[6, 6, 3], [18, 6, 3], [6, 18, 3], [18, 18, 3]],
    size: 24,
    turns: false,
  },
  // Molniya: a small plane — long straight wing, slim fuselage, tailplane, pusher propeller.
  molniya: {
    body: mirrored([[12, 2.6], [12.8, 4.2], [13, 7], [22.4, 7.4], [22.4, 9.8], [13, 10], [13, 17.4], [16.4, 18], [16.4, 19.8], [13, 19.6], [12.6, 21], [12, 21.2]]),
    lines: [{ d: "M9.6 22.6H14.4", width: 1.2 }],
    size: 28,
    turns: true,
  },
  // Lancet: wings in an X.
  lancet: {
    body: mirrored([[12, 1.6], [12.9, 3.6], [13, 18.6], [12.7, 21.8], [12, 22.2]]),
    lines: [{ d: "M3.8 6.6 L20.2 17.4 M20.2 6.6 L3.8 17.4", width: 2.2 }],
    size: 28,
    turns: true,
  },
  // Orlan / Zala / Supercam: straight wing, twin booms, H-tail.
  recon: {
    body: mirrored([[12, 3.4], [13.3, 5], [13.4, 8], [22.6, 8.4], [22.6, 11], [13.4, 11.4], [13, 14.2], [12, 14.8]]),
    parts: ["M7.4 19.2H16.6V21.2H7.4Z"],
    lines: [{ d: "M8.4 11V20.4 M15.6 11V20.4", width: 1.3 }],
    size: 30,
    turns: true,
  },
  // Guided glide bomb: thick blunt body, short wings at the back, tail fins.
  kab: {
    body: mirrored([[12, 1.8], [13.8, 2.6], [15, 5], [15, 11], [19.8, 11.8], [19.8, 14], [15, 14.6], [15, 19], [17.4, 20.8], [17.4, 22], [12, 21.4]]),
    size: 28,
    turns: true,
  },
  // Cruise missile (Kh-101 and kin): long thin body, narrow swept wings mid-body, small tailplane.
  cruise: {
    body: mirrored([[12, 1.2], [12.8, 2.6], [13, 6.8], [13, 9.8], [19.4, 14.6], [19.4, 16], [13, 14.8], [13, 18.8], [16, 21.4], [16, 22.6], [12.7, 21.8], [12, 22.6]]),
    size: 36,
    turns: true,
  },
  // Kalibr: longer body, short straight wings far back, cross fins.
  kalibr: {
    body: mirrored([[12, 1], [12.9, 2.6], [13.2, 6], [13.2, 12.6], [18.6, 12.8], [18.6, 14.6], [13.2, 15], [13.2, 17.8], [16, 20], [16, 21.4], [13, 20.6], [12, 22]]),
    size: 36,
    turns: true,
  },
  // Kh-59: thicker body, big swept wings set well forward.
  kh59: {
    body: mirrored([[12, 1.2], [13.4, 2.8], [13.6, 7], [13.6, 8.8], [21.6, 13.8], [21.6, 15.6], [13.6, 14.8], [13.6, 18.4], [17.4, 20.6], [17.4, 22], [13, 21.4], [12, 22.2]]),
    size: 38,
    turns: true,
  },
  // Iskander / KN-23: a needle with canards behind the nose and big tail fins — no wings.
  iskander: {
    body: mirrored([[12, 0.8], [13.1, 3.4], [13.5, 6.8], [15.6, 8.4], [15.6, 9.8], [13.5, 9.4], [13.5, 17], [17.4, 21.6], [17.4, 23], [13.4, 21.8], [12, 23]]),
    size: 40,
    turns: true,
  },
  // Zircon / Onyx / Kinzhal: slimmer than an Iskander, short strakes mid-body, small tail.
  hypersonic: {
    body: mirrored([[12, 0.8], [12.8, 3], [13, 8], [15.8, 9.6], [15.8, 11.2], [13, 10.6], [13, 18], [15.4, 21], [15.4, 22.4], [12.8, 21.8], [12, 22.6]]),
    size: 38,
    turns: true,
  },
  other: { body: "M12 3 L18 19 L12 15.5 L6 19 Z", size: 24, turns: true },
} satisfies Record<string, Shape>;

export type Visual = keyof typeof SHAPES;

/** The default silhouette of each NEPTUN `type`. */
const BY_TYPE: Record<string, Visual> = {
  uav: "shahed",
  recon: "recon",
  fpv: "fpv",
  missile: "cruise",
  ballistic: "iskander",
  kab: "kab",
  mig31k: "hypersonic",
};

/**
 * The silhouette of one record: its type's, refined by the title where the feed files a specific
 * model under a generic type (matched on stems — the feed writes in Ukrainian and Russian). The
 * title only refines within a family: a drone's title never turns it into a missile.
 */
export function visualOf(type: string, title: string): Visual {
  const text = title.toLowerCase();
  if (type === "uav" || type === "recon") {
    if (/молн|molni/.test(text)) return "molniya";
    if (/ланцет|lancet/.test(text)) return "lancet";
    if (/гербер|gerber/.test(text)) return "gerbera";
    if (/реактив|герань-3|geran-3/.test(text)) return "geran3";
    if (/орлан|orlan|zala|supercam|суперкам|розвід|разведыв|recon|елерон|eleron|форпост|forpost/.test(text)) return "recon";
  }
  if (type === "missile") {
    if (/калібр|калибр|kalibr/.test(text)) return "kalibr";
    if (/х-59|х-69|kh-59|x-59/.test(text)) return "kh59";
  }
  if (type === "ballistic" && /циркон|zircon|онікс|оникс|onyx|кинджал|кинжал|kinzhal/.test(text)) return "hypersonic";
  return BY_TYPE[type] ?? "other";
}

export function markerSize(visual: Visual, scale = 1): number {
  return Math.round(SHAPES[visual].size * scale);
}

/** The silhouette as SVG markup. Our own constants only — no feed text goes in here. */
export function markerSvg(
  visual: Visual,
  color: string,
  heading: number | null,
  size = markerSize(visual),
  /** On the map: no reported course. The silhouette then sits small in a round chip, so its nose does not read as "north". */
  courseUnknown = false,
): string {
  const shape: Shape = SHAPES[visual];
  const fill = shape.hollow
    ? `fill="${color}" fill-opacity="0.28" stroke="${color}" stroke-width="1.6"`
    : `fill="${color}" stroke="#fff" stroke-width="1.3"`;
  // A hollow shape needs a white edge under its coloured one to read over tiles.
  const underlay = shape.hollow ? `<path d="${shape.body}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round"/>` : "";
  const lines = (shape.lines ?? []).map(
    ({ d, width }) =>
      `<path d="${d}" fill="none" stroke="#fff" stroke-width="${width + 1.8}" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`,
  );
  const circles = (shape.circles ?? []).map(
    ([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="0.85" stroke="#fff" stroke-width="1"/>`,
  );
  const parts = (shape.parts ?? []).map((d) => `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/>`);
  // An unknown heading is not turned: a made-up one would claim a direction nobody reported.
  const turn = shape.turns && heading !== null ? `transform:rotate(${Math.round(heading)}deg);` : "";
  // Lines under the body, so a wing crossing the fuselage does not cut it.
  const drawing = lines.join("") + underlay + `<path d="${shape.body}" ${fill} stroke-linejoin="round"/>` + parts.join("") + circles.join("");
  const chip = courseUnknown && shape.turns;
  const body = chip
    ? `<circle cx="12" cy="12" r="11.4" fill="#15181e" fill-opacity="0.85" stroke="${color}" stroke-width="1.4"/>` +
      `<g transform="translate(12 12) scale(0.66) translate(-12 -12)">${drawing}</g>`
    : drawing;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;overflow:visible;${turn}">${body}</svg>`;
}

/** Trail points with a position, oldest first (sorted on read, not trusted). */
function trailOf(x: Threat): [number, number][] {
  return (x.trail ?? [])
    .filter((p) => finite(p?.lat) !== null && finite(p?.lon) !== null)
    .sort((a, b) => (a.t ?? "").localeCompare(b.t ?? ""))
    .map((p) => [p.lon!, p.lat!]);
}

/**
 * How one track is drawn, as in the reference project: its silhouette and colour, the course
 * (reported, or else the way it has come), and how solid — a track nobody confirmed, or whose
 * point is a guess, is drawn fainter; an observation fainter still.
 */
export function lookOf(x: Threat) {
  const visual = visualOf(x.type, x.title ?? "");
  const color = visual === "recon" ? THREATS.recon.color : threatMeta(x.type).color;
  let heading = finite(x.heading) ?? finite(x.velocity?.bearingDeg);
  const trail = trailOf(x);
  const lat = finite(x.lat);
  const lon = finite(x.lon);
  if (heading === null && trail.length > 0 && lat !== null && lon !== null) {
    const [plon, plat] = trail[trail.length - 1];
    // No reported course: the way it has come says where it points.
    if (Math.abs(plat - lat) > 1e-4 || Math.abs(plon - lon) > 1e-4) heading = bearing(plat, plon, lat, lon);
  }
  const solid = x.lifecycle === "confirmed" && x.positionQuality !== "approx";
  const fade = x.advisory ? 0.45 : solid ? 1 : 0.55;
  return { visual, color, heading, trail, fade };
}

/** The map legend: every silhouette in the colour it is drawn in, most common first. */
export const LEGEND: { visual: Visual; name: string; type: string }[] = [
  { visual: "shahed", name: "Шахед (Герань-2)", type: "uav" },
  { visual: "geran3", name: "Реактивний шахед (Герань-3)", type: "uav" },
  { visual: "gerbera", name: "Гербера (хибна ціль)", type: "uav" },
  { visual: "lancet", name: "Ланцет", type: "uav" },
  { visual: "molniya", name: "Молнія", type: "uav" },
  { visual: "recon", name: "Розвідувальний БпЛА", type: "recon" },
  { visual: "fpv", name: "FPV-дрон", type: "fpv" },
  { visual: "kab", name: "КАБ", type: "kab" },
  { visual: "cruise", name: "Крилата ракета", type: "missile" },
  { visual: "kalibr", name: "Калібр", type: "missile" },
  { visual: "kh59", name: "Х-59 / Х-69", type: "missile" },
  { visual: "iskander", name: "Балістика (Іскандер)", type: "ballistic" },
  { visual: "hypersonic", name: "Циркон / Кинджал", type: "ballistic" },
  { visual: "other", name: "Невідома ціль", type: "unknown" },
];
