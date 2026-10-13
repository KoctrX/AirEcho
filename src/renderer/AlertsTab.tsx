import { useEffect, useMemo, useState } from "react";
import { alpha, Box, ButtonBase, Typography } from "@mui/material";
import type { Feature, Geometry } from "geojson";
import { featureBounds, shapePath } from "./geo";
import { useNeptun, type AlertRegion } from "./neptun";
import { formatTime } from "./AlertsPanel";
import { t } from "./texts";

export type RegionRef = { kind: "oblast" | "raion"; key: string };

const LEVEL = {
  red: { color: "#e53935", label: "Червоний рівень" },
  yellow: { color: "#f9a825", label: "Жовтий рівень" },
};
const levelOf = (a: AlertRegion) => (a.level === "yellow" ? LEVEL.yellow : LEVEL.red);

/** "2 год 15 хв", "3 дн", "3 р." — how long the alert has been on. */
export function duration(since: string | undefined, now: number): string {
  const at = Date.parse(since ?? "");
  if (Number.isNaN(at)) return "";
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 60) return `${min} хв`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} год ${min % 60} хв`;
  const days = Math.floor(hours / 24);
  return days < 365 ? `${days} дн` : `${Math.floor(days / 365)} р.`;
}

/** "Ракетна загроза (червоний рівень)" → "Ракетна загроза": the level is shown by colour. */
const reasonText = (a: AlertRegion): string =>
  [...new Set((a.reasons ?? []).map((r) => r.replace(/\s*\(.*\)\s*$/, "")))].join(", ") || t.alert;

interface Layer {
  feature?: Feature<Geometry | null>;
  fill: string;
  stroke: string;
}

/** A region's outline as an icon; more layers are drawn in the first one's frame (raions in their oblast). */
function Shape({ layers, size }: { layers: Layer[]; size: number }) {
  const paths = useMemo(() => {
    const frame = layers[0]?.feature ? featureBounds(layers[0].feature) : undefined;
    return layers.map((l) => (l.feature && frame ? shapePath(l.feature, size, frame) : ""));
  }, [layers, size]);
  return (
    <Box component="svg" viewBox={`0 0 ${size} ${size}`} sx={{ width: size, height: size, flexShrink: 0 }}>
      {/* Colours as style, not attributes: a CSS variable only works in style. */}
      {layers.map((l, i) => paths[i] && <path key={i} d={paths[i]} style={{ fill: l.fill, stroke: l.stroke }} strokeWidth={1} strokeLinejoin="round" />)}
    </Box>
  );
}

/** One oblast: a clickable header (the whole oblast), then its raions on alert as compact rows. */
function OblastCard({
  name,
  oblastKey,
  whole,
  raions,
  features,
  now,
  isSelected,
  onPick,
}: {
  name: string;
  oblastKey?: string;
  whole?: AlertRegion;
  raions: AlertRegion[];
  features: { oblast: Map<string, Feature<Geometry | null>>; raion: Map<string, Feature<Geometry | null>> };
  now: number;
  isSelected: (ref: RegionRef) => boolean;
  onPick: (ref: RegionRef) => void;
}) {
  const main = whole ?? raions[0];
  const level = levelOf(main);
  const oblastFeature = oblastKey ? features.oblast.get(oblastKey) : undefined;
  const headerSelected = !!oblastKey && isSelected({ kind: "oblast", key: oblastKey });
  const outline = "color-mix(in srgb, var(--mui-palette-text-primary) 55%, transparent)";
  const icon = useMemo<Layer[]>(
    () => [
      { feature: oblastFeature, fill: whole ? alpha(level.color, 0.45) : "none", stroke: whole ? level.color : outline },
      ...raions.map((r) => ({ feature: features.raion.get(r.key), fill: alpha(levelOf(r).color, 0.7), stroke: levelOf(r).color })),
    ],
    [oblastFeature, whole, raions, features, level.color, outline],
  );
  const longest = [whole, ...raions].filter(Boolean).map((a) => a!.since ?? "").sort()[0];

  return (
    <Box
      sx={{
        mb: 1.25,
        borderRadius: 3,
        overflow: "hidden",
        bgcolor: "background.paper",
        border: 1,
        borderColor: headerSelected ? level.color : "divider",
      }}
    >
      <ButtonBase
        disabled={!oblastKey}
        onClick={() => oblastKey && onPick({ kind: "oblast", key: oblastKey })}
        sx={{
          width: "100%",
          justifyContent: "flex-start",
          textAlign: "left",
          gap: 1.5,
          px: 1.5,
          py: 1.25,
          bgcolor: headerSelected ? alpha(level.color, 0.18) : whole ? alpha(level.color, 0.1) : "transparent",
          "&:hover": { bgcolor: alpha(level.color, 0.16) },
        }}
      >
        <Shape layers={icon} size={44} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {name.replace(/ область$/, "")}
          </Typography>
          <Typography variant="caption" sx={{ color: whole ? level.color : "text.secondary", fontWeight: whole ? 500 : 400 }}>
            {whole ? `${t.wholeOblast} · ${reasonText(whole)}` : `${raions.length} ${plural(raions.length)} ${t.underAlert}`}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right", flexShrink: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {duration(longest, now)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t.since} {formatTime(longest)}
          </Typography>
        </Box>
      </ButtonBase>

      {raions.map((r) => {
        const ref: RegionRef = { kind: "raion", key: r.key };
        const selected = isSelected(ref);
        const rl = levelOf(r);
        return (
          <ButtonBase
            key={r.key}
            onClick={() => onPick(ref)}
            sx={{
              width: "100%",
              justifyContent: "flex-start",
              textAlign: "left",
              gap: 1.25,
              px: 1.5,
              py: 0.9,
              borderTop: 1,
              borderColor: "divider",
              boxShadow: selected ? `inset 3px 0 0 ${rl.color}` : "none",
              bgcolor: selected ? alpha(rl.color, 0.16) : "transparent",
              "&:hover": { bgcolor: alpha(rl.color, 0.1) },
            }}
          >
            <Shape layers={[{ feature: features.raion.get(r.key), fill: alpha(rl.color, 0.45), stroke: rl.color }]} size={28} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                {r.name.replace(/ район$/, "")}
              </Typography>
              <Typography variant="caption" sx={{ color: rl.color }} noWrap component="div">
                {reasonText(r)}
              </Typography>
            </Box>
            <Box sx={{ textAlign: "right", flexShrink: 0 }}>
              <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {duration(r.since, now)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t.since} {formatTime(r.since)}
              </Typography>
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/** "1 район", "3 райони", "5 районів". */
function plural(n: number): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return "район";
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "райони";
  return "районів";
}

export default function AlertsTab({ selected, onSelect }: { selected: RegionRef | null; onSelect: (r: RegionRef | null) => void }) {
  const { raions, oblasts, catalog } = useNeptun();
  const [now, setNow] = useState(Date.now());

  // Durations tick on their own.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const features = useMemo(() => {
    const byKey = (list: Feature<Geometry | null>[] = []) => new Map(list.map((f) => [f.properties?.key as string, f]));
    return { oblast: byKey(catalog?.oblasts.features), raion: byKey(catalog?.raions.features) };
  }, [catalog]);

  // One section per oblast: the whole oblast if it is on alert, then its raions; longest-running first.
  const sections = useMemo(() => {
    const groups = new Map<string, { whole?: AlertRegion; raions: AlertRegion[] }>();
    for (const o of oblasts) groups.set(o.name, { whole: o, raions: [] });
    for (const r of raions) {
      const group = groups.get(r.oblast) ?? { raions: [] };
      group.raions.push(r);
      groups.set(r.oblast, group);
    }
    for (const g of groups.values()) g.raions.sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "uk"));
  }, [raions, oblasts]);

  // A section of raions only still needs its oblast's key, so its header can focus the oblast.
  const oblastKeys = useMemo(
    () => new Map((catalog?.places ?? []).filter((p) => !p.raion).map((p) => [p.name, p.key])),
    [catalog],
  );

  const pick = (ref: RegionRef) => onSelect(selected?.kind === ref.kind && selected.key === ref.key ? null : ref);
  const is = (ref: RegionRef) => selected?.kind === ref.kind && selected.key === ref.key;

  if (sections.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
        {t.noActiveAlerts}
      </Typography>
    );
  }

  return (
    <>
      {sections.map(([name, group]) => (
        <OblastCard
          key={name}
          name={name}
          oblastKey={group.whole?.key ?? oblastKeys.get(name)}
          whole={group.whole}
          raions={group.raions}
          features={features}
          now={now}
          isSelected={is}
          onPick={pick}
        />
      ))}
    </>
  );
}
