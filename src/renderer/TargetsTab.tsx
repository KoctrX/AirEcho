import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import type { Location } from "../shared/types";
import { distanceKm } from "./geo";
import { useNeptun, type Threat } from "./neptun";
import { isNear } from "./sounds";
import { saveSettings, useApp } from "./store";
import { lookOf, markerSvg, visualOf } from "./silhouettes";
import { t, threatMeta, THREATS } from "./texts";
import { formatTime, place } from "./AlertsPanel";

/** NEPTUN's type, or `unknown` for one we have no name for — the key of a folder and of hiding. */
export const typeKey = (type: string): string => (type in THREATS ? type : "unknown");

const units = (list: Threat[]): number => list.reduce((n, x) => n + Math.max(1, x.count ?? 1), 0);

function remembered(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function remember(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

function Silhouette({ html, dim }: { html: string; dim?: number }) {
  // Our own SVG constants, no feed text: safe as markup.
  return <Box component="span" sx={{ width: 24, height: 24, flexShrink: 0, display: "inline-flex", opacity: dim }} dangerouslySetInnerHTML={{ __html: html }} />;
}

function TargetRow({ x, location, hidden, onFocus }: { x: Threat; location?: Location; hidden: boolean; onFocus: (x: Threat) => void }) {
  const meta = threatMeta(x.type);
  const look = lookOf(x);
  const near = location && isNear(x, location);
  const km =
    location && !x.areaOnly && x.lat !== undefined && x.lon !== undefined
      ? `${Math.round(distanceKm(location.lat, location.lon, x.lat, x.lon))} км`
      : "";
  const notes = [place(x), formatTime(x.updatedAt), km, x.areaOnly ? t.areaOnly : "", x.advisory ? t.advisory : ""];
  return (
    <ListItemButton
      disabled={x.areaOnly || x.lat === undefined}
      onClick={() => onFocus(x)}
      sx={{ borderRadius: 2, mb: 0.5, gap: 1.5, bgcolor: near ? "action.selected" : undefined, opacity: hidden ? 0.45 : x.advisory ? 0.6 : 1 }}
    >
      <Silhouette html={markerSvg(look.visual, look.color, null, 24)} dim={look.fade} />
      <ListItemText
        primary={`${meta.name}${(x.count ?? 0) > 1 ? ` ×${x.count}` : ""}${near ? ` · ${t.inRadius}` : ""}`}
        secondary={notes.filter(Boolean).join(" · ")}
      />
    </ListItemButton>
  );
}

export default function TargetsTab({ location, onFocus }: { location?: Location; onFocus: (x: Threat) => void }) {
  const { threats } = useNeptun();
  const { settings } = useApp();
  const hidden = new Set(settings.hiddenTypes);
  const [grouped, setGrouped] = useState(() => remembered("targets:grouped", false));
  const [closed, setClosed] = useState<Set<string>>(new Set());

  // In your radius first, then the freshest.
  const sorted = useMemo(() => {
    const near = (x: Threat) => (location && isNear(x, location) ? 0 : 1);
    return [...threats].sort((a, b) => near(a) - near(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [threats, location]);

  const groups = useMemo(
    () =>
      Object.keys(THREATS)
        .map((type) => ({ type, list: sorted.filter((x) => typeKey(x.type) === type) }))
        .filter((g) => g.list.length > 0),
    [sorted],
  );

  const setHidden = (type: string, hide: boolean) => {
    const next = new Set(hidden);
    if (hide) next.add(type);
    else next.delete(type);
    saveSettings({ hiddenTypes: [...next] });
  };
  const toggleFolder = (type: string) => {
    const next = new Set(closed);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setClosed(next);
  };

  return (
    <>
      <Stack direction="row" sx={{ alignItems: "center", px: 0.5, mb: 1 }}>
        <FormControlLabel
          sx={{ mr: "auto", ml: 0 }}
          control={
            <Switch
              size="small"
              checked={grouped}
              onChange={(e) => {
                setGrouped(e.target.checked);
                remember("targets:grouped", e.target.checked);
              }}
            />
          }
          label={<Typography variant="body2">{t.groupByType}</Typography>}
        />
      </Stack>
      <Stack direction="row" sx={{ gap: 1, px: 0.5, mb: 1 }}>
        <Button size="small" variant="outlined" startIcon={<VisibilityIcon />} sx={{ flex: 1 }} onClick={() => saveSettings({ hiddenTypes: [] })}>
          {t.showAll}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<VisibilityOffIcon />}
          sx={{ flex: 1 }}
          onClick={() => saveSettings({ hiddenTypes: Object.keys(THREATS) })}
        >
          {t.hideAll}
        </Button>
      </Stack>

      {threats.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          {t.noTargets}
        </Typography>
      )}

      {!grouped && (
        <List dense disablePadding>
          {sorted.map((x) => (
            <TargetRow key={x.id} x={x} location={location} hidden={hidden.has(typeKey(x.type))} onFocus={onFocus} />
          ))}
        </List>
      )}

      {grouped &&
        groups.map(({ type, list }) => {
          const meta = threatMeta(type);
          const open = !closed.has(type);
          const off = hidden.has(type);
          return (
            <Box key={type} sx={{ mb: 0.5 }}>
              <ListItemButton onClick={() => toggleFolder(type)} sx={{ borderRadius: 2, gap: 1, py: 0.5, pr: 0.5 }}>
                {open ? <ExpandMoreIcon fontSize="small" color="action" /> : <ChevronRightIcon fontSize="small" color="action" />}
                <Silhouette html={markerSvg(visualOf(type, ""), meta.color, null, 24)} dim={off ? 0.45 : 1} />
                <Typography variant="subtitle2" sx={{ flex: 1, opacity: off ? 0.6 : 1 }}>
                  {meta.name}
                </Typography>
                <Box
                  sx={{ px: 1, borderRadius: 3, fontSize: 12, fontWeight: 600, bgcolor: "action.selected", color: "text.secondary" }}
                >
                  {units(list)}
                </Box>
                <Checkbox
                  size="small"
                  checked={!off}
                  title={off ? t.showOnMap : t.hideOnMap}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setHidden(type, !e.target.checked)}
                />
              </ListItemButton>
              <Collapse in={open} unmountOnExit>
                <List dense disablePadding sx={{ pl: 2 }}>
                  {list.map((x) => (
                    <TargetRow key={x.id} x={x} location={location} hidden={off} onFocus={onFocus} />
                  ))}
                </List>
              </Collapse>
            </Box>
          );
        })}
    </>
  );
}
