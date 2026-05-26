// ═══════════════════════════════════════════
// Game Night Scorer — Service Worker
// ═══════════════════════════════════════════
//
// Only caches cross-origin vendor assets (fonts, Tailwind CDN) using
// stale-while-revalidate. Same-origin app files rely on HTTP Cache-Control
// headers (max-age=3600). Hard refresh (Cmd+Shift+R) busts everything.

const VERSION = '__VERSION__';
const VENDOR_CACHE = `gns-vendor-${VERSION}`;

const VENDOR_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VENDOR_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (VENDOR_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
  // All other requests (same-origin app files, Firebase APIs) pass through unintercepted.
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VENDOR_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}
