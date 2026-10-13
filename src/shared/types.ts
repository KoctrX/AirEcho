/** Types shared by the main process (files on disk) and the renderer (UI and sound engine). */

export interface Location {
  id: string;
  name: string;
  /** Raion key from `/raions.geojson`; empty when the location is a whole oblast. */
  raionKey: string;
  /** Oblast key from `/oblasts.geojson` (`харківська`, `м. київ`). */
  oblastKey: string;
  /** Oblast name as NEPTUN writes it on threats (`Харківська область`). */
  oblastName: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

export type ThemeMode = "system" | "light" | "dark";

export interface Settings {
  locations: Location[];
  activeLocationId: string;
  theme: ThemeMode;
  /** Whether the feed is limited to `channels`; off shows every channel. */
  channelsFiltered: boolean;
  /** Lower-cased `@handles` shown in the feed while the filter is on (may be empty: show none). */
  channels: string[];
  activePresetId: string;
  /** NEPTUN target types hidden from the map (still listed and still voiced). */
  hiddenTypes: string[];
  /** Sound off until this time (ms since epoch); 0 = sound on, -1 = off until turned back on. */
  muteUntil: number;
}

export type Trigger =
  | { kind: "alertStart" }
  | { kind: "alertEnd" }
  | { kind: "threat"; type: string }
  | { kind: "keyword"; channels: string[]; keywords: string[] };

export interface Track {
  id: string;
  trigger: Trigger;
  /** `audio/<file>` inside the preset folder; empty until a sound is attached. */
  file: string;
}

export interface Preset {
  format: "airecho-preset";
  version: 1;
  id: string;
  name: string;
  tracks: Track[];
}

export const DEFAULT_SETTINGS: Settings = {
  locations: [],
  activeLocationId: "",
  theme: "system",
  channelsFiltered: false,
  channels: [],
  activePresetId: "default",
  muteUntil: 0,
  hiddenTypes: [],
};

export const isMuted = (settings: Settings, now = Date.now()): boolean =>
  settings.muteUntil === -1 || settings.muteUntil > now;

export const AUDIO_EXTENSIONS = ["mp3", "ogg", "wav", "webm", "m4a"];

export interface Api {
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  listPresets(): Promise<Preset[]>;
  savePreset(preset: Preset): Promise<void>;
  deletePreset(id: string): Promise<void>;
  /** Writes the sound for a track and returns its `audio/...` path. */
  saveAudio(presetId: string, trackId: string, ext: string, bytes: Uint8Array): Promise<string>;
  exportPreset(id: string): Promise<boolean>;
  /** The imported preset, or null when the dialog was cancelled. Throws on a bad file. */
  importPreset(): Promise<Preset | null>;
  /** NEPTUN boundary GeoJSON, fetched by the main process (no CORS on those files). */
  getGeo(name: "oblasts" | "raions"): Promise<import("geojson").FeatureCollection>;
  showWindow(): void;
}
