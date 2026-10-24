/* Наши праздники — service worker: офлайн (cache-first), напоминания (push + periodic sync). */
const CACHE_NAME = 'prazdniki-v1.1.0';
const DATA_CACHE = 'prazdniki-data'; // данные и отметки показанных напоминаний — не чистить

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/core.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/badge-96.png',
];

importScripts('./js/core.js');

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== CACHE_NAME && k !== DATA_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // GitHub API и прочее — мимо кэша

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) {
      // Фоновое обновление: при следующем открытии будет свежая версия файла
      event.waitUntil(fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {}));
      return cached;
    }
    try {
      const resp = await fetch(req);
      if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    } catch (e) {
      if (req.mode === 'navigate') {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
      return Response.error();
    }
  })());
});

// ---- Напоминания ----

async function checkReminders() {
  const events = ((await Core.cacheGet(Core.DATA_URL)) || []).filter(e => !e.deleted);
  return Core.notifyDue(self.registration, events, new Date());
}

// Chrome/Android: установленное приложение будится примерно раз в 12+ часов
self.addEventListener('periodicsync', event => {
  if (event.tag === 'reminders') event.waitUntil(checkReminders());
});

// Push от GitHub Actions: payload = [{key, title, body}] или {key, title, body}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let items = [];
    try { items = event.data ? event.data.json() : []; } catch (e) {
      items = [{ key: 'push-' + Date.now(), title: 'Наши праздники', body: event.data ? event.data.text() : '' }];
    }
    if (!Array.isArray(items)) items = [items];
    if (!items.length) {
      // Пустой push — просто проверить локально
      if (!(await checkReminders())) {
        await self.registration.showNotification('Наши праздники', { ...Core.NOTIF_OPTS, body: 'Загляните в календарь', tag: 'ping' });
      }
      return;
    }
    for (const it of items) {
      await self.registration.showNotification(it.title, { ...Core.NOTIF_OPTS, body: it.body, tag: it.key || undefined });
      if (it.key) await Core.markShown(it.key);
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow('./');
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'check-reminders') event.waitUntil(checkReminders());
});
