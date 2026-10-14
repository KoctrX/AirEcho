import { useEffect, useRef, useState } from "react";
import { Alert, Autocomplete, Button, Chip, IconButton, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import MicIcon from "@mui/icons-material/Mic";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { AUDIO_EXTENSIONS, type Preset, type Track, type Trigger } from "../shared/types";
import { useNeptun } from "./neptun";
import { newId, savePreset } from "./store";
import { audioUrl } from "./sounds";
import Recorder, { clock } from "./Recorder";
import { t, THREATS } from "./texts";

/** A stored sound's length: "0,9 с" for the short signals, "1:05" past a minute. */
const length = (ms: number): string => (ms < 60_000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} с` : clock(ms));

/**
 * How long a stored sound is. Decoded rather than read from <audio>: a browser recording (webm)
 * carries no duration in its header, and <audio> reports Infinity for it.
 */
function useDuration(presetId: string, file: string, version: number): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    setMs(null);
    if (!file) return;
    let alive = true;
    fetch(audioUrl(presetId, file))
      .then((res) => res.arrayBuffer())
      .then((bytes) => new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes))
      .then((buffer) => alive && setMs(buffer.duration * 1000))
      .catch(() => alive && setMs(-1));
    return () => {
      alive = false;
    };
  }, [presetId, file, version]);
  return ms;
}

/** One preview at a time: starting a track stops the previous one; clicking it again pauses. */
function usePreview(presetId: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState<{ id: string; paused: boolean } | null>(null);
  const [error, setError] = useState("");

  const stop = () => {
    audio.current?.pause();
    audio.current = null;
    setNow(null);
  };
  useEffect(() => stop, []);

  const toggle = (track: Track) => {
    setError("");
    const a = audio.current;
    if (a && now?.id === track.id) {
      if (a.paused) a.play().then(() => setNow({ id: track.id, paused: false }), fail);
      else {
        a.pause();
        setNow({ id: track.id, paused: true });
      }
      return;
    }
    stop();
    const next = new Audio(audioUrl(presetId, track.file));
    next.onended = () => {
      if (audio.current === next) stop();
    };
    audio.current = next;
    setNow({ id: track.id, paused: false });
    next.play().catch(fail);

    function fail(e: Error) {
      console.error("preview failed", track.file, e, next.error);
      setError(`${t.playFailed}: ${next.error?.message || e.message}`);
      stop();
    }
  };

  return { playing: (id: string) => now?.id === id && !now.paused, toggle, stop, error };
}

export default function PresetEditor({ preset }: { preset: Preset }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const preview = usePreview(preset.id);

  const update = (track: Track) => savePreset({ ...preset, tracks: preset.tracks.map((x) => (x.id === track.id ? track : x)) });
  const remove = (id: string) => savePreset({ ...preset, tracks: preset.tracks.filter((x) => x.id !== id) });
  const add = (trigger: Trigger) => {
    setMenu(null);
    savePreset({ ...preset, tracks: [...preset.tracks, { id: newId(), trigger, file: "" }] });
  };
  const unusedType = Object.keys(THREATS).find(
    (type) => !preset.tracks.some((x) => x.trigger.kind === "threat" && x.trigger.type === type),
  );

  return (
    <Stack sx={{ gap: 1 }}>
      {preview.error && <Alert severity="error">{preview.error}</Alert>}
      {preset.tracks.map((track) => (
        <TrackRow
          key={track.id}
          presetId={preset.id}
          track={track}
          playing={preview.playing(track.id)}
          onPlay={() => preview.toggle(track)}
          onStopPreview={preview.stop}
          onChange={update}
          onDelete={() => remove(track.id)}
        />
      ))}
      <Button startIcon={<AddIcon />} onClick={(e) => setMenu(e.currentTarget)} sx={{ alignSelf: "flex-start" }}>
        {t.addTrack}
      </Button>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => add({ kind: "alertStart" })}>{t.trigAlertStart}</MenuItem>
        <MenuItem onClick={() => add({ kind: "alertEnd" })}>{t.trigAlertEnd}</MenuItem>
        <MenuItem onClick={() => add({ kind: "threat", type: unusedType ?? "unknown" })}>{t.trigThreat}</MenuItem>
        <MenuItem onClick={() => add({ kind: "keyword", channels: [], keywords: [] })}>{t.trigKeyword}</MenuItem>
      </Menu>
    </Stack>
  );
}

function TrackRow({
  presetId,
  track,
  playing,
  onPlay,
  onStopPreview,
  onChange,
  onDelete,
}: {
  presetId: string;
  track: Track;
  playing: boolean;
  onPlay: () => void;
  /** A paused preview holds the old sound: it must be dropped, not resumed, once the sound changes. */
  onStopPreview: () => void;
  onChange: (track: Track) => void;
  onDelete: () => void;
}) {
  const { sources } = useNeptun();
  const [recording, setRecording] = useState(false);
  const [version, setVersion] = useState(0);
  const soundMs = useDuration(presetId, track.file, version);
  const file = useRef<HTMLInputElement>(null);
  const { trigger } = track;

  const store = async (ext: string, bytes: Uint8Array) => {
    const path = await window.api.saveAudio(presetId, track.id, ext, bytes);
    onStopPreview();
    onChange({ ...track, file: path });
    setVersion((v) => v + 1);
  };

  const upload = async (picked?: File) => {
    const ext = picked?.name.split(".").pop()?.toLowerCase() ?? "";
    if (!picked || !AUDIO_EXTENSIONS.includes(ext)) return;
    await store(ext, new Uint8Array(await picked.arrayBuffer()));
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, position: "relative", overflow: "hidden", borderColor: recording ? "error.main" : undefined }}>
      {/* Wraps on a phone: the trigger above, the sound controls (or the recorder) below. */}
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Stack sx={{ flex: "1 1 220px", gap: 1, minWidth: 0 }}>
          {trigger.kind === "alertStart" && <Typography>{t.trigAlertStart}</Typography>}
          {trigger.kind === "alertEnd" && <Typography>{t.trigAlertEnd}</Typography>}
          {trigger.kind === "threat" && (
            <TextField
              select
              size="small"
              label={t.trigThreat}
              value={trigger.type}
              onChange={(e) => onChange({ ...track, trigger: { kind: "threat", type: e.target.value } })}
              sx={{ maxWidth: 280 }}
            >
              {Object.entries(THREATS).map(([type, meta]) => (
                <MenuItem key={type} value={type}>
                  {meta.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {trigger.kind === "keyword" && (
            <>
              <Typography variant="body2" color="text.secondary">
                {t.trigKeyword}
              </Typography>
              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={sources.map((s) => s.handle.toLowerCase())}
                value={trigger.channels}
                onChange={(_e, channels) =>
                  onChange({ ...track, trigger: { ...trigger, channels: channels.map((c) => c.toLowerCase()) } })
                }
                renderInput={(params) => <TextField {...params} label={t.channels} />}
              />
              <Autocomplete
                multiple
                freeSolo
                size="small"
                options={[]}
                value={trigger.keywords}
                onChange={(_e, keywords) =>
                  onChange({ ...track, trigger: { ...trigger, keywords: keywords.map((k) => k.trim()).filter(Boolean) } })
                }
                renderValue={(values, getItemProps) =>
                  values.map((value, index) => <Chip size="small" label={value} {...getItemProps({ index })} key={value} />)
                }
                renderInput={(params) => <TextField {...params} label={t.keywords} helperText={t.keywordsHint} />}
              />
            </>
          )}
        </Stack>

        {recording ? (
          <Recorder
            onApply={async (bytes) => {
              await store("webm", bytes);
              setRecording(false);
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          // The controls move as one group when the row wraps on a phone, instead of one by one.
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flexShrink: 0 }}>
            <Stack sx={{ minWidth: 70, alignItems: "flex-end", mr: 0.5 }}>
              <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }} color={track.file ? "text.primary" : "text.secondary"}>
                {!track.file ? t.noSound : soundMs === null ? "…" : soundMs < 0 ? t.soundReady : length(soundMs)}
              </Typography>
              {track.file && (
                <Typography variant="caption" color="text.secondary">
                  {track.file.split(".").pop()}
                </Typography>
              )}
            </Stack>
            <Tooltip title={playing ? t.pause : t.play}>
              <span>
                <IconButton disabled={!track.file} color={playing ? "primary" : "default"} onClick={onPlay}>
                  {playing ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t.record}>
              <IconButton
                onClick={() => {
                  onStopPreview();
                  setRecording(true);
                }}
              >
                <MicIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t.upload}>
              <IconButton onClick={() => file.current?.click()}>
                <UploadFileIcon />
              </IconButton>
            </Tooltip>
            <input
              ref={file}
              type="file"
              hidden
              accept={AUDIO_EXTENSIONS.map((e) => `.${e}`).join(",")}
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Tooltip title={t.delete}>
              <IconButton onClick={onDelete}>
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
