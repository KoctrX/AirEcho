import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, shell, Tray } from "electron";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { AUDIO_EXTENSIONS, DEFAULT_SETTINGS, type Preset, type Settings } from "../shared/types";
import { readPresetZip, writePresetZip } from "./presetZip";

const ID = /^[A-Za-z0-9_-]+$/;
const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
const data = app.getPath("userData");
const presetsDir = join(data, "presets");
const settingsFile = join(data, "settings.json");

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

protocol.registerSchemesAsPrivileged([
  { scheme: "airecho", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", showWindow);
// macOS: clicking the dock icon brings back the window hidden to the tray.
app.on("activate", showWindow);
app.setAppUserModelId("ua.airecho.app");

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function presetDir(id: string): string {
  if (!ID.test(id)) throw new Error("bad preset id");
  return join(presetsDir, id);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function listPresets(): Promise<Preset[]> {
  await mkdir(presetsDir, { recursive: true });
  const ids = await readdir(presetsDir);
  const presets = await Promise.all(
    ids.map(async (id) => {
      const preset = await readJson<Preset | null>(join(presetsDir, id, "manifest.json"), null);
      return preset && { ...preset, id };
    }),
  );
  return presets.filter((p): p is Preset => p !== null);
}

async function savePreset(preset: Preset): Promise<void> {
  const dir = presetDir(preset.id);
  await mkdir(join(dir, "audio"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(preset, null, 2));
}

async function ensureDefaultPreset(): Promise<void> {
  if (existsSync(presetsDir)) return;
  await cp(join(resources, "default-preset"), join(presetsDir, "default"), { recursive: true });
}

function registerIpc(): void {
  ipcMain.handle("settings:get", async () => {
    const saved = await readJson<Partial<Settings>>(settingsFile, {});
    // Before `channelsFiltered` existed, a non-empty list was what meant "filter on".
    return { ...DEFAULT_SETTINGS, channelsFiltered: (saved.channels?.length ?? 0) > 0, ...saved };
  });
  ipcMain.handle("settings:set", async (_e, settings: Settings) => {
    nativeTheme.themeSource = settings.theme;
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));
  });
  ipcMain.handle("presets:list", listPresets);
  ipcMain.handle("presets:save", (_e, preset: Preset) => savePreset(preset));
  ipcMain.handle("presets:delete", (_e, id: string) => rm(presetDir(id), { recursive: true, force: true }));

  ipcMain.handle("audio:save", async (_e, presetId: string, trackId: string, ext: string, bytes: Uint8Array) => {
    if (!ID.test(trackId) || !AUDIO_EXTENSIONS.includes(ext)) throw new Error("bad audio");
    const audioDir = join(presetDir(presetId), "audio");
    await mkdir(audioDir, { recursive: true });
    // A re-recorded track may change format: drop the old file so export does not ship both.
    for (const old of await readdir(audioDir)) if (old.startsWith(`${trackId}.`)) await rm(join(audioDir, old));
    await writeFile(join(audioDir, `${trackId}.${ext}`), bytes);
    return `audio/${trackId}.${ext}`;
  });

  ipcMain.handle("presets:export", async (_e, id: string) => {
    const preset = await readJson<Preset | null>(join(presetDir(id), "manifest.json"), null);
    if (!preset) return false;
    const target = await dialog.showSaveDialog(win!, {
      defaultPath: `${preset.name}.airecho`,
      filters: [{ name: "Пресет AirEcho", extensions: ["airecho"] }],
    });
    if (target.canceled || !target.filePath) return false;
    const audio: Record<string, Uint8Array> = {};
    for (const track of preset.tracks) if (track.file) audio[track.file] = await readFile(join(presetDir(id), track.file));
    await writeFile(target.filePath, writePresetZip(preset, audio));
    return true;
  });

  ipcMain.handle("presets:import", async () => {
    const source = await dialog.showOpenDialog(win!, {
      properties: ["openFile"],
      filters: [{ name: "Пресет AirEcho", extensions: ["airecho", "zip"] }],
    });
    if (source.canceled || !source.filePaths[0]) return null;
    const { preset, audio } = readPresetZip(await readFile(source.filePaths[0]));
    preset.id = randomUUID();
    await savePreset(preset);
    for (const [path, bytes] of Object.entries(audio)) await writeFile(join(presetDir(preset.id), path), bytes);
    return preset;
  });

  // NEPTUN's boundary files carry no CORS header (their API does), so the renderer cannot fetch
  // them itself; the main process is not subject to CORS.
  ipcMain.handle("neptun:geo", async (_e, name: string) => {
    if (name !== "oblasts" && name !== "raions") throw new Error("bad geo name");
    try {
      const res = await net.fetch(`https://neptun.in.ua/${name}.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      // NEPTUN down or slow: the copy shipped with the app (borders change about never).
      return JSON.parse(await readFile(join(resources, "geo", `${name}.geojson`), "utf8"));
    }
  });

  ipcMain.on("window:show", showWindow);
}

/** `airecho://preset/<id>/audio/<file>` → the file in userData, never anything outside it. */
function registerAudioProtocol(): void {
  protocol.handle("airecho", async (request) => {
    const url = new URL(request.url);
    const file = resolve(presetsDir, decodeURIComponent(url.pathname.slice(1)));
    if (url.host !== "preset" || !file.startsWith(presetsDir + sep)) return new Response(null, { status: 404 });
    // Readable by the page's fetch (the settings decode a sound to show its length), not only by <audio>.
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, { status: res.status, headers });
  });
}

/** Links (map attribution, Telegram channels) open outside the app, and only safe schemes. */
function openOutside(url: string): void {
  if (/^(https:|tg:)/.test(url)) shell.openExternal(url).catch(() => {
    const handle = /^tg:\/\/resolve\?domain=([\w]+)/.exec(url)?.[1];
    if (handle) shell.openExternal(`https://t.me/${handle}`);
  });
}

function createWindow(): void {
  const icon = nativeImage.createFromPath(join(resources, "icon.png"));
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    icon,
    autoHideMenuBar: true,
    title: "AirEcho",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Sound and the live socket must keep working while the window sits in the tray.
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "file:")) return;
    event.preventDefault();
    openOutside(url);
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));

  tray = new Tray(icon.resize({ width: 22, height: 22 }));
  tray.setToolTip("AirEcho");
  tray.on("click", showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Показати", click: showWindow },
      { type: "separator" },
      { label: "Вийти", click: () => ((quitting = true), app.quit()) },
    ]),
  );
}

app.on("before-quit", () => (quitting = true));

app.whenReady().then(async () => {
  // No menu bar on Linux/Windows. macOS keeps the standard one: without its Edit menu, Cmd+C/V do
  // not work in text fields, and without the app menu there is no Cmd+Q.
  Menu.setApplicationMenu(
    process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null,
  );
  await ensureDefaultPreset();
  nativeTheme.themeSource = (await readJson<Partial<Settings>>(settingsFile, {})).theme ?? "system";
  registerIpc();
  registerAudioProtocol();
  createWindow();
});
