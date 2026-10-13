import { useEffect, useState } from "react";
import { on } from "./shortcuts";
import { Box, Card, CardContent, Chip, Tab, Tabs, Typography } from "@mui/material";
import type { Location } from "../shared/types";
import { useNeptun, type Threat } from "./neptun";
import { locationAlerts } from "./sounds";
import { t } from "./texts";
import TargetsTab from "./TargetsTab";
import AlertsTab, { type RegionRef } from "./AlertsTab";

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

function remembered(): number {
  try {
    return localStorage.getItem("panel:tab") === "alerts" ? 1 : 0;
  } catch {
    return 0;
  }
}

export default function AlertsPanel({
  location,
  onFocus,
  region,
  onRegion,
}: {
  location?: Location;
  onFocus: (lat: number, lon: number, id: string) => void;
  region: RegionRef | null;
  onRegion: (r: RegionRef | null) => void;
}) {
  const { raions, oblasts, threats, alertsLoaded } = useNeptun();
  const [tab, setTab] = useState(remembered);
  const mine = location ? locationAlerts(location, raions, oblasts) : [];
  const reasons = [...new Set(mine.flatMap((a) => a.reasons ?? []))];
  const since = mine.map((a) => a.since ?? "").sort()[0];

  useEffect(() => {
    const a = on("tab:targets", () => pickTab(0));
    const b = on("tab:alerts", () => pickTab(1));
    return () => (a(), b());
  }, []);

  const pickTab = (value: number) => {
    setTab(value);
    try {
      localStorage.setItem("panel:tab", value === 1 ? "alerts" : "targets");
    } catch {}
  };

  return (
    <Box sx={{ overflow: "auto", borderRight: 1, borderColor: "divider", p: 1.5, pt: 1.5 }}>
      <Card variant="outlined" sx={{ mb: 1 }}>
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

      <Tabs
        value={tab}
        onChange={(_e, v) => pickTab(v)}
        variant="fullWidth"
        sx={{ position: "sticky", top: -12, zIndex: 1, bgcolor: "background.default", mb: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label={`${t.targets} · ${threats.length}`} />
        <Tab label={`${t.alertsTab} · ${raions.length + oblasts.length}`} />
      </Tabs>

      {tab === 0 && <TargetsTab location={location} onFocus={(x) => onFocus(x.lat!, x.lon!, x.id)} />}
      {tab === 1 && <AlertsTab selected={region} onSelect={onRegion} />}
    </Box>
  );
}
