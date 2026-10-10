/* eslint-env serviceworker */
/**
 * Offline shell cache.
 *
 * Deliberately minimal. The service worker caches the APP SHELL ONLY:
 *
 *   • /api/** is NEVER cached. Member balances, loan records and fines are
 *     personal and branch-scoped data; a stale cache entry would show a member
 *     someone else's state on a shared device, or resurrect a loan that has
 *     since been returned. Money and circulation state are fetched live or not
 *     at all.
 *
 *   • Only same-origin GET requests to hashed build assets are cached, so a new
 *     deploy replaces them automatically rather than pinning an old bundle.
 */

const CACHE_VERSION = 'lms-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      // A failed shell cache must not block activation forever.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API, health and readiness responses are always live.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/ready') return;

  // Navigation: network-first so a deploy is picked up immediately, falling back
  // to the cached shell only when genuinely offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed assets: cache-first. `/assets/` only contains content-hashed files.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});