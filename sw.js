const CACHE_NAME = "aligned-v32";
const NAVIGATION_TIMEOUT_MS = 3000;
const APP_FILES = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./og-image.jpg", "./apple-touch-icon.png", "./icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  // Revalidate past the HTTP cache (Pages sends max-age=600), or a release can precache the page it replaces.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: "no-cache" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Cache Storage is shared by every app on this origin, so only this app's own old versions are removed.
    caches.keys().then((keys) => Promise.all(keys.filter((key) => /^(aligned|we-align)-v\d+$/.test(key) && key !== CACHE_NAME).map((key) => caches.delete(key))))
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
          // Shared links carry unique tracking queries (fbclid, utm_*); one entry per page keeps the cache from piling up copies.
          let key = request;
          if (request.mode === "navigate") { const url = new URL(request.url); url.search = ""; url.hash = ""; key = url.href; }
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(key, response.clone());
          } catch (error) {
            // Best-effort: a full quota must not throw away the fresh response.
          }
        }
        return response;
      });
  // Keeps the worker alive for the cache refresh after the timer has already served the cached copy.
  event.waitUntil(network.catch(() => {}));
  const fromCache = async () => {
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    if (request.mode === "navigate") return caches.match("./");
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
    // An HTTP error (Pages outage, 404) falls back to the installed copy; manual-mode redirects pass through.
    network.then(async (response) => {
      clearTimeout(timer);
      // A failing cache read must not swallow the response: the timer is already cleared, so nothing else would settle it.
      finish(response.ok || response.type === "opaqueredirect" ? response : ((await fromCache().catch(() => undefined)) || response));
    }).catch(async () => {
      clearTimeout(timer);
      finish((await fromCache()) || Response.error());
    });
  }));
});
