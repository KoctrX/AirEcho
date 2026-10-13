import { useSyncExternalStore } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { featureCenter, pointInFeature } from "./geo";

/**
 * NEPTUN's open API — no key, read-only, CORS open. Ported from bots_controls (lib/alerts).
 * Live data comes over the WebSocket; REST is the fallback while the socket is down, polled no
 * more often than every 5 s (their CDN rule). Messages have no stream frame, so they are polled.
 */
const BASE = "https://neptun.in.ua";
const STREAM_URL = "wss://neptun.in.ua/api/v1/stream";
const POLL_MS = 10_000;
/** NEPTUN's rule: their REST snapshot is CDN-cached for a few seconds, never poll it more often. */
export const MIN_POLL_S = 5;
/** No frame at all for this long means dead, not idle — heartbeats keep a quiet feed talking. */
const SILENCE_MS = 90_000;
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;
const MAX_MESSAGES = 300;

export interface AlertRegion {
  key: string;
  name: string;
  oblast: string;
  since?: string;
  /** `red` is the siren, `yellow` the lesser level. */
  level?: string;
  /** Why, in their words: "Ракетна загроза (червоний рівень)". Undocumented, read defensively. */
  reasons?: string[];
}

export interface Threat {
  id: string;
  type: string;
  title: string;
  region: string;
  district: string;
  locality: string;
  lat?: number;
  lon?: number;
  heading?: number | null;
  velocity?: { bearingDeg?: number | null; speedKmh?: number | null } | null;
  trail?: { lat?: number; lon?: number; t?: string }[] | null;
  confidenceLevel?: string;
  status?: string;
  explanationShort?: string;
  /** An observation, not a "take cover" signal: shown calmly, never voiced. */
  advisory?: boolean;
  /** Only the oblast is known; lat/lon is its centroid and must not be drawn as a place. */
  areaOnly?: boolean;
  updatedAt?: string;
  confirmedAt?: string;
  count?: number;
  sourceCount?: number | null;
  uncertaintyKm?: number | null;
  /** `confirmed`, or `approx` for an area-only record. */
  positionQuality?: string;
  lifecycle?: string;
  /** The point is where it is heading ("курсом на Фастів"), not where it is. */
  destination?: boolean | null;
  /** The heading is their assumption, not a measured course. */
  presumptiveCourse?: boolean | null;
}

export interface FeedMessage {
  channel: string;
  text: string;
  date: string;
}

export interface FeedSource {
  handle: string;
  title: string;
  kind: string;
  region: string;
}

export interface Place {
  key: string;
  name: string;
  /** For a raion, the oblast it lies in; for an oblast, itself. */
  oblastKey: string;
  oblastName: string;
  raion: boolean;
  lat: number;
  lon: number;
}

export interface Catalog {
  oblasts: FeatureCollection;
  raions: FeatureCollection;
  places: Place[];
}

export interface NeptunState {
  connected: boolean;
  /** False until the first real answer: an empty list before it means "not known", not "none". */
  alertsLoaded: boolean;
  threatsLoaded: boolean;
  raions: AlertRegion[];
  oblasts: AlertRegion[];
  threats: Threat[];
  messages: FeedMessage[];
  sources: FeedSource[];
  catalog: Catalog | null;
}

let state: NeptunState = {
  connected: false,
  alertsLoaded: false,
  threatsLoaded: false,
  raions: [],
  oblasts: [],
  threats: [],
  messages: [],
  sources: [],
  catalog: null,
};
const listeners = new Set<() => void>();
const threats = new Map<string, Threat>();
let alertsVersion = -1;

/**
 * When NEPTUN last said anything — a frame, a heartbeat, a poll answer. Kept outside the state: a
 * heartbeat should not re-render the app, and the "updated N s ago" label reads it on its own tick.
 */
let lastHeard = 0;
const heard = (): void => void (lastHeard = Date.now());
export const lastUpdate = (): number => lastHeard;

