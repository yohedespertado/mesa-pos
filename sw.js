const CACHE = 'mesa-pos-v27';
const APP_FILES = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/capitan-logo.jpg', '/capitan-icon-512.jpg', '/capitan-print-logo.jpg', '/qr-bbva.jpeg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    try {
      // Always ask the network first for pages so installed phones receive current HTML/styles.
      const response = await fetch(request, { cache: 'no-store' });
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      // Keep the POS available offline using the last cached copy.
      if (cached) return cached;
      const fallback = await cache.match('/index.html');
      if (fallback && request.mode === 'navigate') return fallback;
      throw error;
    }
  })());
});