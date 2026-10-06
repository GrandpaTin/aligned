const CACHE_NAME = "aligned-v17";
const NAVIGATION_TIMEOUT_MS = 3000;
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

  const network = fetch(request)
      .then(async (response) => {
        if (response.ok && response.type === "basic" && new URL(request.url).origin === self.location.origin) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      });
  const fromCache = async () => {
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("./index.html");
    return undefined;
  };
  if (request.mode !== "navigate") {
    event.respondWith(network.catch(async () => (await fromCache()) || Response.error()));
    return;
  }
  // Network-first, but a slow connection never leaves the installed app on a blank screen.
  event.respondWith(new Promise((resolve) => {
    let settled = false;
    const finish = (response) => { if (!settled && response) { settled = true; resolve(response); } };
    const timer = setTimeout(async () => finish(await fromCache()), NAVIGATION_TIMEOUT_MS);
    network.then((response) => { clearTimeout(timer); finish(response); }).catch(async () => {
      clearTimeout(timer);
      finish((await fromCache()) || Response.error());
    });
  }));
});
