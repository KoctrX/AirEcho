import { useSyncExternalStore } from "react";

/**
 * "Install as an app" for the browser build. The browser hands out its install prompt once, early,
 * as `beforeinstallprompt`; it is caught here at startup and kept until the person asks for it.
 * Safari has no such prompt — there it is "Share → Add to Home Screen".
 */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((fn) => fn());

export function watchInstall(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    changed();
  });
}

/** The install action when the browser offers one, otherwise null. */
export function useInstall(): (() => Promise<void>) | null {
  const can = useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => deferred !== null,
  );
  if (!can) return null;
  return async () => {
    const prompt = deferred;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    deferred = null;
    changed();
  };
}
