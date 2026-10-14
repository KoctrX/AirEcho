import type { Location, Preset, Track } from "../shared/types";
import { distanceKm } from "./geo";
import type { AlertRegion, FeedMessage, NeptunState, Threat } from "./neptun";
import { t, threatMeta, THREATS } from "./texts";

export type SoundEvent =
  | { kind: "alertStart"; regions: AlertRegion[] }
  | { kind: "alertEnd" }
  | { kind: "threat"; threat: Threat }
  | { kind: "message"; message: FeedMessage };

type Feed = Pick<NeptunState, "raions" | "oblasts" | "threats" | "messages" | "alertsLoaded" | "threatsLoaded">;

/** The alert entries that cover a location: its raion's, or the whole oblast's. */
export function locationAlerts(loc: Location, raions: AlertRegion[], oblasts: AlertRegion[]): AlertRegion[] {
  return [
    ...raions.filter((r) => loc.raionKey !== "" && r.key === loc.raionKey),
    ...oblasts.filter((o) => o.key === loc.oblastKey),
  ];
}

/** In the location's radius — or, for a record that only names an oblast, in its oblast. */
export function isNear(threat: Threat, loc: Location): boolean {
  if (threat.areaOnly) return threat.region !== "" && threat.region === loc.oblastName;
  if (!Number.isFinite(threat.lat) || !Number.isFinite(threat.lon)) return false;
  return distanceKm(loc.lat, loc.lon, threat.lat!, threat.lon!) <= loc.radiusKm;
}

const messageKey = (m: FeedMessage): string => `${m.channel}|${m.date}|${m.text}`;

/**
 * Turns successive full states of the feed into "something happened" events. The first state
 * after start (or after switching location) is only remembered: whatever is in it began before
 * we were looking, and voicing all of it at once would be noise, not a warning.
 */
export function createDetector() {
  let locationId: string | undefined;
  let active: boolean | null = null;
  let threatsPrimed = false;
  const announced = new Set<string>();
  let messagesPrimed = false;
  const seenMessages = new Set<string>();

  return function detect(loc: Location | undefined, feed: Feed): SoundEvent[] {
    const events: SoundEvent[] = [];
    if (loc?.id !== locationId) {
      locationId = loc?.id;
      active = null;
      threatsPrimed = false;
      announced.clear();
    }

    if (loc && feed.alertsLoaded) {
      const regions = locationAlerts(loc, feed.raions, feed.oblasts);
      const now = regions.length > 0;
      if (active !== null && now !== active) events.push(now ? { kind: "alertStart", regions } : { kind: "alertEnd" });
      active = now;
    }

    if (loc && feed.threatsLoaded) {
      for (const threat of feed.threats) {
        // An observation is never voiced, and is not marked either: if it turns into a real
        // threat later, that is the moment to speak.
        if (threat.advisory || announced.has(threat.id) || !isNear(threat, loc)) continue;
        announced.add(threat.id);
        if (threatsPrimed) events.push({ kind: "threat", threat });
      }
      threatsPrimed = true;
    }

    if (feed.messages.length > 0) {
      for (const message of feed.messages) {
        const key = messageKey(message);
        if (seenMessages.has(key)) continue;
        seenMessages.add(key);
        if (messagesPrimed) events.push({ kind: "message", message });
      }
      messagesPrimed = true;
    }
    return events;
  };
}

export const normalize = (text: string): string => text.toLowerCase().replace(/[ʼ’`]/g, "'");

/** The preset's track for an event, if it has one. */
export function matchTrack(preset: Preset | undefined, event: SoundEvent): Track | undefined {
  return preset?.tracks.find(({ trigger }) => {
    switch (event.kind) {
      case "alertStart":
      case "alertEnd":
        return trigger.kind === event.kind;
      case "threat": {
        const type = event.threat.type in THREATS ? event.threat.type : "unknown";
        return trigger.kind === "threat" && trigger.type === type;
      }
      case "message": {
        if (trigger.kind !== "keyword" || trigger.keywords.length === 0) return false;
        const channel = event.message.channel.toLowerCase();
        if (trigger.channels.length > 0 && !trigger.channels.some((c) => c.toLowerCase() === channel)) return false;
        const text = normalize(event.message.text);
        return trigger.keywords.some((k) => normalize(k).trim() !== "" && text.includes(normalize(k).trim()));
      }
    }
  });
}

/**
 * What to tell the user, or null when the event is not worth a notification (a channel post
 * that matched no keyword track). `key` groups repeats: the same key within the quiet window
 * is announced once.
 */
export function describe(
  event: SoundEvent,
  loc: Location | undefined,
  track: Track | undefined,
): { key: string; title: string; body: string } | null {
  switch (event.kind) {
    case "alertStart":
      return {
        key: "alertStart",
        title: t.alert,
        body: [loc?.name, ...new Set(event.regions.flatMap((r) => r.reasons ?? []))].filter(Boolean).join(" · "),
      };
    case "alertEnd":
      return { key: "alertEnd", title: t.alertEnd, body: loc?.name ?? "" };
    case "threat": {
      const { threat } = event;
      const where = [...new Set([threat.locality, threat.district, threat.region].filter(Boolean))].join(", ");
      const km =
        loc && !threat.areaOnly && threat.lat !== undefined && threat.lon !== undefined
          ? ` · ${Math.round(distanceKm(loc.lat, loc.lon, threat.lat, threat.lon))} км`
          : "";
      return { key: `threat:${threat.type}`, title: threatMeta(threat.type).name, body: `${where}${km}` };
    }
    case "message":
      if (!track) return null;
      return { key: `kw:${track.id}`, title: `${t.keywordHit} ${event.message.channel}`, body: event.message.text.slice(0, 240) };
  }
}

const QUIET_MS = 30_000;

/**
 * Sounds one after another, never on top of each other; repeats inside the window dropped.
 * While muted, notifications still show (silently) and nothing plays.
 */
export function createAnnouncer(onClick: () => void, muted: () => boolean) {
  const queue: string[] = [];
  const last = new Map<string, number>();
  let playing = false;

  const next = () => {
    const url = queue.shift();
    if (!url || muted()) {
      queue.length = 0;
      return void (playing = false);
    }
    playing = true;
    const audio = new Audio(url);
    audio.onended = next;
    audio.onerror = next;
    audio.play().catch(next);
  };

  return (note: { key: string; title: string; body: string }, url: string | null) => {
    const now = Date.now();
    if (now - (last.get(note.key) ?? 0) < QUIET_MS) return;
    last.set(note.key, now);
    const quiet = muted();
    const notification = new Notification(note.title, { body: note.body, silent: url !== null || quiet });
    notification.onclick = onClick;
    if (url && !quiet) {
      queue.push(url);
      if (!playing) next();
    }
  };
}

export const audioUrl = (presetId: string, file: string): string =>
  window.api.audioUrl?.(presetId, file) ?? `airecho://preset/${presetId}/${file}?v=${Date.now()}`;
