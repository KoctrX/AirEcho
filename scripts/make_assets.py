"""Generates the default preset's signals (original, public domain / CC0) and the app icon."""
import json, math, struct, sys, wave
from pathlib import Path

out = Path(sys.argv[1])
audio = out / "default-preset" / "audio"
audio.mkdir(parents=True, exist_ok=True)
RATE = 22050

def tone(freq, dur, vol=0.5, sweep_to=None, wobble=0.0):
    n = int(RATE * dur); s = []; phase = 0.0
    for i in range(n):
        x = i / n
        f = freq + (sweep_to - freq) * x if sweep_to else freq
        f += wobble * math.sin(2 * math.pi * 6 * i / RATE)
        phase += 2 * math.pi * f / RATE
        env = min(1, i / (RATE * 0.01), (n - i) / (RATE * 0.03))
        s.append(vol * env * (math.sin(phase) + 0.25 * math.sin(2 * phase)) / 1.25)
    return s

def rest(dur): return [0.0] * int(RATE * dur)

def write(name, parts):
    data = [x for p in parts for x in p]
    with wave.open(str(audio / f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 32000)) for x in data))
    return f"audio/{name}.wav"

sounds = {
    "alert_start": [tone(500, .9, sweep_to=900), tone(900, .9, sweep_to=500), tone(500, .9, sweep_to=900)],
    "alert_end":   [tone(784, .25), rest(.05), tone(659, .25), rest(.05), tone(523, .5)],
    "ballistic":   [p for _ in range(6) for p in (tone(1320, .09, .6), rest(.04))],
    "missile":     [p for _ in range(3) for p in (tone(1046, .18), rest(.08))],
    "kab":         [p for _ in range(3) for p in (tone(330, .25, .6), rest(.1))],
    "mig31k":      [tone(880, .45), rest(.1), tone(660, .45)],
    "uav":         [tone(440, 1.0, .45, wobble=40)],
    "recon":       [tone(660, .12, .35), rest(.08), tone(660, .12, .35)],
    "fpv":         [p for _ in range(4) for p in (tone(990, .05, .4), rest(.05))],
    "unknown":     [tone(600, .3, .4)],
}
tracks = []
for name, parts in sounds.items():
    file = write(name, parts)
    trigger = {"kind": "alertStart"} if name == "alert_start" else {"kind": "alertEnd"} if name == "alert_end" else {"kind": "threat", "type": name}
    tracks.append({"id": name, "trigger": trigger, "file": file})

manifest = {"format": "airecho-preset", "version": 1, "id": "default", "name": "Стандартний", "tracks": tracks}
(out / "default-preset" / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

from PIL import Image, ImageDraw
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=220, fill=(51, 85, 204, 255))
cx, cy = 400, S // 2
for r, w in ((170, 46), (290, 46), (410, 46)):
    d.arc((cx - r, cy - r, cx + r, cy + r), start=-45, end=45, fill=(255, 255, 255, 255), width=w)
d.ellipse((cx - 80, cy - 80, cx + 80, cy + 80), fill=(255, 196, 0, 255))
img.resize((512, 512), Image.LANCZOS).save(out / "icon.png")
