/* Minimal service worker — cache shell for offline open (API still needs network) */
const CACHE = "withyou-pwa-v1";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API JSON
  if (
    url.pathname.includes("/me") ||
    url.pathname.includes("/pair") ||
    url.pathname.includes("/heartbeat") ||
    url.pathname.includes("/health") ||
    url.pathname.includes("/partner") ||
    url.pathname.includes("/history")
  ) {
    return;
  }
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
