import { describe as group, expect, it } from "vitest";
import type { Location, Preset } from "../shared/types";
import { createDetector, matchTrack } from "./sounds";

const kyiv: Location = {
  id: "home", name: "Дім", raionKey: "", oblastKey: "м. київ", oblastName: "м. Київ",
  lat: 50.45, lon: 30.52, radiusKm: 50,
};
const empty = { raions: [], oblasts: [], threats: [], messages: [], alertsLoaded: true, threatsLoaded: true };
const kyivAlert = { key: "м. київ", name: "м. Київ", oblast: "", reasons: ["Ракетна загроза"] };
const shahed = (id: string, lat: number, lon: number, extra = {}) =>
  ({ id, type: "uav", title: "", region: "", district: "", locality: "", lat, lon, ...extra });

group("detector", () => {
  it("remembers the first state and announces only changes", () => {
    const detect = createDetector();
    expect(detect(kyiv, { ...empty, oblasts: [kyivAlert] })).toEqual([]);
    expect(detect(kyiv, empty)).toEqual([{ kind: "alertEnd" }]);
    expect(detect(kyiv, { ...empty, oblasts: [kyivAlert] })[0]).toMatchObject({ kind: "alertStart" });
  });

  it("waits for real data before priming", () => {
    const detect = createDetector();
    expect(detect(kyiv, { ...empty, alertsLoaded: false })).toEqual([]);
    expect(detect(kyiv, { ...empty, oblasts: [kyivAlert] })).toEqual([]);
  });

  it("announces a threat once, when it enters the radius", () => {
    const detect = createDetector();
    detect(kyiv, { ...empty, threats: [shahed("a", 50.45, 30.52)] });
    const far = shahed("b", 49.0, 36.2);
    expect(detect(kyiv, { ...empty, threats: [far] })).toEqual([]);
    const close = shahed("b", 50.5, 30.6);
    expect(detect(kyiv, { ...empty, threats: [close] })).toEqual([{ kind: "threat", threat: close }]);
    expect(detect(kyiv, { ...empty, threats: [close] })).toEqual([]);
  });

  it("matches area-only threats by oblast and never voices advisories", () => {
    const detect = createDetector();
    detect(kyiv, empty);
    const area = shahed("c", 0, 0, { areaOnly: true, region: "м. Київ" });
    const advisory = shahed("d", 50.45, 30.52, { advisory: true });
    expect(detect(kyiv, { ...empty, threats: [area, advisory] })).toEqual([{ kind: "threat", threat: area }]);
  });

  it("re-primes after switching location", () => {
    const detect = createDetector();
    detect(kyiv, { ...empty, oblasts: [kyivAlert] });
    expect(detect({ ...kyiv, id: "other" }, empty)).toEqual([]);
  });
});

group("matchTrack", () => {
  const preset: Preset = {
    format: "airecho-preset", version: 1, id: "p", name: "p",
    tracks: [
      { id: "t1", trigger: { kind: "threat", type: "uav" }, file: "audio/t1.wav" },
      { id: "t2", trigger: { kind: "keyword", channels: ["@kpszsu"], keywords: ["Вибух"] }, file: "" },
      { id: "t3", trigger: { kind: "threat", type: "unknown" }, file: "" },
    ],
  };
  const msg = (channel: string, text: string) => ({ kind: "message" as const, message: { channel, text, date: "" } });

  it("finds keyword tracks by channel and case-insensitive text", () => {
    expect(matchTrack(preset, msg("@kpszsu", "Чути вибухи"))?.id).toBe("t2");
    expect(matchTrack(preset, msg("@other", "Чути вибухи"))).toBeUndefined();
  });

  it("maps unseen threat types to unknown", () => {
    expect(matchTrack(preset, { kind: "threat", threat: shahed("x", 0, 0) })?.id).toBe("t1");
    expect(matchTrack(preset, { kind: "threat", threat: shahed("x", 0, 0, { type: "laser" }) })?.id).toBe("t3");
  });
});
