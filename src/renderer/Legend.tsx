import { useEffect, useState } from "react";
import { on } from "./shortcuts";
import { Box, ButtonBase, Collapse, Divider, Paper, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LegendToggleIcon from "@mui/icons-material/LegendToggle";
import { LEGEND, markerSvg } from "./silhouettes";
import { t, threatMeta } from "./texts";

const KEY = "legend:open";
const SAMPLE = "#f76707";

/** Small drawings of what surrounds a target on the map, in the map's own styles. */
const MARKS: { svg: string; name: string }[] = [
  { svg: `<path d="M2 18 C8 14 12 16 22 6" stroke="${SAMPLE}" stroke-opacity=".6" stroke-width="1.5" fill="none"/>`, name: "Пройдений шлях" },
  { svg: `<path d="M3 12 H21" stroke="${SAMPLE}" stroke-opacity=".65" stroke-width="1.5" stroke-dasharray="1.5 2.5" fill="none"/>`, name: "Курс (20 км уперед)" },
  { svg: `<path d="M3 12 H21" stroke="${SAMPLE}" stroke-opacity=".3" stroke-width="1.5" stroke-dasharray="1.5 2.5" fill="none"/>`, name: "Курс-припущення" },
  {
    svg: `<circle cx="12" cy="12" r="9" stroke="${SAMPLE}" stroke-opacity=".5" stroke-dasharray="3 3" fill="${SAMPLE}" fill-opacity=".06"/>`,
    name: "Похибка позиції",
  },
  {
    svg: `<circle cx="12" cy="12" r="10" stroke="${SAMPLE}" stroke-width="1.5" stroke-dasharray="3 2" fill="none"/><circle cx="12" cy="12" r="3.5" fill="${SAMPLE}" stroke="#fff"/>`,
    name: "Точка — куди летить, не де є",
  },
  {
    svg: `<circle cx="12" cy="12" r="10" fill="#15181e" fill-opacity=".85" stroke="${SAMPLE}" stroke-width="1.4"/><path d="M12 6 L15.5 16 L12 14 L8.5 16 Z" fill="${SAMPLE}" stroke="#fff" stroke-width=".8"/>`,
    name: "У колі — курс невідомий",
  },
  { svg: `<g opacity=".55"><circle cx="12" cy="12" r="6" fill="${SAMPLE}" stroke="#fff" stroke-width="1.3"/></g>`, name: "Блідо — не підтверджено / приблизно" },
];

function Icon({ html }: { html: string }) {
  // Our own SVG constants only, no feed text: safe as markup.
  return <Box component="span" sx={{ width: 24, height: 24, flexShrink: 0, display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Legend() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(KEY, was ? "0" : "1");
      } catch {}
      return !was;
    });
  useEffect(() => on("legend", toggle), []);

  return (
    <Paper
      elevation={0}
      sx={{
        position: "absolute",
        left: 12,
        top: 12,
        zIndex: 2,
        borderRadius: 3,
        width: open ? 280 : "auto",
        overflow: "hidden",
        // Same glass as the map's attribution: the map stays visible behind it.
        bgcolor: "color-mix(in srgb, var(--mui-palette-background-paper) 82%, transparent)",
        backdropFilter: "blur(8px)",
        border: 1,
        borderColor: "divider",
        boxShadow: "0 4px 16px rgba(0,0,0,.3)",
      }}
    >
      <ButtonBase
        onClick={toggle}
        aria-expanded={open}
        sx={{
          width: "100%",
          gap: 1,
          px: 1.5,
          py: 1,
          justifyContent: "flex-start",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <LegendToggleIcon fontSize="small" color="primary" />
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, textAlign: "left" }}>
          {t.legend}
        </Typography>
        <ExpandMoreIcon
          fontSize="small"
          sx={{ color: "text.secondary", transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }}
        />
      </ButtonBase>
      <Collapse in={open} unmountOnExit>
        <Divider />
        <Box sx={{ maxHeight: "calc(100vh - 190px)", overflowY: "auto", px: 1.5, pt: 1, pb: 1.5 }}>
          <Stack sx={{ gap: 0.5 }}>
            {LEGEND.map(({ visual, name, type }) => (
              <Stack key={visual} direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Icon html={markerSvg(visual, visual === "recon" ? threatMeta("recon").color : threatMeta(type).color, null, 24)} />
                <Typography variant="body2">{name}</Typography>
              </Stack>
            ))}
          </Stack>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {t.legendMarks}
          </Typography>
          <Stack sx={{ gap: 0.5 }}>
            {MARKS.map(({ svg, name }) => (
              <Stack key={name} direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Icon html={`<svg width="24" height="24" viewBox="0 0 24 24">${svg}</svg>`} />
                <Typography variant="body2">{name}</Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}
