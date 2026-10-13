import { useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  Chip,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Stack,
  Typography,
} from "@mui/material";
import type { Location } from "../shared/types";
import { distanceKm } from "./geo";
import { useNeptun, type AlertRegion, type Threat } from "./neptun";
import { isNear, locationAlerts } from "./sounds";
import { t, threatMeta } from "./texts";
import { lookOf, markerSvg } from "./silhouettes";

export function formatTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" })} ${time}`;
}

export function place(threat: Threat): string {
  return [...new Set([threat.locality, threat.district, threat.region].filter(Boolean))].join(", ");
}

export default function AlertsPanel({
  location,
  onFocus,
}: {
  location?: Location;
  onFocus: (lat: number, lon: number, id: string) => void;
}) {
  const { raions, oblasts, threats, alertsLoaded } = useNeptun();
  const mine = location ? locationAlerts(location, raions, oblasts) : [];
  const reasons = [...new Set(mine.flatMap((a) => a.reasons ?? []))];
  const since = mine.map((a) => a.since ?? "").sort()[0];

  // One row per oblast: the whole oblast, or the raions in it that are on alert.
  const byOblast = useMemo(() => {
    const groups = new Map<string, { whole?: AlertRegion; raions: AlertRegion[] }>();
    for (const o of oblasts) groups.set(o.name, { whole: o, raions: [] });
    for (const r of raions) {
      const group = groups.get(r.oblast) ?? { raions: [] };
      group.raions.push(r);
      groups.set(r.oblast, group);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "uk"));
  }, [raions, oblasts]);

  const sorted = useMemo(() => {
    const near = (x: Threat) => (location && isNear(x, location) ? 0 : 1);
    return [...threats].sort((a, b) => near(a) - near(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [threats, location]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const x of threats) c.set(threatMeta(x.type).name, (c.get(threatMeta(x.type).name) ?? 0) + Math.max(1, x.count ?? 1));
    return [...c.entries()];
  }, [threats]);

  return (
    <Box sx={{ overflow: "auto", borderRight: 1, borderColor: "divider", p: 1.5 }}>
      <Card variant="outlined" sx={{ mb: 1.5 }}>
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            {t.myLocation}
          </Typography>
          {!location ? (
            <Typography color="text.secondary">{t.addLocationHint}</Typography>
          ) : (
            <>
              <Typography variant="h6">{location.name}</Typography>
              {alertsLoaded && (
                <Chip
                  sx={{ mt: 1 }}
                  color={mine.length ? "error" : "success"}
                  label={mine.length ? `${t.alert} ${t.since} ${formatTime(since)}` : t.noAlert}
                />
              )}
              {reasons.map((r) => (
                <Typography key={r} variant="body2" sx={{ mt: 1 }}>
                  {r}
                </Typography>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <List dense subheader={<ListSubheader disableSticky>{`${t.targets} · ${threats.length}`}</ListSubheader>}>
        {counts.length > 0 && (
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, px: 2, pb: 1 }}>
            {counts.map(([name, n]) => (
              <Chip key={name} size="small" label={`${name} ${n}`} />
            ))}
          </Stack>
        )}
        {threats.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
            {t.noTargets}
          </Typography>
        )}
        {sorted.map((x) => {
          const meta = threatMeta(x.type);
          const near = location && isNear(x, location);
          const km =
            location && !x.areaOnly && x.lat !== undefined && x.lon !== undefined
              ? `${Math.round(distanceKm(location.lat, location.lon, x.lat, x.lon))} км`
              : "";
          const notes = [place(x), formatTime(x.updatedAt), km, x.areaOnly ? t.areaOnly : "", x.advisory ? t.advisory : ""];
          return (
            <ListItemButton
              key={x.id}
              disabled={x.areaOnly || x.lat === undefined}
              onClick={() => onFocus(x.lat!, x.lon!, x.id)}
              sx={{ borderRadius: 2, mb: 0.5, bgcolor: near ? "action.selected" : undefined, opacity: x.advisory ? 0.6 : 1 }}
            >
              <Box
                component="span"
                sx={{ width: 24, height: 24, mr: 1.5, flexShrink: 0, opacity: lookOf(x).fade }}
                // Our own SVG constants, no feed text: safe as markup.
                dangerouslySetInnerHTML={{ __html: markerSvg(lookOf(x).visual, lookOf(x).color, null, 24) }}
              />
              <ListItemText
                primary={`${meta.name}${(x.count ?? 0) > 1 ? ` ×${x.count}` : ""}${near ? ` · ${t.inRadius}` : ""}`}
                secondary={notes.filter(Boolean).join(" · ")}
              />
            </ListItemButton>
          );
        })}
      </List>

      <List dense subheader={<ListSubheader disableSticky>{`${t.activeAlerts} · ${byOblast.length}`}</ListSubheader>}>
        {byOblast.map(([name, group]) => (
          <ListItemText
            key={name}
            sx={{ px: 2, py: 0.5, m: 0 }}
            primary={name}
            secondary={
              group.whole
                ? `${t.since} ${formatTime(group.whole.since)}`
                : group.raions.map((r) => r.name).join(", ")
            }
          />
        ))}
      </List>
    </Box>
  );
}
