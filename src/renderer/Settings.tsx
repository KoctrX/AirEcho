import { useEffect, useRef, useState } from "react";
import { SHORTCUTS } from "./shortcuts";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  MenuItem,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import type { Location, Preset, ThemeMode } from "../shared/types";
import { MIN_POLL_S, refreshNow, useNeptun, type Place } from "./neptun";
import { addPreset, deletePreset, newId, saveSettings, savePreset, useApp } from "./store";
import { cartoStyle, drawLocation, onStyle } from "./MapView";
import PresetEditor from "./PresetEditor";
import ChannelFilter from "./ChannelFilter";
import { APP_VERSION, t } from "./texts";

export default function SettingsDialog({ open, onClose, dark }: { open: { tab?: number } | null; onClose: () => void; dark: boolean }) {
  const [tab, setTab] = useState(0);
  // On a phone the settings take the whole screen: a dialog over a 360 px map helps nobody.
  const phone = useMediaQuery(useTheme().breakpoints.down("sm"));
  // Opened for a given tab (the "?" shortcut opens the keys); otherwise where it was left.
  useEffect(() => {
    if (open?.tab !== undefined) setTab(open.tab);
  }, [open]);
  return (
    <Dialog
      open={open !== null}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      fullScreen={phone}
      slotProps={{ paper: { sx: phone ? { pt: "env(safe-area-inset-top)", pb: "env(safe-area-inset-bottom)" } : { height: "85vh" } } }}
    >
      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: "divider", px: phone ? 0 : 2 }}
      >
        <Tab label={t.tabLocations} />
        <Tab label={t.tabGeneral} />
        <Tab label={t.tabChannels} />
        <Tab label={t.tabSounds} />
        <Tab label={t.tabKeys} />
      </Tabs>
      <DialogContent>
        {tab === 0 && <LocationsTab dark={dark} />}
        {tab === 1 && <LookTab />}
        {tab === 2 && <ChannelFilter />}
        {tab === 3 && <SoundsTab />}
        {tab === 4 && <KeysTab />}
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 2 }}>
          {`${t.appName} ${APP_VERSION}`}
        </Typography>
        <Button onClick={onClose}>{t.close}</Button>
      </DialogActions>
    </Dialog>
  );
}

