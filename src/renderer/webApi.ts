import type { FeatureCollection } from "geojson";
import { DEFAULT_SETTINGS, type Api, type Preset, type Settings } from "../shared/types";
import { readPresetZip, writePresetZip } from "../main/presetZip";

/**
 * `window.api` for the browser build (GitHub Pages), where there is no Electron main process.
 * Settings live in localStorage; presets and their sounds in IndexedDB (sounds are blobs, far past
 * localStorage's few megabytes). Sounds are handed to <audio> as object URLs, kept ready in memory
 * so `audioUrl` can stay synchronous like Electron's custom protocol.
 */

const SETTINGS_KEY = "airecho:settings";
const DB = "airecho";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("presets");
      req.result.createObjectStore("audio");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Opened on first use: this module is also loaded in Electron, which never touches it.
let opened: Promise<IDBDatabase> | undefined;

async function run<T>(store: "presets" | "audio", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await (opened ??= openDb())).transaction(store, mode);
  const req = fn(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** `presetId/audio/file.ext` → object URL of the stored blob. */
const urls = new Map<string, string>();
const audioKey = (presetId: string, file: string) => `${presetId}/${file}`;

function remember(key: string, blob: Blob): void {
  const old = urls.get(key);
  if (old) URL.revokeObjectURL(old);
  urls.set(key, URL.createObjectURL(blob));
}

async function putAudio(presetId: string, file: string, blob: Blob): Promise<void> {
  await run("audio", "readwrite", (s) => s.put(blob, audioKey(presetId, file)));
  remember(audioKey(presetId, file), blob);
}

async function dropAudio(prefix: string): Promise<void> {
  const keys = (await run("audio", "readonly", (s) => s.getAllKeys())) as string[];
  for (const key of keys.filter((k) => k.startsWith(prefix))) {
    await run("audio", "readwrite", (s) => s.delete(key));
    const url = urls.get(key);
    if (url) URL.revokeObjectURL(url);
    urls.delete(key);
  }
}

/** First run: the bundled default preset, fetched from the site next to the page. */
async function seedDefault(): Promise<void> {
  const manifest = (await (await fetch("default-preset/manifest.json")).json()) as Preset;
  await run("presets", "readwrite", (s) => s.put(manifest, manifest.id));
  for (const track of manifest.tracks) {
    if (!track.file) continue;
    const res = await fetch(`default-preset/${track.file}`);
    if (res.ok) await putAudio(manifest.id, track.file, await res.blob());
  }
}

let loaded = false;
async function listPresets(): Promise<Preset[]> {
  let presets = (await run("presets", "readonly", (s) => s.getAll())) as Preset[];
  if (presets.length === 0) {
    await seedDefault();
    presets = (await run("presets", "readonly", (s) => s.getAll())) as Preset[];
  }
  // Have every sound ready as a URL before anything asks for one.
  if (!loaded) {
    const keys = (await run("audio", "readonly", (s) => s.getAllKeys())) as string[];
    for (const key of keys) {
      if (urls.has(key)) continue;
      const blob = (await run("audio", "readonly", (s) => s.get(key))) as Blob | undefined;
      if (blob) remember(key, blob);
    }
    loaded = true;
  }
  return presets;
}

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file picker as a promise; null when the person closes it without choosing. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function createWebApi(): Api {
  return {
    web: true,
    async getSettings() {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") } as Settings;
      } catch {
        return DEFAULT_SETTINGS;
      }
    },
    async setSettings(settings) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    },
    listPresets,
    async savePreset(preset) {
      await run("presets", "readwrite", (s) => s.put(preset, preset.id));
    },
    async deletePreset(id) {
      await run("presets", "readwrite", (s) => s.delete(id));
      await dropAudio(`${id}/`);
    },
    async saveAudio(presetId, trackId, ext, bytes) {
      // A re-recorded track may change format: drop the old file so export does not ship both.
      await dropAudio(`${presetId}/audio/${trackId}.`);
      const file = `audio/${trackId}.${ext}`;
      await putAudio(presetId, file, new Blob([bytes as BlobPart]));
      return file;
    },
    async exportPreset(id) {
      const preset = (await run("presets", "readonly", (s) => s.get(id))) as Preset | undefined;
      if (!preset) return false;
      const audio: Record<string, Uint8Array> = {};
      for (const track of preset.tracks) {
        if (!track.file) continue;
        const blob = (await run("audio", "readonly", (s) => s.get(audioKey(id, track.file)))) as Blob | undefined;
        if (blob) audio[track.file] = new Uint8Array(await blob.arrayBuffer());
      }
      download(`${preset.name}.airecho`, writePresetZip(preset, audio));
      return true;
    },
    async importPreset() {
      const file = await pickFile(".airecho,.zip");
      if (!file) return null;
      const { preset, audio } = readPresetZip(new Uint8Array(await file.arrayBuffer()));
      preset.id = crypto.randomUUID();
      await run("presets", "readwrite", (s) => s.put(preset, preset.id));
      for (const [path, bytes] of Object.entries(audio)) await putAudio(preset.id, path, new Blob([bytes as BlobPart]));
      return preset;
    },
    // Copies of NEPTUN's boundary files, published with the site: theirs carry no CORS header.
    async getGeo(name) {
      const res = await fetch(`geo/${name}.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as FeatureCollection;
    },
    showWindow() {
      window.focus();
    },
    audioUrl(presetId, file) {
      return urls.get(audioKey(presetId, file)) ?? "";
    },
  };
}
