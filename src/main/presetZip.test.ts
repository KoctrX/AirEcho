import { expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { Preset } from "../shared/types";
import { readPresetZip, writePresetZip } from "./presetZip";

const preset: Preset = {
  format: "airecho-preset", version: 1, id: "p", name: "Мій",
  tracks: [{ id: "t1", trigger: { kind: "threat", type: "ballistic" }, file: "audio/t1.webm" }],
};

it("round-trips a preset with its audio", () => {
  const zip = writePresetZip(preset, { "audio/t1.webm": new Uint8Array([1, 2, 3]) });
  const back = readPresetZip(zip);
  expect(back.preset).toEqual(preset);
  expect([...back.audio["audio/t1.webm"]]).toEqual([1, 2, 3]);
});

it("rejects entries outside audio/", () => {
  const zip = zipSync({ "manifest.json": strToU8(JSON.stringify(preset)), "../evil.sh": strToU8("x"), "audio/t1.webm": new Uint8Array(1) });
  expect(() => readPresetZip(zip)).toThrow(/Недозволений/);
});

it("rejects a manifest pointing at a path outside audio/", () => {
  const bad = { ...preset, tracks: [{ ...preset.tracks[0], file: "../../x.webm" }] };
  expect(() => readPresetZip(zipSync({ "manifest.json": strToU8(JSON.stringify(bad)) }))).toThrow(/структуру/);
});
