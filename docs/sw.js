/* Makeline Trainer service worker (classic script, works in Safari).
 *
 * - Caches the app shell (versioned, cache-first) so the app opens in airplane mode.
 * - Your builds and progress live in IndexedDB on the device, never in this cache.
 * - A new VERSION makes the app show "Update available, tap to refresh".
 * - Push + notification clicks are handled in sw-push.js.
 */
'use strict';

const VERSION = '1.0.0';
const SHELL_PREFIX = 'makeline-shell-';
const SHELL_CACHE = SHELL_PREFIX + VERSION;

// Every file the app needs offline. tests/unit/repo.test.mjs checks this list is complete.
const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'sw-push.js',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/data.js',
  'js/db.js',
  'js/distractors.js',
  'js/notify.js',
  'js/order.js',
  'js/questions.js',
  'js/srs.js',
  'js/state.js',
  'js/store.js',
  'js/util.js',
  'js/version.js',
  'js/ui/buildview.js',
  'js/ui/dom.js',
  'js/ui/home.js',
  'js/ui/browse.js',
  'js/ui/load.js',
  'js/ui/notifications.js',
  'js/ui/quiz.js',
  'js/ui/settings.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

// Fetched fresh when online (so schedule edits show up), cached copy when offline.
const NETWORK_FIRST = ['notify-schedule.json'];

importScripts('sw-push.js');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // cache: 'reload' skips the browser's HTTP cache so we never store a stale file.
      cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
  if (msg.type === 'TEST_PUSH') {
    // "Send a test notification" in Settings runs the exact push code path.
    const fake = { data: { json: () => ({ notification: { data: { type: msg.kind || 'quiz' } } }) } };
    event.waitUntil(self.MakelinePush.handlePush(fake, self.MakelinePush.deviceDeps(self)));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match('index.html')) || fetch(req);
    })());
    return;
  }

  const path = url.pathname.slice(scope.pathname.length);
  if (NETWORK_FIRST.includes(path)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) await cache.put(path, res.clone());
        return res;
      } catch (e) {
        return (await cache.match(path)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
  })());
});

self.addEventListener('push', (event) => {
  event.waitUntil(self.MakelinePush.handlePush(event, self.MakelinePush.deviceDeps(self)));
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(self.MakelinePush.handleNotificationClick(event, self.MakelinePush.deviceDeps(self)));
});
