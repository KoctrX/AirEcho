import { useEffect, useRef, useState } from "react";
import {
  AppBar,
  Box,
  Chip,
  CssBaseline,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  GlobalStyles,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
  useColorScheme,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import CampaignIcon from "@mui/icons-material/Campaign";
import PlaceIcon from "@mui/icons-material/Place";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import { start, useNeptun } from "./neptun";
import { isMuted } from "../shared/types";
import { getApp, loadApp, saveSettings, useApp } from "./store";
import { emit, typing } from "./shortcuts";
import { audioUrl, createAnnouncer, createDetector, describe, matchTrack } from "./sounds";
import { APP_VERSION, t } from "./texts";
import MapView from "./MapView";
import AlertsPanel from "./AlertsPanel";
import type { RegionRef } from "./AlertsTab";
import FeedPanel from "./FeedPanel";
import SettingsDialog from "./Settings";

const theme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: { palette: { primary: { main: "#3355cc" }, background: { default: "#f3f4f9" } } },
    dark: { palette: { primary: { main: "#9fb4ff" }, background: { default: "#0f1115", paper: "#171a21" } } },
  },
  shape: { borderRadius: 12 },
  typography: { fontFamily: "Roboto, 'Segoe UI', system-ui, sans-serif" },
});

export default function App() {
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      <GlobalStyles
        styles={{
          // Thin, quiet scrollbars that follow the theme instead of the system's grey slabs. CSS
          // variables, not theme.palette: that one holds the light scheme's values in both themes.
          "*::-webkit-scrollbar": { width: 6, height: 6 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            borderRadius: 6,
            background: "color-mix(in srgb, var(--mui-palette-text-primary) 22%, transparent)",
          },
          "*::-webkit-scrollbar-thumb:hover": { background: "color-mix(in srgb, var(--mui-palette-text-primary) 40%, transparent)" },
          "*::-webkit-scrollbar-corner": { background: "transparent" },
        }}
      />
      <Shell />
    </ThemeProvider>
  );
}

const PANEL = { left: 340, right: 380, min: 260, max: 640 };

function storedWidth(side: "left" | "right"): number {
  try {
    const n = Number(localStorage.getItem(`panel:${side}:width`));
    return n >= PANEL.min && n <= PANEL.max ? n : PANEL[side];
  } catch {
    return PANEL[side];
  }
}

/**
 * A drag handle on a panel's inner edge. Drag to resize, double-click for the default width;
 * the width is a per-machine convenience kept in localStorage.
 */
function Resizer({ side, at, onWidth }: { side: "left" | "right"; at: number; onWidth: (w: number) => void }) {
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const grid = e.currentTarget.parentElement!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const raw = side === "left" ? ev.clientX - grid.left : grid.right - ev.clientX;
      onWidth(Math.round(Math.min(PANEL.max, Math.max(PANEL.min, raw))));
    };
    const target = e.currentTarget;
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
  };
  return (
    <Box
      onPointerDown={drag}
      onDoubleClick={() => onWidth(PANEL[side])}
      title={t.resizePanel}
      sx={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side]: at - 4,
        width: 8,
        zIndex: 5,
        cursor: "col-resize",
        "&::after": {
          content: '""',
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 3,
          width: 2,
          bgcolor: "primary.main",
          opacity: 0,
          transition: "opacity .15s",
        },
        "&:hover::after, &:active::after": { opacity: 0.8 },
      }}
    />
  );
}

export type Focus = { lat: number; lon: number; at: number; id?: string };

