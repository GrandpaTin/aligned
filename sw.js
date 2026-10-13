const CACHE_NAME = "aligned-v37";
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
    if (request.mode === "navigate") {
      return (await caches.match("./", { ignoreSearch: true })) || (await caches.match("index.html", { ignoreSearch: true }));
    }
    return undefined;
  };
  if (request.mode !== "navigate") {
    event.respondWith(network.catch(async () => (await fromCache()) || Response.error()));
    return;
  }
  // Network-first with fast cache fallback, guarded against long network drops
  event.respondWith(new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (!settled && response) {
        settled = true;
        clearTimeout(quickTimer);
        clearTimeout(hardDeadlineTimer);
        resolve(response);
      }
    };

    const offlineFallback = () => new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aligned — Offline</title><style>body{background:#0c0f17;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100dvh;margin:0;padding:24px;box-sizing:border-box;text-align:center}h1{font-size:1.4rem;margin:0 0 10px;color:#fb7185}p{color:#94a3b8;font-size:0.95rem;margin:0 0 20px;line-height:1.5}button{background:#fb7185;color:#fff;border:0;padding:12px 24px;border-radius:12px;font-size:0.95rem;font-weight:600;cursor:pointer}</style></head><body><div><h1>Waiting for connection</h1><p>Aligned couldn’t be loaded because you’re offline and no saved copy is available yet.</p><button onclick="location.reload()">Retry Connection</button></div></body></html>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
    );

    // If a cached copy exists, serve it after NAVIGATION_TIMEOUT_MS (3s) to beat slow networks
    const quickTimer = setTimeout(async () => {
      const cached = await fromCache();
      if (cached) finish(cached);
    }, NAVIGATION_TIMEOUT_MS);

    // Hard ceiling (8s): if network hangs and no cache exists, prevent 60-120s blank screen
    const hardDeadlineTimer = setTimeout(async () => {
      const cached = await fromCache();
      finish(cached || offlineFallback());
    }, 8000);

    network.then(async (response) => {
      clearTimeout(quickTimer);
      clearTimeout(hardDeadlineTimer);
      finish(response.ok || response.type === "opaqueredirect" ? response : ((await fromCache().catch(() => undefined)) || response));
    }).catch(async () => {
      clearTimeout(quickTimer);
      clearTimeout(hardDeadlineTimer);
      finish((await fromCache()) || offlineFallback());
    });
  }));
});
