import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type Api, type Preset, type Settings } from "../shared/types";

declare global {
  interface Window {
    api: Api;
  }
}

interface AppState {
  loaded: boolean;
  settings: Settings;
  presets: Preset[];
}

let state: AppState = { loaded: false, settings: DEFAULT_SETTINGS, presets: [] };
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
export const getApp = (): AppState => state;
export const useApp = (): AppState => useSyncExternalStore(subscribe, getApp);

export async function loadApp(): Promise<void> {
  const [settings, presets] = await Promise.all([window.api.getSettings(), window.api.listPresets()]);
  set({ loaded: true, settings, presets });
}

export function saveSettings(patch: Partial<Settings>): void {
  const settings = { ...state.settings, ...patch };
  set({ settings });
  window.api.setSettings(settings);
}

export async function savePreset(preset: Preset): Promise<void> {
  const exists = state.presets.some((p) => p.id === preset.id);
  set({ presets: exists ? state.presets.map((p) => (p.id === preset.id ? preset : p)) : [...state.presets, preset] });
  await window.api.savePreset(preset);
}

export async function deletePreset(id: string): Promise<void> {
  set({ presets: state.presets.filter((p) => p.id !== id) });
  await window.api.deletePreset(id);
}

export function addPreset(preset: Preset): void {
  set({ presets: [...state.presets, preset] });
}

export const newId = (): string => crypto.randomUUID();
