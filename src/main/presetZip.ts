import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { AUDIO_EXTENSIONS, type Preset, type Track } from "../shared/types";

const MAX_BYTES = 50 * 1024 * 1024;
const AUDIO_PATH = new RegExp(`^audio/[A-Za-z0-9_-]+\\.(${AUDIO_EXTENSIONS.join("|")})$`);

export function writePresetZip(preset: Preset, audio: Record<string, Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(preset, null, 2)) };
  for (const [path, bytes] of Object.entries(audio)) files[path] = bytes;
  return zipSync(files);
}

function validTrack(track: unknown): track is Track {
  if (!track || typeof track !== "object") return false;
  const { id, trigger, file } = track as Track;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return false;
  if (typeof file !== "string" || (file !== "" && !AUDIO_PATH.test(file))) return false;
  switch (trigger?.kind) {
    case "alertStart":
    case "alertEnd":
      return true;
    case "threat":
      return typeof trigger.type === "string";
    case "keyword":
      return (
        Array.isArray(trigger.channels) &&
        Array.isArray(trigger.keywords) &&
        [...trigger.channels, ...trigger.keywords].every((s) => typeof s === "string")
      );
    default:
      return false;
  }
}

/**
 * Reads a shared `.airecho` file. Untrusted input: everything is checked before a byte touches
 * the disk — only `manifest.json` and `audio/<safe-name>.<audio-ext>` are accepted, so no entry
 * can escape the preset folder.
 */
export function readPresetZip(bytes: Uint8Array): { preset: Preset; audio: Record<string, Uint8Array> } {
  if (bytes.byteLength > MAX_BYTES) throw new Error("Файл завеликий");
  let total = 0;
  const entries = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (total > MAX_BYTES) throw new Error("Файл завеликий");
      return true;
    },
  });

  for (const path of Object.keys(entries)) {
    if (path.endsWith("/")) continue;
    if (path !== "manifest.json" && !AUDIO_PATH.test(path)) throw new Error(`Недозволений файл у пресеті: ${path}`);
  }

  const raw = entries["manifest.json"];
  if (!raw) throw new Error("У файлі немає manifest.json");
  let manifest: Preset;
  try {
    manifest = JSON.parse(strFromU8(raw));
  } catch {
    throw new Error("manifest.json пошкоджено");
  }
  if (manifest?.format !== "airecho-preset" || manifest.version !== 1) throw new Error("Невідомий формат пресета");
  if (typeof manifest.name !== "string" || !Array.isArray(manifest.tracks) || !manifest.tracks.every(validTrack)) {
    throw new Error("manifest.json має неправильну структуру");
  }

  const audio: Record<string, Uint8Array> = {};
  for (const track of manifest.tracks) {
    if (!track.file) continue;
    const data = entries[track.file];
    if (!data) throw new Error(`Немає аудіофайлу ${track.file}`);
    audio[track.file] = data;
  }
  const preset: Preset = {
    format: "airecho-preset",
    version: 1,
    id: manifest.id,
    name: manifest.name.slice(0, 100),
    tracks: manifest.tracks.map(({ id, trigger, file }) => ({ id, trigger, file })),
  };
  return { preset, audio };
}