function set(patch: Partial<NeptunState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = (): NeptunState => state;
export const useNeptun = (): NeptunState => useSyncExternalStore(subscribe, getState);

async function getJson<T>(path: string): Promise<T | null> {
  try {
    // `no-store`: their answers carry `max-age=5, stale-while-revalidate=25` and no validator, so
    // from the browser cache we would show the previous answer while a background request fetched
    // the new one. Our own interval (never under 5 s, their rule) is the cache.
    const res = await fetch(`${BASE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function setAlerts(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const { raions, oblasts, version } = data as { raions?: AlertRegion[]; oblasts?: AlertRegion[]; version?: number };
  if (!Array.isArray(raions) && !Array.isArray(oblasts)) return;
  // Socket and poll feed the same state: a late, older answer must not undo a newer one.
  if (typeof version === "number") {
    if (version < alertsVersion) return;
    alertsVersion = version;
  }
  set({ raions: raions ?? [], oblasts: oblasts ?? [], alertsLoaded: true });
}

const live = (t: Threat): boolean => typeof t?.id === "string" && t.status !== "resolved";

function publishThreats(): void {
  set({ threats: [...threats.values()], threatsLoaded: true });
}

function replaceThreats(list: unknown): void {
  if (!Array.isArray(list)) return;
  threats.clear();
  for (const t of list as Threat[]) if (live(t)) threats.set(t.id, t);
  publishThreats();
}

function connect(): void {
  let retryMs = RETRY_MIN_MS;

  const open = () => {
    const socket = new WebSocket(STREAM_URL);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const giveUp = () => {
      if (closed) return;
      closed = true;
      clearTimeout(watchdog);
      set({ connected: false });
      try {
        socket.close();
      } catch {}
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };
    const alive = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(giveUp, SILENCE_MS);
    };

    socket.onopen = () => {
      retryMs = RETRY_MIN_MS;
      set({ connected: true });
      alive();
    };
    socket.onmessage = (event) => {
      alive();
      heard();
      let frame: { type?: string; data?: any };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      switch (frame.type) {
        case "snapshot":
          setAlerts(frame.data);
          replaceThreats(frame.data?.threats);
          return;
        case "alerts":
          setAlerts(frame.data);
          return;
        case "upsert":
          if (!live(frame.data)) threats.delete(frame.data?.id);
          else threats.set(frame.data.id, frame.data);
          publishThreats();
          return;
        case "remove":
          if (threats.delete(frame.data?.id)) publishThreats();
          return;
      }
    };
    socket.onerror = giveUp;
    socket.onclose = giveUp;
  };

  open();
}

const messageKey = (m: FeedMessage): string => `${m.channel}|${m.date}|${m.text}`;

async function pollMessages(): Promise<void> {
  const data = await getJson<{ messages?: FeedMessage[] }>("/api/v1/messages");
  if (data) heard();
  const fresh = (data?.messages ?? []).filter((m) => typeof m?.text === "string" && m.text.trim() !== "");
  if (fresh.length === 0) return;
  const seen = new Set(state.messages.map(messageKey));
  const added = fresh.filter((m) => !seen.has(messageKey(m)));
  if (added.length === 0) return;
  const messages = [...added, ...state.messages].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_MESSAGES);
  set({ messages });
}

async function pollFallback(): Promise<void> {
  if (state.connected) return;
  const [alerts, list] = await Promise.all([
    getJson<unknown>("/api/v1/alerts"),
    getJson<{ threats?: Threat[] }>("/api/v1/threats"),
  ]);
  if (state.connected) return;
  if (alerts || list) heard();
  setAlerts(alerts);
  replaceThreats(list?.threats);
}

async function loadCatalog(): Promise<void> {
  const [oblasts, raions, sources] = await Promise.all([
    window.api.getGeo("oblasts").catch(() => null),
    window.api.getGeo("raions").catch(() => null),
    getJson<{ sources?: FeedSource[] }>("/api/v1/sources"),
  ]);
  set({ sources: (sources?.sources ?? []).filter((s) => typeof s?.handle === "string" && s.handle !== "") });
  if (!oblasts || !raions) return void setTimeout(loadCatalog, POLL_MS);

  const props = (f: Feature<Geometry | null>) => (f.properties ?? {}) as Record<string, string>;
  const oblastPlaces: Place[] = oblasts.features.map((f) => {
    const p = props(f);
    const [lat, lon] = featureCenter(f);
    // An oblast carries `region`, the two cities that are regions of their own carry `name`.
    const name = p.region ?? p.name ?? p.key;
    return { key: p.key, name, oblastKey: p.key, oblastName: name, raion: false, lat, lon };
  });
  const raionPlaces: Place[] = raions.features.map((f) => {
    const p = props(f);
    const [lat, lon] = featureCenter(f);
    // The raion file does not say which oblast a raion is in; its centre does.
    const index = oblasts.features.findIndex((o) => pointInFeature(lat, lon, o));
    const oblast = oblastPlaces[index];
    return {
      key: p.key,
      name: p.rayon ?? p.key,
      oblastKey: oblast?.key ?? "",
      oblastName: oblast?.name ?? "",
      raion: true,
      lat,
      lon,
    };
  });
  const places = [...oblastPlaces, ...raionPlaces].sort((a, b) => a.name.localeCompare(b.name, "uk"));
  set({ catalog: { oblasts, raions, places } });
}

/** How often the feed (and, while the socket is down, alerts and targets) is asked again. */
let pollMs = POLL_MS;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * One poll loop at a time. A loop whose request is still in flight when the interval changes (or
 * "update now" is pressed) must not carry on beside the new one — that doubled every request.
 */
let loop = 0;

async function poll(): Promise<void> {
  const mine = ++loop;
  clearTimeout(pollTimer);
  await Promise.all([pollMessages(), pollFallback()]);
  if (mine === loop) pollTimer = setTimeout(poll, pollMs);
}

/** Takes effect at once: the next poll is rescheduled from now. */
export function setPollInterval(seconds: number): void {
  pollMs = Math.max(MIN_POLL_S, seconds) * 1000;
  if (!started) return;
  loop++;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, pollMs);
}

/** "Update now": ask for everything polled straight away, then carry on at the usual pace. */
export const refreshNow = (): Promise<void> => poll();

let started = false;
export function start(): void {
  if (started) return;
  started = true;
  connect();
  loadCatalog();
  pollMessages();
  // The socket usually answers first; the REST fallback only steps in if it has not.
  pollTimer = setTimeout(poll, 2000);
}
