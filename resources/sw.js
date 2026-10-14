/**
 * AirEcho's service worker (browser build only). It makes the site installable and lets it open
 * without a network: the app's own files are fetched fresh when online and served from cache when
 * not. NEPTUN's data and the map tiles are never cached here — stale alerts are worse than none.
 */
const CACHE = "airecho-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["./", "./manifest.webmanifest", "./icon-192.png"])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only our own files: NEPTUN, CARTO and Telegram go straight to the network.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match("./"))),
  );
});
