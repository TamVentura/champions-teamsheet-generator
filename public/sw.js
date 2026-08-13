// Service worker. Two jobs:
//  1. On install, PRECACHE every build asset — app shell, hashed JS/CSS, icons, and the OCR
//     engine (tesseract worker/wasm/lang data). This is what makes the installed PWA work fully
//     offline after its first online launch (iOS Safari has no install-time background fetch, so
//     "offline" means "after the app has been opened once with network").
//  2. On fetch, serve network-first for navigations/HTML (so a new build's entry point and its
//     hashed asset references are picked up) and cache-first for everything else — hashed assets
//     are immutable, and the runtime cache is a safety net for anything a build's precache missed.
//
// CACHE and PRECACHE are injected at build time by scripts/gen-precache.mjs, which knows the real
// (content-hashed) filenames. The tokens below are placeholders in the source file.
const CACHE = '__CACHE_VERSION__';
const PRECACHE = [/*__PRECACHE__*/];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Best-effort per item: one failed request must not discard the whole precache. `reload` skips
  // the HTTP cache so we never store a stale copy of the (non-hashed) entry point.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHtml(req) {
  return req.mode === 'navigate' || req.destination === 'document' || req.headers.get('accept')?.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // `ignoreVary` is essential: Vite serves assets with `Vary: Origin`, and the browser requests
  // module scripts with `crossorigin` (which sends an `Origin` header the precache request lacked),
  // so a plain caches.match would miss offline and the whole module graph would fail to load.
  if (isHtml(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', clone));
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreVary: true }).then((hit) => hit || caches.match('./index.html'))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      });
    })
  );
});
