/* Log Quality Check — offline service worker.
   Cache-first for the app shell. Bump CACHE when you change index.html, and keep
   APP_VERSION in index.html equal to its suffix (the smoke test checks this).

   Why the bump matters: the browser re-installs a service worker only when sw.js
   itself changes byte-for-byte. Changing CACHE is that change. The install then
   re-fetches the whole shell into a fresh cache and the old cache is deleted. */

const CACHE = 'logcheck-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:'reload' bypasses the HTTP cache. GitHub Pages sends max-age=600, so
      // without it a new worker could cache an index.html up to ten minutes stale
      // and keep serving it until the next version bump.
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) {
        // Serve instantly from cache, refresh quietly in the background when online.
        // by URL: a navigation Request can't be re-issued with options
        fetch(e.request.url, { cache: 'no-cache' })
          .then(res => { if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res)); })
          .catch(() => {});
        return hit;
      }
      return fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