/** Current time, centred in the top bar — only while the app is fullscreen. */
function FullscreenClock() {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [fullscreen]);

  if (!fullscreen) return null;
  return (
    <Typography
      variant="h6"
      sx={{ position: "absolute", left: "50%", transform: "translateX(-50%)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
    >
      {now.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </Typography>
  );
}

/** Panel visibility is a per-machine convenience: kept in localStorage, fine to lose. */
function usePanel(name: string): [boolean, () => void] {
  const key = `panel:${name}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(key, was ? "0" : "1");
      } catch {}
      return !was;
    });
  return [open, toggle];
}

const MUTE_FOR = [
  { label: t.mute15m, ms: 15 * 60_000 },
  { label: t.mute1h, ms: 60 * 60_000 },
  { label: t.mute8h, ms: 8 * 60 * 60_000 },
];

/** Sound on/off: for a while or until turned back on. Re-renders itself when a timed mute ends. */
function MuteButton({ muteUntil }: { muteUntil: number }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [, tick] = useState(0);
  const muted = muteUntil === -1 || muteUntil > Date.now();

  useEffect(() => {
    if (muteUntil <= Date.now()) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(muteUntil - Date.now() + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [muteUntil]);

  const set = (value: number) => {
    setMenu(null);
    saveSettings({ muteUntil: value });
  };
  const until = new Date(muteUntil).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  const title = !muted ? t.soundOn : muteUntil === -1 ? t.soundOffForever : `${t.soundOffUntil} ${until}`;

  return (
    <>
      <Tooltip title={title}>
        <IconButton onClick={(e) => setMenu(e.currentTarget)} color={muted ? "error" : "default"}>
          {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
        </IconButton>
      </Tooltip>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        {muted && (
          <MenuItem onClick={() => set(0)}>
            <ListItemIcon>
              <VolumeUpIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t.unmute}</ListItemText>
          </MenuItem>
        )}
        {MUTE_FOR.map(({ label, ms }) => (
          <MenuItem key={ms} onClick={() => set(Date.now() + ms)}>
            <ListItemText inset={muted}>{label}</ListItemText>
          </MenuItem>
        ))}
        <MenuItem onClick={() => set(-1)} selected={muteUntil === -1}>
          <ListItemText inset={muted}>{t.muteForever}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

function PanelToggle({ open, onClick, title, mirror }: { open: boolean; onClick: () => void; title: string; mirror?: boolean }) {
  const Icon = open ? ViewSidebarIcon : ViewSidebarOutlinedIcon;
  return (
    <Tooltip title={title}>
      <IconButton onClick={onClick} color={open ? "primary" : "default"}>
        <Icon sx={mirror ? { transform: "scaleX(-1)" } : undefined} />
      </IconButton>
    </Tooltip>
  );
}

function Shell() {
  const { loaded, settings, presets } = useApp();
  const neptun = useNeptun();
  const { mode, systemMode, setMode } = useColorScheme();
  const [settingsOpen, setSettingsOpen] = useState<{ tab?: number } | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [region, setRegion] = useState<RegionRef | null>(null);
  const [left, toggleLeft] = usePanel("left");
  const [right, toggleRight] = usePanel("right");
  // App-wide shortcuts (the list is in shortcuts.ts and in Settings → Клавіші).
  const keys = useRef({ toggleLeft, toggleRight });
  keys.current = { toggleLeft, toggleRight };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && e.code === "Comma") {
        e.preventDefault();
        return setSettingsOpen({});
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === "?") return setSettingsOpen({ tab: 4 });
      if (document.querySelector(".MuiDialog-root")) return;
      switch (e.code) {
        case "F11":
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen();
          else document.body.requestFullscreen();
          return;
        case "KeyF":
          return emit("fit");
        case "BracketLeft":
          return keys.current.toggleLeft();
        case "BracketRight":
          return keys.current.toggleRight();
        case "Digit1":
          return emit("tab:targets");
        case "Digit2":
          return emit("tab:alerts");
        case "KeyL":
          return emit("legend");
        case "KeyM":
          return saveSettings({ muteUntil: isMuted(getApp().settings) ? 0 : -1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [widths, setWidths] = useState({ left: storedWidth("left"), right: storedWidth("right") });
  const setWidth = (side: "left" | "right") => (w: number) => {
    setWidths((was) => ({ ...was, [side]: w }));
    try {
      localStorage.setItem(`panel:${side}:width`, String(w));
    } catch {}
  };
  const detect = useRef(createDetector());
  const announce = useRef(createAnnouncer(() => window.api.showWindow(), () => isMuted(getApp().settings)));

  const location = settings.locations.find((l) => l.id === settings.activeLocationId);
  const preset = presets.find((p) => p.id === settings.activePresetId) ?? presets[0];
  const dark = (mode === "system" ? systemMode : mode) === "dark";

  useEffect(() => {
    loadApp();
    start();
  }, []);

  useEffect(() => {
    if (loaded) setMode(settings.theme);
  }, [loaded, settings.theme, setMode]);

  useEffect(() => {
    if (!loaded) return;
    for (const event of detect.current(location, neptun)) {
      const track = matchTrack(preset, event);
      const note = describe(event, location, track);
      if (note) announce.current(note, preset && track?.file ? audioUrl(preset.id, track.file) : null);
    }
  }, [loaded, neptun, location, preset]);

  return (
    <Box sx={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr", bgcolor: "background.default" }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar variant="dense" sx={{ gap: 1.5, position: "relative" }}>
          <FullscreenClock />
          <PanelToggle open={left} onClick={toggleLeft} title={t.toggleLeft} mirror />
          <CampaignIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t.appName}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: -0.75, mt: 0.5 }}>
            {APP_VERSION}
          </Typography>
          <Chip
            size="small"
            color={neptun.connected ? "success" : "warning"}
            variant="outlined"
            label={neptun.connected ? t.online : t.offline}
          />
          <Box sx={{ flex: 1 }} />
          {location && <Chip size="small" icon={<PlaceIcon />} label={location.name} />}
          {presets.length > 0 && (
            <Select
              size="small"
              value={preset?.id ?? ""}
              onChange={(e) => saveSettings({ activePresetId: e.target.value })}
              sx={{ minWidth: 180 }}
            >
              {presets.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          )}
          <MuteButton muteUntil={settings.muteUntil} />
          <PanelToggle open={right} onClick={toggleRight} title={t.toggleRight} />
          <Tooltip title={t.settings}>
            <IconButton onClick={() => setSettingsOpen({})}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `${left ? `${widths.left}px ` : ""}minmax(0, 1fr)${right ? ` ${widths.right}px` : ""}`,
          minHeight: 0,
        }}
      >
        {left && <Resizer side="left" at={widths.left} onWidth={setWidth("left")} />}
        {right && <Resizer side="right" at={widths.right} onWidth={setWidth("right")} />}
        {left && (
          <AlertsPanel
            location={location}
            onFocus={(lat, lon, id) => setFocus({ lat, lon, id, at: Date.now() })}
            region={region}
            onRegion={setRegion}
          />
        )}
        <MapView dark={dark} location={location} focus={focus} region={region} onRegion={setRegion} />
        {right && <FeedPanel channels={settings.channelsFiltered ? settings.channels : null} />}
      </Box>

      {loaded && <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(null)} dark={dark} />}
    </Box>
  );
}
