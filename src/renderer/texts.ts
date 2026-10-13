/** Every user-facing string lives here: the app is Ukrainian-only for now. */

export interface ThreatMeta {
  name: string;
  color: string;
}

/** NEPTUN `type` values seen in the feed. Anything new falls back to `unknown`. */
export const THREATS: Record<string, ThreatMeta> = {
  // The reference project's palette: recon is teal (not an attack), none is blue (that is "me").
  ballistic: { name: "Балістика", color: "#9c36b5" },
  missile: { name: "Крилата ракета", color: "#e03131" },
  kab: { name: "КАБ", color: "#8c5a3c" },
  mig31k: { name: "МіГ-31К", color: "#d6336c" },
  uav: { name: "Ударний БпЛА", color: "#f76707" },
  recon: { name: "Розвідувальний БпЛА", color: "#1098ad" },
  fpv: { name: "FPV-дрон", color: "#2f9e44" },
  unknown: { name: "Невідома ціль", color: "#868e96" },
};

export const threatMeta = (type: string): ThreatMeta => THREATS[type] ?? THREATS.unknown;

export const SOURCE_KINDS: Record<string, string> = {
  official: "Офіційні",
  intelligence: "Розвідка",
  aggregator: "Агрегатори",
  hyperlocal: "Місцеві",
};

declare const __APP_VERSION__: string;
/** From package.json at build time, shown as "v1.0.0". */
export const APP_VERSION = `v${__APP_VERSION__}`;

export const t = {
  appName: "AirEcho",
  focusUkraine: "Показати всю Україну",
  legend: "Позначки",
  legendMarks: "Навколо цілі",
  zoomIn: "Наблизити",
  zoomOut: "Віддалити",
  fullscreen: "На весь екран",
  exitFullscreen: "Вийти з повноекранного режиму",
  toggleLeft: "Панель тривог і цілей",
  toggleRight: "Панель каналів",
  online: "Онлайн",
  soundOn: "Звук увімкнено",
  soundOffUntil: "Звук вимкнено до",
  soundOffForever: "Звук вимкнено",
  unmute: "Увімкнути звук",
  mute15m: "Вимкнути на 15 хв",
  mute1h: "Вимкнути на 1 год",
  mute8h: "Вимкнути на 8 год",
  muteForever: "Вимкнути, доки не ввімкну",
  offline: "Немає з'єднання — повторюю…",
  settings: "Налаштування",
  myLocation: "Моя локація",
  noLocation: "Локацію не обрано",
  addLocationHint: "Додайте локацію в налаштуваннях ⚙",
  alert: "Повітряна тривога",
  noAlert: "Тривоги немає",
  alertEnd: "Відбій тривоги",
  since: "з",
  activeAlerts: "Активні тривоги",
  targets: "Цілі",
  noTargets: "Цілей немає",
  inRadius: "У радіусі",
  areaOnly: "лише область",
  advisory: "спостереження",
  feed: "Канали",
  feedEmpty: "Повідомлень поки немає",
  openInTelegram: "Відкрити в Telegram",
  attribution: 'Дані: <a href="https://neptun.in.ua">NEPTUN</a> · не є офіційною системою оповіщення',
  // Settings
  tabLocations: "Локації",
  tabLook: "Вигляд",
  tabChannels: "Канали",
  tabSounds: "Озвучка",
  addLocation: "Додати локацію",
  editLocation: "Локація",
  region: "Область або район",
  locationName: "Назва",
  radius: "Радіус для цілей, км",
  pointHint: "Клікніть на карті, щоб перенести точку",
  save: "Зберегти",
  cancel: "Скасувати",
  delete: "Видалити",
  close: "Закрити",
  theme: "Тема",
  themeSystem: "Системна",
  themeLight: "Світла",
  themeDark: "Темна",
  allChannels: "Показувати всі канали",
  searchChannels: "Пошук каналу",
  selectAll: "Вибрати всі",
  selectNone: "Зняти всі",
  channelFilter: "Фільтр каналів",
  preset: "Пресет",
  newPreset: "Новий пресет",
  presetName: "Назва пресета",
  exportPreset: "Експорт",
  importPreset: "Імпорт",
  importFailed: "Не вдалося імпортувати",
  addTrack: "Додати озвучку",
  trigAlertStart: "Початок тривоги",
  trigAlertEnd: "Відбій",
  trigThreat: "Ціль",
  trigKeyword: "Ключові слова",
  channels: "Канали (порожньо — усі)",
  keywords: "Ключові слова",
  keywordsHint: "Введіть слово й натисніть Enter",
  record: "Записати",
  stop: "Зупинити",
  upload: "Завантажити файл",
  play: "Прослухати",
  pause: "Пауза",
  playFailed: "Не вдалося відтворити",
  noSound: "Немає звуку",
  newTarget: "Нова ціль",
  keywordHit: "Збіг у каналі",
};
