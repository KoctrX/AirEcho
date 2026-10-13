import { useEffect, useRef, useState } from "react";
import { alpha, Box, IconButton, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import ReplayIcon from "@mui/icons-material/Replay";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import { t } from "./texts";

export const MAX_RECORD_MS = 30_000;
/** One level sample every this many ms: 20 bars a second. */
const SAMPLE_MS = 50;
const BAR = 3;
const GAP = 2;

/** "0:07" */
export const clock = (ms: number): string => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

/**
 * A theme colour as the canvas needs it: the app runs on CSS variables, and `theme.palette` holds
 * the light scheme's values whatever is on screen — read the live variable instead.
 */
const cssColor = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(`--mui-palette-${name}`).trim() || fallback;

/**
 * Bars of loudness around the middle line. Live: the newest at the right edge, older ones scrolling
 * off to the left. Review: the whole take fitted to the width, the played part in the accent colour,
 * with a thin playhead.
 */
function drawWave(canvas: HTMLCanvasElement, levels: number[], live: boolean, progress: number): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const on = live ? cssColor("error-main", "#f44336") : cssColor("primary-main", "#9fb4ff");
  const off = cssColor("text-secondary", "rgba(255,255,255,.6)");
  const slots = Math.max(1, Math.floor(w / (BAR + GAP)));
  let bars: number[];
  if (live) bars = levels.slice(-slots);
  else {
    // Fit the take into the slots, keeping each slot's loudest moment.
    const n = Math.min(slots, Math.max(levels.length, 1));
    bars = Array.from({ length: n }, (_, i) => {
      const from = Math.floor((i * levels.length) / n);
      const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / n));
      return Math.max(0, ...levels.slice(from, to));
    });
  }
  const step = live ? BAR + GAP : w / bars.length;
  const offset = live ? w - bars.length * step : (step - BAR) / 2;
  bars.forEach((level, i) => {
    const bh = Math.max(3, Math.min(1, level) * (h - 4));
    const played = live || (i + 0.5) / bars.length <= progress;
    g.globalAlpha = live ? 0.35 + 0.65 * (i / Math.max(1, bars.length - 1)) : played ? 1 : 0.35;
    g.fillStyle = played ? on : off;
    g.beginPath();
    g.roundRect(offset + i * step, (h - bh) / 2, BAR, bh, 1.5);
    g.fill();
  });
  g.globalAlpha = 1;
  if (!live && progress > 0 && progress < 1) {
    g.fillStyle = on;
    g.fillRect(Math.round(progress * w) - 1, 2, 2, h - 4);
  }
}

/**
 * Plays the take through Web Audio rather than <audio>: a browser recording (webm) has no duration
 * or seek index, so <audio> cannot jump inside it. A decoded buffer can start anywhere.
 */
class TakePlayer {
  private ctx = new AudioContext();
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private pos = 0;
  constructor(private buffer: AudioBuffer, private onEnd: () => void) {}
  get duration(): number {
    return this.buffer.duration;
  }
  get playing(): boolean {
    return this.source !== null;
  }
  get position(): number {
    return this.source ? Math.min(this.duration, this.ctx.currentTime - this.startedAt) : this.pos;
  }
  play(from = this.pos >= this.duration ? 0 : this.pos): void {
    this.halt();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.pos = 0;
      this.onEnd();
    };
    source.start(0, from);
    this.startedAt = this.ctx.currentTime - from;
    this.source = source;
  }
  pause(): void {
    this.pos = this.position;
    this.halt();
  }
  seek(seconds: number): void {
    const at = Math.max(0, Math.min(this.duration, seconds));
    if (this.source) this.play(at);
    else this.pos = at;
  }
  close(): void {
    this.halt();
    this.ctx.close();
  }
  private halt(): void {
    const source = this.source;
    this.source = null;
    source?.stop();
  }
}

/**
 * Records from the microphone with a live waveform, then holds the take for review: listen (and
 * seek by clicking the wave), apply, record again or cancel. Nothing is saved until "apply".
 */
