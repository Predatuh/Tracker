const CACHE_NAME = 'princess-trackers-v3';
const PRECACHE = [
  '/',
  '/static/Logo.png'
];

// Install: precache minimal shell, skip waiting immediately
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: delete ALL old caches so users get fresh code
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for everything important
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and socket.io requests
  if (event.request.method !== 'GET' || url.pathname.startsWith('/socket.io')) return;

  // JS, CSS, API, and HTML: always network-first
  if (url.pathname.startsWith('/api/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Images and other assets: cache-first (safe, they rarely change)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return resp;
      });
    })
  );
});
