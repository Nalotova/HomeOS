const CACHE_NAME = 'homeos-v2-cache-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  // PWA requirement: fetch handler must exist. 
  // We pass through to network for now to avoid stale assets with Vite hashes.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
