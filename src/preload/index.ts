import { contextBridge, ipcRenderer } from "electron";
import type { Api } from "../shared/types";

const api: Api = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  listPresets: () => ipcRenderer.invoke("presets:list"),
  savePreset: (preset) => ipcRenderer.invoke("presets:save", preset),
  deletePreset: (id) => ipcRenderer.invoke("presets:delete", id),
  saveAudio: (presetId, trackId, ext, bytes) => ipcRenderer.invoke("audio:save", presetId, trackId, ext, bytes),
  exportPreset: (id) => ipcRenderer.invoke("presets:export", id),
  importPreset: () => ipcRenderer.invoke("presets:import"),
  getGeo: (name) => ipcRenderer.invoke("neptun:geo", name),
  showWindow: () => ipcRenderer.send("window:show"),
};

contextBridge.exposeInMainWorld("api", api);
