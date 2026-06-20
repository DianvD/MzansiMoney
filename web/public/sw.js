// MzansiMoney service worker.
// Navigations are NETWORK-FIRST so a new deploy shows up immediately (the old SW
// bug served a stale index.html that pointed at old bundles). Hashed static
// assets are immutable, so they're cache-first. Cross-origin requests (Firestore,
// Functions, Auth) are never touched.
const CACHE = "mzansimoney-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // HTML / navigations: always try the network first so the latest deploy loads;
  // fall back to a cached shell only when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/index.html")) || (await caches.match(req))),
    );
    return;
  }

  // Hashed assets: cache-first (content can't change for a given filename).
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
});
