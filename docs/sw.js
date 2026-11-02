const CACHE = 'motion-studio-v2';
// Paths are relative to the worker's scope so the studio also works when it is
// served from a sub-path instead of the domain root.
const SCOPE = new URL('./', self.location.href);
const scoped = (path) => new URL(path, SCOPE).href;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'runtime.js',
  'manifest.webmanifest',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/inter.woff2',
  'fonts/instrument-serif.woff2',
  'fonts/instrument-serif-italic.woff2',
  'fonts/jetbrains-mono.woff2',
  'fonts/vazirmatn-arabic-wght-normal.woff2',
  'fonts/vazirmatn-latin-wght-normal.woff2'
].map(scoped);
const INDEX = scoped('index.html');

function remember(request, response) {
  // Only keep good, same-origin responses; caching a 404 or a server error
  // would keep serving it from the cache later.
  if (!response || !response.ok || response.type !== 'basic') return;
  const copy = response.clone();
  caches
    .open(CACHE)
    .then((cache) => cache.put(request, copy))
    .catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(SCOPE.href)) return;
  const local = url.pathname.slice(SCOPE.pathname.length);
  if (local.startsWith('api/') || local.startsWith('media/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          remember(INDEX, response);
          return response;
        })
        .catch(() => caches.match(INDEX).then((cached) => cached || caches.match(scoped('./'))))
    );
    return;
  }

  const networkFirst = /\.(js|css|html)$/.test(url.pathname) || url.href === SCOPE.href;
  if (networkFirst) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          remember(request, response);
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          remember(request, response);
          return response;
        })
    )
  );
});