export default function Recorder({ onApply, onCancel }: { onApply: (bytes: Uint8Array) => Promise<void>; onCancel: () => void }) {
  const theme = useTheme();
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef<number[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const [round, setRound] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; player: TakePlayer } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Recording: a fresh take each round.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | undefined;
    let ctx: AudioContext | undefined;
    levels.current = [];
    setElapsed(0);
    setTake(null);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        setError(`${t.micFailed}: ${(e as Error).message}`);
        return;
      }
      if (cancelled) return stream.getTracks().forEach((x) => x.stop());

      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);

      const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const started = performance.now();
      rec.onstop = async () => {
        cancelAnimationFrame(raf);
        stream?.getTracks().forEach((x) => x.stop());
        if (ctx && ctx.state !== "closed") ctx.close();
        if (cancelled) return;
        const blob = new Blob(chunks, { type: "audio/webm" });
        try {
          const buffer = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await blob.arrayBuffer());
          if (cancelled) return;
          setTake({ blob, player: new TakePlayer(buffer, () => setPlaying(false)) });
        } catch (e) {
          setError(`${t.playFailed}: ${(e as Error).message}`);
        }
      };
      rec.start();
      recorder.current = rec;

      let lastSample = 0;
      let lastClock = 0;
      const frame = (now: number) => {
        const ms = now - started;
        if (now - lastSample >= SAMPLE_MS) {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += ((v - 128) / 128) ** 2;
          // RMS, lifted so a normal voice fills the height rather than a quarter of it.
          levels.current.push(Math.min(1, Math.sqrt(sum / samples.length) * 3.2));
          lastSample = now;
        }
        if (now - lastClock >= 100) {
          setElapsed(ms);
          lastClock = now;
        }
        if (canvas.current) drawWave(canvas.current, levels.current, true, 1);
        if (ms >= MAX_RECORD_MS) rec.stop();
        else raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream?.getTracks().forEach((x) => x.stop());
      if (ctx && ctx.state !== "closed") ctx.close();
    };
  }, [round]);

  // Review: repaint as it plays; release the audio when the take is dropped.
  useEffect(() => {
    if (!take) return;
    let raf = 0;
    const paint = () => {
      if (canvas.current) drawWave(canvas.current, levels.current, false, take.player.position / take.player.duration);
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(raf);
      take.player.close();
    };
  }, [take]);

  const togglePlay = () => {
    if (!take) return;
    if (take.player.playing) take.player.pause();
    else take.player.play();
    setPlaying(take.player.playing);
  };

  /** Click or drag along the wave to jump there. */
  const seek = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!take) return;
    const box = e.currentTarget.getBoundingClientRect();
    const to = (x: number) => take.player.seek(((x - box.left) / box.width) * take.player.duration);
    to(e.clientX);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => to(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const again = () => {
    setPlaying(false);
    setRound((n) => n + 1);
  };

  const apply = async () => {
    if (!take) return;
    take.player.pause();
    setSaving(true);
    await onApply(new Uint8Array(await take.blob.arrayBuffer()));
  };

  if (error) {
    return (
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, width: 380 }}>
        <Typography variant="caption" color="error" sx={{ flex: 1 }}>
          {error}
        </Typography>
        <Tooltip title={t.cancel}>
          <IconButton onClick={onCancel}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    );
  }

  const live = !take;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, width: 400 }}>
      <Stack
        direction="row"
        sx={{
          flex: 1,
          minWidth: 0,
          alignItems: "center",
          gap: 1,
          pl: live ? 1.25 : 0.25,
          pr: 1.25,
          height: 44,
          borderRadius: 999,
          bgcolor: live ? alpha(theme.palette.error.main, 0.1) : "action.hover",
          border: 1,
          borderColor: live ? alpha(theme.palette.error.main, 0.35) : "divider",
        }}
      >
        {live ? (
          <Box
            sx={{
              width: 10,
              height: 10,
              flexShrink: 0,
              borderRadius: "50%",
              bgcolor: "error.main",
              animation: "rec-pulse 1s ease-in-out infinite",
              "@keyframes rec-pulse": { "50%": { opacity: 0.25 } },
            }}
          />
        ) : (
          <Tooltip title={playing ? t.pause : t.play}>
            <IconButton size="small" color="primary" onClick={togglePlay} sx={{ bgcolor: alpha(theme.palette.primary.main, 0.15) }}>
              {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <Box
          component="canvas"
          ref={canvas}
          onPointerDown={live ? undefined : seek}
          title={live ? undefined : t.seekHint}
          sx={{ flex: 1, minWidth: 0, height: 28, display: "block", cursor: live ? "default" : "pointer" }}
        />
        <Typography
          variant="caption"
          color={live ? "error" : "text.secondary"}
          sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          {live ? `${clock(elapsed)} / ${clock(MAX_RECORD_MS)}` : clock(take.player.duration * 1000)}
        </Typography>
      </Stack>
      {live ? (
        <>
          <Tooltip title={t.stop}>
            <IconButton color="error" onClick={() => recorder.current?.stop()}>
              <StopIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.cancel}>
            <IconButton onClick={onCancel}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </>
      ) : (
        <>
          <Tooltip title={t.rerecord}>
            <IconButton onClick={again} disabled={saving}>
              <ReplayIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.cancel}>
            <IconButton onClick={onCancel} disabled={saving}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.apply}>
            <IconButton color="success" onClick={apply} disabled={saving} sx={{ bgcolor: alpha(theme.palette.success.main, 0.15) }}>
              <CheckIcon />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  );
}
