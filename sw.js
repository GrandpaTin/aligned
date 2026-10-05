const CACHE_NAME = "aligned-v12";
const APP_FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./og-image.jpg", "./apple-touch-icon.png", "./icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;
  // Downloads (APK, offline copy) are fetched on demand and never stored in the offline cache.
  if (new URL(request.url).pathname.includes("/downloads/")) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok && response.type === "basic" && new URL(request.url).origin === self.location.origin) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
