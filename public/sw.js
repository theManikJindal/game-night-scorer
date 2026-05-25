// ═══════════════════════════════════════════
// Game Night Scorer — Service Worker
// ═══════════════════════════════════════════
//
// Two caches, one strategy each:
//   APP_SHELL_CACHE   — same-origin JS/CSS/HTML/manifest. Cache-first, purged on version bump.
//   VENDOR_CACHE      — cross-origin CDN assets (fonts, Tailwind). Stale-while-revalidate.
//
// Firebase RTDB and Google APIs are network-first (real-time data must not go stale).
//
// VERSION is replaced with the short git SHA by CI before deploy (see
// .github/workflows/firebase-hosting-merge.yml). In local dev it stays 'dev',
// so every reload rebuilds the cache without breaking anything.
//
// See docs/CACHING.md for the full strategy and release process.

const VERSION = '__VERSION__';
const APP_SHELL_CACHE = `gns-app-${VERSION}`;
const VENDOR_CACHE = `gns-vendor-${VERSION}`;

// Same-origin assets to precache on install.
// Keep this list in sync with actual files under /public.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/app.css',
  // Entry + core
  '/js/app.js',
  '/js/router.js',
  '/js/state.js',
  '/js/firebase.js',
  '/js/cache.js',
  '/js/stats.js',
  '/js/utils.js',
  '/js/wordlist.js',
  // Screens
  '/js/screens/home.js',
  '/js/screens/lobby.js',
  '/js/screens/game-select.js',
  '/js/screens/dashboard.js',
  '/js/screens/rules.js',
  '/js/screens/scoring.js',
  '/js/screens/winner.js',
  '/js/screens/recap.js',
  // Games
  '/js/games/registry.js',
  '/js/games/cabo.js',
  '/js/games/flip7.js',
  '/js/games/papayoo.js',
  // Components
  '/js/components/bottom-nav.js',
  '/js/components/host-menu.js',
  '/js/components/player-row.js',
  '/js/components/toast.js',
];

// Runtime-cacheable cross-origin hosts (fonts, Tailwind CDN, Material Symbols).
const VENDOR_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.tailwindcss.com',
];

// Network-first hosts (must go to network for real-time correctness).
const NETWORK_FIRST_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'www.gstatic.com', // Firebase SDK scripts — want latest
  'googleapis.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  // Activate this SW immediately on update, don't wait for tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge any cache that doesn't match the current VERSION.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== VENDOR_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// In local dev the CI substitution never runs, so VERSION stays '__VERSION__'.
// Use network-first for same-origin assets in that case so file changes are
// visible immediately without a hard reload.
const IS_DEV = VERSION === '__VERSION__';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (NETWORK_FIRST_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (VENDOR_HOSTS.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(staleWhileRevalidate(event.request, VENDOR_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      IS_DEV ? networkFirst(event.request) : cacheFirst(event.request, APP_SHELL_CACHE)
    );
    return;
  }

  // Unknown cross-origin — pass through.
  event.respondWith(fetch(event.request));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    // Network failed and nothing cached — let the error propagate.
    throw e;
  }
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached); // If network fails, fall back to whatever's cached.
  return cached || networkPromise;
}
