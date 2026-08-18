// Cache version — BUMP THIS ON EVERY DEPLOY that changes cached assets.
// The activate handler deletes every cache whose name !== CACHE_NAME, so
// bumping the version is what forces stale entries out of existing installs.
const CACHE_NAME = 'naig2027-v2';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// True for the things that carry our application CODE: the page navigation
// itself, and index.html however it is requested ('./' and './index.html' are
// separate cache keys, so both spellings have to be caught here).
function isAppCode(request, url) {
  if (request.mode === 'navigate') return true;
  const path = url.pathname.replace(/\/+$/, '/');
  return path.endsWith('/index.html') || path.endsWith('/') ;
}

// Strategy:
//   - App code (navigations + index.html)  -> NETWORK FIRST, cache as fallback.
//     Previously this was cache-first-with-background-revalidate, which meant a
//     deploy never reached anyone on their current load — they got the old code
//     and only picked up the new version on a LATER visit. For a single-file app
//     where index.html *is* the whole application, that made every deploy
//     silently lag the team by at least one page load. Network-first fixes that
//     while still working offline: if the network fails we serve the cached copy.
//   - Everything else same-origin (icons, manifest) -> cache first, which is
//     correct for assets that rarely change and keeps the PWA fast/offline.
//   - Cross-origin (Firebase live sync, gstatic fonts, CDNs) -> untouched, so
//     real-time data is never served stale.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return; // let the browser handle it normally
  }

  if (isAppCode(event.request, url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          // Offline (or the network failed): fall back to whatever we cached,
          // and if this exact request was never cached, fall back to the shell.
          caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // Static assets: cache first, refresh the cache in the background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
