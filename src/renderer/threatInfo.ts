import type { Location } from "../shared/types";
import { distanceKm } from "./geo";
import type { Threat } from "./neptun";
import { formatTime } from "./AlertsPanel";
import { threatMeta } from "./texts";
import { lookOf, markerSvg } from "./silhouettes";

const CONFIDENCE: Record<string, string> = { low: "низька", medium: "середня", high: "висока" };
const STATUS: Record<string, string> = { active: "активна", stale: "застаріла", resolved: "завершена" };
const LIFECYCLE: Record<string, string> = { confirmed: "підтверджена", uncertain: "непідтверджена" };
const POSITION: Record<string, string> = { confirmed: "підтверджена", approx: "приблизна" };
const COMPASS = ["Пн", "ПнСх", "Сх", "ПдСх", "Пд", "ПдЗх", "Зх", "ПнЗх"];

/** Fields shown with a label below; anything else the API sends is listed raw at the end. */
const KNOWN = new Set([
  "id", "type", "title", "region", "district", "locality", "lat", "lon", "heading", "velocity", "trail",
  "confidenceLevel", "displayConfidence", "sourceCount", "status", "lifecycle", "positionQuality",
  "uncertaintyKm", "updatedAt", "confirmedAt", "explanationShort", "advisory", "areaOnly", "count",
  "destination", "presumptiveCourse", "sea",
]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function ago(iso?: string): string {
  const at = Date.parse(iso ?? "");
  if (Number.isNaN(at)) return "";
  const min = Math.max(0, Math.round((Date.now() - at) / 60_000));
  const rel = min < 1 ? "щойно" : min < 60 ? `${min} хв тому` : `${Math.floor(min / 60)} год ${min % 60} хв тому`;
  return `${formatTime(iso)} (${rel})`;
}

/** Every piece of the API record, as label/value rows in Ukrainian. */
export function threatDetails(x: Threat, loc?: Location): [string, string][] {
  const raw = x as unknown as Record<string, unknown>;
  const rows: [string, string | number | null | undefined | false][] = [];
  const heading = num(x.heading) ?? num(x.velocity?.bearingDeg);
  const speed = num(x.velocity?.speedKmh);
  const lat = num(x.lat);
  const lon = num(x.lon);

  rows.push(["Кількість", (x.count ?? 0) > 1 && x.count]);
  rows.push(["Місце", [...new Set([x.locality, x.district, x.region].filter(Boolean))].join(", ")]);
  if (x.areaOnly) rows.push(["Позиція", "відома лише область"]);
  else if (lat !== null && lon !== null) {
    rows.push(["Координати", `${lat.toFixed(4)}, ${lon.toFixed(4)}`]);
    if (loc) rows.push(["До локації", `${Math.round(distanceKm(loc.lat, loc.lon, lat, lon))} км (${loc.name})`]);
  }
  if (x.destination) rows.push(["Точка", "напрямок руху, а не поточна позиція"]);
  if (heading !== null) {
    const dir = COMPASS[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
    rows.push(["Курс", `${Math.round(heading)}° ${dir}${x.presumptiveCourse ? " (припущення)" : ""}`]);
  }
  rows.push(["Швидкість", speed !== null && speed > 0 && `${Math.round(speed)} км/год`]);
  rows.push(["Якість позиції", x.positionQuality && (POSITION[x.positionQuality] ?? x.positionQuality)]);
  rows.push(["Похибка", num(x.uncertaintyKm) !== null && `± ${x.uncertaintyKm} км`]);
  rows.push(["Достовірність", x.confidenceLevel && (CONFIDENCE[x.confidenceLevel] ?? x.confidenceLevel)]);
  const shown = raw.displayConfidence as string | undefined;
  if (shown && shown !== x.confidenceLevel) rows.push(["Достовірність (на карті)", CONFIDENCE[shown] ?? shown]);
  rows.push(["Підтверджень", num(x.sourceCount)]);
  rows.push(["Статус", x.status && (STATUS[x.status] ?? x.status)]);
  rows.push(["Стан треку", typeof raw.lifecycle === "string" && (LIFECYCLE[raw.lifecycle] ?? raw.lifecycle)]);
  rows.push(["Підтверджено", ago(raw.confirmedAt as string | undefined)]);
  rows.push(["Оновлено", ago(x.updatedAt)]);
  rows.push(["Точок треку", x.trail?.length]);
  if (x.advisory) rows.push(["Тип запису", "спостереження, не сигнал укриття"]);
  if (raw.sea) rows.push(["Над морем", "так"]);

  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN.has(key) || value === null || value === undefined || value === "") continue;
    rows.push([key === "regionKey" ? "Ключ регіону" : key, typeof value === "object" ? JSON.stringify(value) : String(value)]);
  }
  rows.push(["ID", x.id]);

  return rows
    .filter((row): row is [string, string | number] => row[1] !== undefined && row[1] !== null && row[1] !== false && row[1] !== "")
    .map(([label, value]) => [label, String(value)]);
}

/** The popup's content, built as DOM text: the API is third-party and never goes in as HTML. */
export function threatCard(x: Threat, loc?: Location): HTMLElement {
  const meta = threatMeta(x.type);
  const card = document.createElement("div");
  card.className = "thr-card";

  const head = document.createElement("div");
  head.className = "thr-card-head";
  const dot = document.createElement("span");
  dot.className = "thr-card-dot";
  const look = lookOf(x);
  dot.innerHTML = markerSvg(look.visual, look.color, null, 22);
  const name = document.createElement("strong");
  name.textContent = `${meta.name}${(x.count ?? 0) > 1 ? ` ×${x.count}` : ""}`;
  head.append(dot, name);
  card.append(head);

  if (x.title && x.title !== meta.name) {
    const title = document.createElement("div");
    title.className = "thr-card-sub";
    title.textContent = x.title;
    card.append(title);
  }
  if (x.explanationShort) {
    const note = document.createElement("div");
    note.className = "thr-card-note";
    note.textContent = x.explanationShort;
    card.append(note);
  }

  const rows = threatDetails(x, loc);
  const table = document.createElement("dl");
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    table.append(dt, dd);
  }
  card.append(table);

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "thr-card-copy";
  copy.textContent = "Копіювати";
  copy.onclick = async () => {
    const text = [name.textContent, x.explanationShort, ...rows.map(([label, value]) => `${label}: ${value}`)]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Скопійовано ✓";
    } catch {
      copy.textContent = "Не вдалося скопіювати";
    }
    setTimeout(() => (copy.textContent = "Копіювати"), 1500);
  };
  card.append(copy);
  return card;
}
