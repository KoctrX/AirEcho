import { useState } from "react";
import { Button, Checkbox, FormControlLabel, List, ListItem, ListItemText, ListSubheader, Stack, Switch, TextField, Typography } from "@mui/material";
import { useNeptun } from "./neptun";
import { saveSettings, useApp } from "./store";
import { SOURCE_KINDS, t } from "./texts";

/** Which channels the feed shows. Used in settings and in the feed's own filter button. */
export default function ChannelFilter() {
  const { settings } = useApp();
  const { sources } = useNeptun();
  const [query, setQuery] = useState("");
  const filtered = settings.channelsFiltered;
  const chosen = new Set(settings.channels);
  const q = query.trim().toLowerCase();
  const shown = q ? sources.filter((s) => `${s.title} ${s.handle} ${s.region}`.toLowerCase().includes(q)) : sources;
  const kinds = Object.keys(SOURCE_KINDS).concat(
    [...new Set(sources.map((s) => s.kind))].filter((k) => !(k in SOURCE_KINDS)),
  );

  const toggle = (handle: string) => {
    const next = new Set(chosen);
    if (next.has(handle)) next.delete(handle);
    else next.add(handle);
    saveSettings({ channels: [...next] });
  };

  /** Applies to what the search shows, so "select all" after a search picks just those. */
  const setShown = (on: boolean) => {
    const next = new Set(chosen);
    for (const s of shown) {
      if (on) next.add(s.handle.toLowerCase());
      else next.delete(s.handle.toLowerCase());
    }
    saveSettings({ channels: [...next] });
  };

  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={!filtered}
            onChange={(e) =>
              saveSettings(
                e.target.checked
                  ? { channelsFiltered: false }
                  : // First time on: start from everything, so turning the filter on hides nothing yet.
                    { channelsFiltered: true, channels: settings.channels.length ? settings.channels : sources.map((s) => s.handle.toLowerCase()) },
              )
            }
          />
        }
        label={t.allChannels}
      />
      {filtered && (
        <>
          <TextField
            size="small"
            fullWidth
            placeholder={t.searchChannels}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ mt: 1 }}
          />
          <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
            <Button size="small" onClick={() => setShown(true)}>
              {t.selectAll}
            </Button>
            <Button size="small" onClick={() => setShown(false)}>
              {t.selectNone}
            </Button>
          </Stack>
        </>
      )}
      {filtered && sources.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {t.sourcesLoading}
        </Typography>
      )}
      {filtered &&
        kinds.map((kind) => {
          const list = shown.filter((s) => s.kind === kind);
          if (list.length === 0) return null;
          return (
            <List key={kind} dense subheader={<ListSubheader disableSticky>{SOURCE_KINDS[kind] ?? kind}</ListSubheader>}>
              {list.map((s) => {
                const handle = s.handle.toLowerCase();
                return (
                  <ListItem key={handle} disablePadding>
                    <Checkbox checked={chosen.has(handle)} onChange={() => toggle(handle)} />
                    <ListItemText primary={s.title} secondary={`${s.handle} · ${s.region}`} />
                  </ListItem>
                );
              })}
            </List>
          );
        })}
    </>
  );
}
