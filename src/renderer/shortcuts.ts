/**
 * Keyboard shortcuts: the list the settings show, and a tiny event bus for the actions that live in
 * components other than the one handling the key (the map, the legend, the panel tabs).
 *
 * Keys are matched by `event.code` (the physical key), so they work in the Ukrainian layout too.
 */

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Shift", "ЛКМ"], label: "Фокус на області під курсором" },
  { keys: ["Ctrl", "ЛКМ"], label: "Фокус на районі під курсором" },
  { keys: ["Esc"], label: "Зняти виділення області чи району" },
  { keys: ["F"], label: "Показати всю Україну" },
  { keys: ["F11"], label: "На весь екран / вийти" },
  { keys: ["["], label: "Сховати / показати панель тривог і цілей" },
  { keys: ["]"], label: "Сховати / показати панель каналів" },
  { keys: ["1"], label: "Вкладка «Цілі»" },
  { keys: ["2"], label: "Вкладка «Тривоги»" },
  { keys: ["L"], label: "Розгорнути / згорнути позначки" },
  { keys: ["M"], label: "Вимкнути / увімкнути звук" },
  { keys: ["Ctrl", ","], label: "Налаштування" },
  { keys: ["?"], label: "Ця довідка" },
];

export type AppEvent = "fit" | "legend" | "tab:targets" | "tab:alerts";

export const emit = (name: AppEvent): void => void window.dispatchEvent(new Event(`airecho:${name}`));

export function on(name: AppEvent, fn: () => void): () => void {
  window.addEventListener(`airecho:${name}`, fn);
  return () => window.removeEventListener(`airecho:${name}`, fn);
}

/** Typing in a field is typing, not a shortcut. */
export function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}
