import { useMemo, useState } from "react";
import { Badge, Box, Card, CardContent, IconButton, Link, Popover, Stack, Tooltip, Typography } from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import ChannelFilter from "./ChannelFilter";
import { useNeptun } from "./neptun";
import { formatTime } from "./AlertsPanel";
import { t } from "./texts";

export const openChannel = (handle: string): void => {
  // The main process routes window.open outside the app (tg:, falling back to t.me).
  window.open(`tg://resolve?domain=${encodeURIComponent(handle.replace(/^@/, ""))}`);
};

/** `channels` null shows every channel. */
export default function FeedPanel({ channels }: { channels: string[] | null }) {
  const { messages, sources, feedDown } = useNeptun();
  const [filterAt, setFilterAt] = useState<HTMLElement | null>(null);
  const titles = useMemo(() => new Map(sources.map((s) => [s.handle.toLowerCase(), s.title])), [sources]);
  const shown = useMemo(() => {
    if (!channels) return messages;
    const allowed = new Set(channels);
    return messages.filter((m) => allowed.has(m.channel.toLowerCase()));
  }, [messages, channels]);

  return (
    <Box sx={{ overflow: "auto", borderLeft: 1, borderColor: "divider", p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", px: 0.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
          {`${t.feed} · ${shown.length}`}
        </Typography>
        <Tooltip title={t.channelFilter}>
          <IconButton size="small" onClick={(e) => setFilterAt(e.currentTarget)}>
            <Badge color="primary" variant="dot" invisible={!channels}>
              <FilterListIcon fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>
      </Stack>
      <Popover
        open={filterAt !== null}
        anchorEl={filterAt}
        onClose={() => setFilterAt(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 380, maxHeight: "70vh", p: 2 } } }}
      >
        <ChannelFilter />
      </Popover>
      {feedDown && (
        <Typography variant="body2" color="warning.main" sx={{ px: 0.5, mb: 1 }}>
          {t.feedDown}
        </Typography>
      )}
      {shown.length === 0 && !feedDown && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
          {t.feedEmpty}
        </Typography>
      )}
      {shown.map((m) => (
        <Card key={`${m.channel}|${m.date}|${m.text}`} variant="outlined" sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
            <Stack direction="row" sx={{ alignItems: "baseline", gap: 1, mb: 0.5 }}>
              <Tooltip title={t.openInTelegram}>
                <Link component="button" variant="subtitle2" underline="hover" onClick={() => openChannel(m.channel)} noWrap sx={{ minWidth: 0 }}>
                  {titles.get(m.channel.toLowerCase()) ?? m.channel}
                </Link>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {formatTime(m.date)}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {m.text}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