function LocationsTab({ dark }: { dark: boolean }) {
  const { settings } = useApp();
  const [editing, setEditing] = useState<Location | null>(null);

  if (editing) {
    return (
      <LocationForm
        dark={dark}
        initial={editing}
        onCancel={() => setEditing(null)}
        onSave={(loc) => {
          const exists = settings.locations.some((l) => l.id === loc.id);
          saveSettings({
            locations: exists ? settings.locations.map((l) => (l.id === loc.id ? loc : l)) : [...settings.locations, loc],
            activeLocationId: settings.activeLocationId || loc.id,
          });
          setEditing(null);
        }}
      />
    );
  }

  return (
    <>
      <RadioGroup value={settings.activeLocationId} onChange={(e) => saveSettings({ activeLocationId: e.target.value })}>
        <List>
          {settings.locations.map((loc) => (
            <ListItem
              key={loc.id}
              secondaryAction={
                <>
                  <IconButton onClick={() => setEditing(loc)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    onClick={() => {
                      const locations = settings.locations.filter((l) => l.id !== loc.id);
                      const activeLocationId =
                        settings.activeLocationId === loc.id ? (locations[0]?.id ?? "") : settings.activeLocationId;
                      saveSettings({ locations, activeLocationId });
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </>
              }
            >
              <Radio value={loc.id} />
              <ListItemText primary={loc.name} secondary={`${loc.oblastName} · ${loc.radiusKm} км`} />
            </ListItem>
          ))}
        </List>
      </RadioGroup>
      {settings.locations.length === 0 && <Typography color="text.secondary">{t.noLocation}</Typography>}
      <Button
        startIcon={<AddIcon />}
        variant="contained"
        sx={{ mt: 2 }}
        onClick={() =>
          setEditing({ id: newId(), name: "", raionKey: "", oblastKey: "", oblastName: "", lat: 0, lon: 0, radiusKm: 100 })
        }
      >
        {t.addLocation}
      </Button>
    </>
  );
}

function LocationForm({
  dark,
  initial,
  onCancel,
  onSave,
}: {
  dark: boolean;
  initial: Location;
  onCancel: () => void;
  onSave: (loc: Location) => void;
}) {
  const { catalog } = useNeptun();
  const [loc, setLoc] = useState(initial);
  const places = catalog?.places ?? [];
  const selected = places.find((p) => p.key === (loc.raionKey || loc.oblastKey) && p.raion === (loc.raionKey !== "")) ?? null;
  const label = (p: Place) => (p.raion ? `${p.name} (${p.oblastName})` : p.name);

  return (
    <Stack sx={{ gap: 2, pt: 1 }}>
      <Autocomplete
        options={places}
        value={selected}
        getOptionLabel={label}
        isOptionEqualToValue={(a, b) => a.key === b.key && a.raion === b.raion}
        onChange={(_e, p) =>
          p &&
          setLoc({
            ...loc,
            name: loc.name && loc.name !== (selected && label(selected)) ? loc.name : label(p),
            raionKey: p.raion ? p.key : "",
            oblastKey: p.oblastKey,
            oblastName: p.oblastName,
            lat: p.lat,
            lon: p.lon,
          })
        }
        renderInput={(params) => <TextField {...params} label={t.region} />}
      />
      <TextField label={t.locationName} value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} />
      <Box>
        <Typography variant="body2">{`${t.radius}: ${loc.radiusKm}`}</Typography>
        <Slider
          min={10}
          max={300}
          step={10}
          value={loc.radiusKm}
          onChange={(_e, v) => setLoc({ ...loc, radiusKm: v as number })}
        />
      </Box>
      {selected && (
        <>
          <Typography variant="body2" color="text.secondary">
            {t.pointHint}
          </Typography>
          <PointPicker dark={dark} loc={loc} onChange={(lat, lon) => setLoc((l) => ({ ...l, lat, lon }))} />
        </>
      )}
      <Stack direction="row" sx={{ gap: 1, justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>{t.cancel}</Button>
        <Button variant="contained" disabled={!selected || !loc.name.trim()} onClick={() => onSave({ ...loc, name: loc.name.trim() })}>
          {t.save}
        </Button>
      </Stack>
    </Stack>
  );
}

function PointPicker({ dark, loc, onChange }: { dark: boolean; loc: Location; onChange: (lat: number, lon: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const latest = useRef({ loc, onChange });
  latest.current = { loc, onChange };

  const fit = (m: MlMap, l: Location) => {
    const d = l.radiusKm / 80;
    m.fitBounds([[l.lon - d * 1.5, l.lat - d], [l.lon + d * 1.5, l.lat + d]], { animate: false });
  };

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: cartoStyle(dark), attributionControl: false, dragRotate: false });
    fit(m, latest.current.loc);
    onStyle(m, () => drawLocation(m, latest.current.loc));
    m.on("click", (e) => latest.current.onChange(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    return () => m.remove();
  }, [dark]);

  useEffect(() => {
    if (!map.current) return;
    drawLocation(map.current, loc);
  }, [loc.lat, loc.lon, loc.radiusKm]);

  useEffect(() => {
    if (map.current) fit(map.current, loc);
  }, [loc.radiusKm]);

  return <Box ref={el} sx={{ height: 320, borderRadius: 2, overflow: "hidden" }} />;
}

function LookTab() {
  const { settings } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {t.theme}
      </Typography>
      <RadioGroup value={settings.theme} onChange={(e) => saveSettings({ theme: e.target.value as ThemeMode })}>
        <FormControlLabel value="system" control={<Radio />} label={t.themeSystem} />
        <FormControlLabel value="light" control={<Radio />} label={t.themeLight} />
        <FormControlLabel value="dark" control={<Radio />} label={t.themeDark} />
      </RadioGroup>

      <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>
        {t.pollTitle}
      </Typography>
      <Stack direction="row" sx={{ alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={settings.pollSeconds}
          onChange={(_e, v: number | null) => v !== null && saveSettings({ pollSeconds: v })}
        >
          {POLL_CHOICES.map((sec) => (
            <ToggleButton key={sec} value={sec} sx={{ px: 1.75 }}>
              {sec < 60 ? `${sec} с` : `${sec / 60} хв`}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          size="small"
          startIcon={<RefreshIcon />}
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await refreshNow();
            setRefreshing(false);
          }}
        >
          {t.refreshNow}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, maxWidth: 560 }}>
        {t.pollHint}
      </Typography>
    </>
  );
}

const POLL_CHOICES = [MIN_POLL_S, 10, 15, 30, 60];

function SoundsTab() {
  const { settings, presets } = useApp();
  const [error, setError] = useState("");
  const preset = presets.find((p) => p.id === settings.activePresetId) ?? presets[0];

  const create = async () => {
    const fresh: Preset = { format: "airecho-preset", version: 1, id: newId(), name: t.newPreset, tracks: [] };
    await savePreset(fresh);
    saveSettings({ activePresetId: fresh.id });
  };

  const importOne = async () => {
    setError("");
    try {
      const imported = await window.api.importPreset();
      if (!imported) return;
      addPreset(imported);
      saveSettings({ activePresetId: imported.id });
    } catch (e) {
      // Electron prefixes IPC errors with the channel; the message after it is ours.
      setError(`${t.importFailed}: ${String((e as Error).message).replace(/^.*Error: /, "")}`);
    }
  };

  return (
    <Stack sx={{ gap: 2, pt: 1 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label={t.preset}
          value={preset?.id ?? ""}
          onChange={(e) => saveSettings({ activePresetId: e.target.value })}
          sx={{ minWidth: 200 }}
        >
          {presets.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </TextField>
        {preset && (
          <TextField
            size="small"
            label={t.presetName}
            value={preset.name}
            onChange={(e) => savePreset({ ...preset, name: e.target.value })}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <IconButton title={t.newPreset} onClick={create}>
          <AddIcon />
        </IconButton>
        <Button startIcon={<FileUploadIcon />} onClick={importOne}>
          {t.importPreset}
        </Button>
        {preset && (
          <Button startIcon={<FileDownloadIcon />} onClick={() => window.api.exportPreset(preset.id)}>
            {t.exportPreset}
          </Button>
        )}
        {preset && presets.length > 1 && (
          <IconButton
            title={t.delete}
            onClick={async () => {
              await deletePreset(preset.id);
              saveSettings({ activePresetId: presets.find((p) => p.id !== preset.id)?.id ?? "" });
            }}
          >
            <DeleteIcon />
          </IconButton>
        )}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {preset && <PresetEditor key={preset.id} preset={preset} />}
    </Stack>
  );
}

function KeysTab() {
  return (
    <Stack sx={{ pt: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t.keysNote}
      </Typography>
      {SHORTCUTS.map(({ keys, label }) => (
        <Stack key={label} direction="row" sx={{ alignItems: "center", py: 0.9, borderBottom: 1, borderColor: "divider", gap: 2 }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {label}
          </Typography>
          <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
            {keys.map((k, i) => (
              <Stack key={k} direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
                {i > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    +
                  </Typography>
                )}
                <Box
                  component="kbd"
                  sx={{
                    minWidth: 28,
                    px: 1,
                    py: 0.25,
                    textAlign: "center",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 1.5,
                    border: 1,
                    borderColor: "divider",
                    borderBottomWidth: 2,
                    bgcolor: "action.hover",
                  }}
                >
                  {k}
                </Box>
              </Stack>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}
